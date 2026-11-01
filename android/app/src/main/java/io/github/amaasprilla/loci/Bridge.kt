package io.github.amaasprilla.loci

import android.Manifest
import android.app.AppOpsManager
import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.Process
import android.provider.MediaStore
import android.provider.Settings
import android.util.Base64
import android.webkit.WebView
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.FileProvider
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors

// The web app's way to the native side (SPEC-v6-android.md, "Bridge"). The page sees
// window.LociAndroid only on Loci's own address. Each message is JSON with an `id` and a
// `type`; the answer comes back with the same id (src/android.ts).
class Bridge(private val activity: MainActivity, web: WebView, origin: String) {
    private val io = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private val prefs = activity.getSharedPreferences("bridge", Context.MODE_PRIVATE)

    init {
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "LociAndroid", setOf(origin)) { _, message, _, isMainFrame, reply ->
                if (isMainFrame) message.data?.let { handle(JSONObject(it), reply) }
            }
        }
    }

    private fun handle(msg: JSONObject, reply: JavaScriptReplyProxy) {
        val id = msg.optInt("id")
        fun answer(result: Any?) = main.post {
            reply.postMessage(JSONObject().put("id", id).put("result", result ?: JSONObject.NULL).toString())
        }
        when (msg.optString("type")) {
            "info" -> answer(JSONObject().put("version", BuildConfig.VERSION_NAME).put("build", BuildConfig.VERSION_CODE))
            "permissions" -> answer(permissions())
            "allow" -> allow(msg.optString("which")) { answer(permissions()) }
            "save" -> io.execute { answer(save(msg.getString("name"), msg.optString("mime"), msg.getString("data"))) }
            "open" -> io.execute { answer(open(msg.getString("name"), msg.optString("mime"), msg.getString("data"))) }
            else -> answer(null)
        }
    }

    // What each phone feature needs, as Settings → Phone shows it.
    private fun permissions(): JSONObject {
        val power = activity.getSystemService(PowerManager::class.java)
        return JSONObject()
            .put("notifications", NotificationManagerCompat.from(activity).areNotificationsEnabled())
            .put("usageAccess", hasUsageAccess())
            .put("overlay", Settings.canDrawOverlays(activity))
            .put("writeSettings", Settings.System.canWrite(activity))
            .put("battery", power.isIgnoringBatteryOptimizations(activity.packageName))
    }

    private fun hasUsageAccess(): Boolean {
        val ops = activity.getSystemService(AppOpsManager::class.java)
        val mode = if (Build.VERSION.SDK_INT >= 29) {
            ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), activity.packageName)
        } else {
            @Suppress("DEPRECATION")
            ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), activity.packageName)
        }
        return mode == AppOpsManager.MODE_ALLOWED
    }

    // Opens the system screen (or pop-up) that allows `which`. `done` runs right away for
    // a system screen: the page looks again when Loci comes back (loci:resume).
    private fun allow(which: String, done: () -> Unit) {
        val pkg = Uri.parse("package:${activity.packageName}")
        val intent = when (which) {
            "notifications" -> {
                val granted = activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
                // The pop-up works until it's been refused twice; after that only the app's settings can.
                val canAsk = !prefs.getBoolean("askedNotifications", false) ||
                    activity.shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS)
                if (Build.VERSION.SDK_INT >= 33 && !granted && canAsk) {
                    prefs.edit().putBoolean("askedNotifications", true).apply()
                    activity.requestNotifications(done)
                    return
                }
                Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, activity.packageName)
            }
            "usageAccess" -> Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)
            "overlay" -> Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, pkg)
            "writeSettings" -> Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS, pkg)
            "battery" -> @Suppress("BatteryLife") Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, pkg)
            else -> null
        }
        try {
            intent?.let { activity.startActivity(it) }
        } catch (_: ActivityNotFoundException) {
            // Some phones lack the exact screen: the app's own info page has the rest.
            activity.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg))
        }
        done()
    }

    // A file the page made (a backup, an attachment), saved to Downloads.
    private fun save(name: String, mime: String, data: String): Boolean = try {
        val bytes = Base64.decode(data, Base64.DEFAULT)
        val resolver = activity.contentResolver
        if (Build.VERSION.SDK_INT >= 29) {
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, name)
                put(MediaStore.Downloads.MIME_TYPE, mime.ifEmpty { "application/octet-stream" })
            }
            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)!!
            resolver.openOutputStream(uri)!!.use { it.write(bytes) }
        } else {
            // Android 8–9 have no MediaStore Downloads; the app's own Downloads folder needs no permission.
            File(activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), name).writeBytes(bytes)
        }
        true
    } catch (_: Exception) {
        false
    }

    // A file the page wants shown (an attached PDF or photo): handed to an app that can open it.
    private fun open(name: String, mime: String, data: String): Boolean = try {
        val dir = File(activity.cacheDir, "open").apply { deleteRecursively(); mkdirs() }
        val file = File(dir, name.replace(Regex("[\\\\/:*?\"<>|]"), "_"))
        file.writeBytes(Base64.decode(data, Base64.DEFAULT))
        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.files", file)
        val view = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, mime.ifEmpty { "application/octet-stream" })
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        activity.startActivity(Intent.createChooser(view, name))
        true
    } catch (_: Exception) {
        false
    }
}
