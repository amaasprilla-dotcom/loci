package io.github.amaasprilla.loci

import android.accessibilityservice.AccessibilityService
import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.PowerManager
import android.view.accessibility.AccessibilityEvent
import android.view.inputmethod.InputMethodManager
import androidx.core.content.ContextCompat
import org.json.JSONObject

// The accessibility service (SPEC-v6-android.md, "Native side"). Android keeps it running
// while it's switched on in Accessibility settings. It only hears which app comes to the
// front (it can't read what's on screen, res/xml/watch_service.xml) and whether the screen
// is on, and passes that to the social media timer and sleep mode.
class WatchService : AccessibilityService() {
    private lateinit var timer: SocialTimer
    private lateinit var sleep: SleepMode
    private lateinit var prefs: SharedPreferences
    private var foreground: String? = null
    private var screenOn = true
    private val apps = HashMap<String, Boolean>() // package → whether it's an app you open

    // The phone settings changed in Settings → Phone.
    private val prefsChanged = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
        if (key == "phone") update()
    }

    private val screen = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            screenOn = when (intent.action) {
                Intent.ACTION_SCREEN_OFF -> false
                Intent.ACTION_USER_PRESENT -> true
                // With no lock screen there's no USER_PRESENT to wait for.
                else -> !getSystemService(KeyguardManager::class.java).isKeyguardLocked
            }
            update()
        }
    }

    override fun onServiceConnected() {
        timer = SocialTimer(this)
        sleep = SleepMode(this)
        instance = this
        prefs = getSharedPreferences(Bridge.PREFS, MODE_PRIVATE)
        prefs.registerOnSharedPreferenceChangeListener(prefsChanged)
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_OFF)
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_USER_PRESENT)
        }
        ContextCompat.registerReceiver(this, screen, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
        screenOn = getSystemService(PowerManager::class.java).isInteractive
        Watchdog.cancelNotice(this)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val pkg = event.packageName?.toString() ?: return
        // The keyboard, the notification shade, pop-ups from the system and Loci's own pill
        // open over an app without leaving it.
        if (pkg == packageName && event.className != MainActivity::class.java.name) return
        if (!isApp(pkg)) return
        foreground = pkg
        update()
    }

    private fun isApp(pkg: String): Boolean = apps.getOrPut(pkg) {
        val keyboards = getSystemService(InputMethodManager::class.java).enabledInputMethodList.map { it.packageName }
        if (pkg in keyboards) return@getOrPut false
        val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        val homes = packageManager.queryIntentActivities(home, PackageManager.MATCH_DEFAULT_ONLY).map { it.activityInfo.packageName }
        packageManager.getLaunchIntentForPackage(pkg) != null || pkg in homes
    }

    private fun update() {
        val phone = phonePrefs(this)
        timer.update(if (screenOn) foreground else null, phone.optJSONObject("timer"))
        sleep.update(screenOn, phone.optJSONObject("sleep"))
    }

    override fun onInterrupt() {}

    override fun onDestroy() {
        if (instance === this) instance = null
        if (::timer.isInitialized) {
            timer.close()
            sleep.close()
            prefs.unregisterOnSharedPreferenceChangeListener(prefsChanged)
            unregisterReceiver(screen)
        }
        super.onDestroy()
    }

    companion object {
        // The running service, for Sleep now and the reminder's buttons to take effect at once.
        private var instance: WatchService? = null

        fun refresh() = android.os.Handler(android.os.Looper.getMainLooper()).post { instance?.update() }

        fun phonePrefs(context: Context): JSONObject =
            JSONObject(context.getSharedPreferences(Bridge.PREFS, Context.MODE_PRIVATE).getString("phone", "{}")!!)
    }
}
