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
// is on, and passes that to the timer, the blocker and sleep mode.
class WatchService : AccessibilityService() {
    private lateinit var timer: SocialTimer
    private lateinit var sleep: SleepMode
    private lateinit var blocked: BlockedScreen
    private val main = android.os.Handler(android.os.Looper.getMainLooper())
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
                else -> Problems.safely(context, "Screen on") { !getSystemService(KeyguardManager::class.java).isKeyguardLocked } ?: true
            }
            update()
        }
    }

    override fun onServiceConnected() {
        timer = SocialTimer(this)
        sleep = SleepMode(this)
        blocked = BlockedScreen(this)
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
        Problems.safely(this, "Watching apps") { onEvent(event) }
    }

    private fun onEvent(event: AccessibilityEvent) {
        val pkg = event.packageName?.toString() ?: return
        // The keyboard, the notification shade, pop-ups from the system and Loci's own pill
        // open over an app without leaving it.
        if (pkg == packageName && event.className != MainActivity::class.java.name) return
        val opened = if (event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            isApp(pkg)
        } else {
            // Opening an app doesn't always say so: the home screen can report itself last,
            // after the app is open, and a service started mid-app has heard nothing. So
            // while it looks like the home screen (or nothing), an app changing on screen is
            // the app in front.
            (foreground == null || foreground in homes) && pkg !in homes && isApp(pkg)
        }
        if (!opened) return
        foreground = pkg
        update()
    }

    private val homes: Set<String> by lazy { homes(this) }

    private fun isApp(pkg: String): Boolean = apps.getOrPut(pkg) {
        val keyboards = getSystemService(InputMethodManager::class.java).enabledInputMethodList.map { it.packageName }
        if (pkg in keyboards) return@getOrPut false
        packageManager.getLaunchIntentForPackage(pkg) != null || pkg in homes
    }

    // The timer, the blocker and sleep mode apart, so a problem in one doesn't stop the others.
    private fun update() {
        main.removeCallbacks(recheck)
        val phone = Problems.safely(this, "Reading phone settings") { phonePrefs(this) } ?: return
        val now = System.currentTimeMillis()
        val timerPrefs = phone.optJSONObject("timer")
        // The distracting app in front, if any.
        val app = foreground.takeIf { screenOn }?.takeIf { pkg ->
            !Blocker.neverBlocked(this, pkg, homes) && SocialTimer.isSocial(this, pkg, timerPrefs ?: JSONObject())
        }
        val block = Problems.safely(this, "Blocker") { Blocker.state(this, phone, now, SocialTimer.todayMs(this, now), app != null) }
        val blockedNow = block?.blocked.takeIf { app != null }
        Problems.safely(this, "Blocked screen") {
            if (block != null && blockedNow != null) blocked.show(app!!, blockedNow, block.moresLeft.takeIf { block.firmness == "gentle" }) else blocked.hide()
        }
        Problems.safely(this, "Timer") {
            val limit = block?.on == true && Blocker.hasLimit(phone)
            timer.update(app.takeIf { blockedNow == null }, timerPrefs, limit, block?.next?.start ?: 0)
        }
        Problems.safely(this, "Sleep mode") { sleep.update(screenOn, phone.optJSONObject("sleep")) }
        // A block starting (or its countdown) or ending while the app stays in front.
        if (app != null && block != null && block.change > 0) main.postDelayed(recheck, (block.change - now).coerceIn(250, 30_000))
    }

    private val recheck = Runnable { Problems.safely(this, "Watching apps") { update() } }

    override fun onInterrupt() {}

    override fun onDestroy() {
        if (instance === this) instance = null
        if (::timer.isInitialized) {
            main.removeCallbacksAndMessages(null)
            timer.close()
            sleep.close()
            blocked.hide()
            prefs.unregisterOnSharedPreferenceChangeListener(prefsChanged)
            unregisterReceiver(screen)
        }
        super.onDestroy()
    }

    companion object {
        // The running service, for Sleep now and the reminder's buttons to take effect at once.
        private var instance: WatchService? = null

        fun refresh() = android.os.Handler(android.os.Looper.getMainLooper()).post { instance?.update() }

        fun homes(context: Context): Set<String> {
            val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
            return context.packageManager.queryIntentActivities(home, PackageManager.MATCH_DEFAULT_ONLY).map { it.activityInfo.packageName }.toSet()
        }

        fun phonePrefs(context: Context): JSONObject =
            JSONObject(context.getSharedPreferences(Bridge.PREFS, Context.MODE_PRIVATE).getString("phone", "{}")!!)
    }
}
