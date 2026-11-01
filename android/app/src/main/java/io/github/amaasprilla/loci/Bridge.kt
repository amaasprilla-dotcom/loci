package io.github.amaasprilla.loci

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.MediaStore
import android.provider.Settings
import android.util.Base64
import android.webkit.WebView
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.FileProvider
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.concurrent.Executors

// The web app's way to the native side (SPEC-v6-android.md, "Bridge"). The page sees
// window.LociAndroid only on Loci's own address. Each message is JSON with an `id` and a
// `type`; the answer comes back with the same id (src/android.ts).
class Bridge(private val activity: MainActivity, web: WebView, origin: String) {
    private val io = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private val prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

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
            "info" -> answer(JSONObject().put("version", BuildConfig.VERSION_NAME).put("build", BuildConfig.VERSION_CODE).put("sdk", Build.VERSION.SDK_INT))
            "permissions" -> answer(permissions())
            "allow" -> allow(msg.optString("which")) { answer(permissions()) }
            "schedule" -> {
                Reminders.replace(activity, msg.getJSONObject("schedule"))
                answer(true)
            }
            "takeActions" -> answer(Reminders.takeActions(activity))
            // The phone settings the native side needs while Loci is closed (reminders, the
            // timer; sleep mode later), kept as one JSON object. WatchService hears changes.
            "getPrefs" -> answer(JSONObject(prefs.getString("phone", "{}")!!))
            "setPrefs" -> {
                prefs.edit().putString("phone", msg.getJSONObject("prefs").toString()).apply()
                Watchdog.check(activity, quiet = true)
                answer(true)
            }
            "apps" -> io.execute { answer(apps()) }
            "timerToday" -> answer(SocialTimer.todayMs(activity))
            "sleepState" -> answer(sleepState())
            // Sleep now (until the next wake time), or I'm up (until tomorrow night).
            "sleepNow" -> {
                if (msg.optBoolean("on")) SleepMode.sleepNow(activity) else SleepMode.imUp(activity)
                WatchService.refresh()
                answer(sleepState())
            }
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
            .put("accessibility", Watchdog.serviceRunning(activity))
            .put("writeSettings", Settings.System.canWrite(activity))
            .put("battery", power.isIgnoringBatteryOptimizations(activity.packageName))
            .put("exactAlarms", Reminders.exactAlarmsAllowed(activity))
            // Samsung adds its own sleeping-apps list on top, which no app can see or change.
            .put("samsung", Build.MANUFACTURER.equals("samsung", ignoreCase = true))
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
            // Some phones (Samsung among them) open straight on Loci's line with the extras.
            "accessibility" -> Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
                val service = ComponentName(activity, WatchService::class.java).flattenToString()
                putExtra(":settings:fragment_args_key", service)
                putExtra(":settings:show_fragment_args", Bundle().apply { putString(":settings:fragment_args_key", service) })
            }
            "writeSettings" -> Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS, pkg)
            "battery" -> @Suppress("BatteryLife") Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, pkg)
            "exactAlarms" -> if (Build.VERSION.SDK_INT >= 31) Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, pkg) else null
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

    private fun sleepState(): JSONObject {
        val phase = SleepMode.phase(activity)
        return JSONObject().put("phase", phase.kind.name.lowercase()).put("start", phase.start).put("end", phase.end)
    }

    // Every app with a launcher icon, for the timer's app list: social ones first.
    private fun apps(): JSONArray {
        val pm = activity.packageManager
        val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val list = pm.queryIntentActivities(launcher, 0)
            .map { it.activityInfo.applicationInfo }
            .distinctBy { it.packageName }
            .filter { it.packageName != activity.packageName }
            .map { info -> Triple(info, pm.getApplicationLabel(info).toString(), SocialTimer.socialByDefault(activity, info.packageName)) }
            .sortedWith(compareBy({ !it.third }, { it.second.lowercase() }))
        return JSONArray(list.map { (info, name, social) ->
            JSONObject().put("pkg", info.packageName).put("name", name).put("social", social).put("icon", icon(pm.getApplicationIcon(info)))
        })
    }

    private fun icon(drawable: android.graphics.drawable.Drawable): String {
        val size = (32 * activity.resources.displayMetrics.density).toInt()
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        drawable.setBounds(0, 0, size, size)
        drawable.draw(Canvas(bitmap))
        val png = ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        return "data:image/png;base64," + Base64.encodeToString(png.toByteArray(), Base64.NO_WRAP)
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

    companion object {
        const val PREFS = "bridge"
    }
}
