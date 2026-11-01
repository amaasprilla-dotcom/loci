package io.github.amaasprilla.loci

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject
import java.util.Calendar

// The social media timer (SPEC-v6-android.md, "Social media timer"). One clock runs across
// every social app while one is in front; it pauses while you're elsewhere or the screen
// is off, and starts again at 0:00 once you've been away for the reset time. WatchService
// tells it what's in front; the pill and a silent notification show the clock.
class SocialTimer(private val context: Context) {
    private val state = context.getSharedPreferences(STATE, Context.MODE_PRIVATE)
    private val main = Handler(Looper.getMainLooper())
    private val pill = TimerPill(context, state)

    private var sessionMs = state.getLong("sessionMs", 0) // before the stretch running now
    private var runningSince = 0L // 0 while paused
    private var leftAt = state.getLong("leftAt", 0)
    private var app = ""

    init {
        // The service was stopped mid-stretch (crash, update): count up to the last sign of life.
        val lastTick = state.getLong("lastTick", 0)
        if (state.getLong("runningSince", 0) != 0L && lastTick != 0L) {
            runningSince = state.getLong("runningSince", 0)
            pause(lastTick)
        }
        resetIfAway(System.currentTimeMillis())
    }

    // Called on every change of what's in front: `pkg` is the app in front (null with the
    // screen off), counted only if it's social and the timer is on.
    fun update(pkg: String?, prefs: JSONObject?) {
        val now = System.currentTimeMillis()
        val on = prefs?.optBoolean("on", false) == true
        if (!on) return stop(now)
        val social = pkg != null && isSocial(context, pkg, prefs)
        if (social) {
            resetIfAway(now, prefs)
            app = label(context, pkg!!)
            if (runningSince == 0L) {
                runningSince = now
                save()
                main.post(tick)
            }
            pill.show(app, sessionAt(now), prefs!!.optString("size", "normal") == "small")
            notifyRunning(now)
        } else {
            pause(now)
            pill.hide()
            main.removeCallbacks(resetCheck)
            if (sessionMs > 0) main.postDelayed(resetCheck, resetMs(prefs) + 1_000)
        }
    }

    // The timer was switched off: nothing shows and nothing counts.
    private fun stop(now: Long) {
        if (runningSince == 0L && sessionMs == 0L && leftAt == 0L) return
        pause(now)
        pill.hide()
        endSession()
    }

    private fun pause(now: Long) {
        if (runningSince == 0L) return
        addToToday(state, runningSince, now)
        sessionMs += now - runningSince
        runningSince = 0
        leftAt = now
        main.removeCallbacks(tick)
        save()
        notifyPaused()
    }

    private fun resetIfAway(now: Long, prefs: JSONObject? = null) {
        if (runningSince == 0L && leftAt != 0L && now - leftAt >= resetMs(prefs)) endSession()
    }

    private fun endSession() {
        sessionMs = 0
        leftAt = 0
        main.removeCallbacks(resetCheck)
        save()
        NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
    }

    private val resetCheck = Runnable { resetIfAway(System.currentTimeMillis()) }

    private val tick = object : Runnable {
        override fun run() {
            if (runningSince == 0L) return
            val now = System.currentTimeMillis()
            pill.setTime(sessionAt(now))
            if (now / 1000 % 15 == 0L) state.edit().putLong("lastTick", now).apply()
            main.postAtTime(this, SystemClock.uptimeMillis() + 1_000 - now % 1_000)
        }
    }

    private fun sessionAt(now: Long) = sessionMs + if (runningSince != 0L) now - runningSince else 0

    private fun resetMs(prefs: JSONObject?): Long {
        val p = prefs ?: WatchService.phonePrefs(context).optJSONObject("timer")
        return (p?.optInt("resetMin", DEFAULT_RESET_MIN) ?: DEFAULT_RESET_MIN).coerceIn(1, 30) * 60_000L
    }

    private fun save() {
        state.edit()
            .putLong("sessionMs", sessionMs)
            .putLong("runningSince", runningSince)
            .putLong("leftAt", leftAt)
            .putLong("lastTick", runningSince)
            .apply()
    }

    private fun channel() {
        context.getSystemService(NotificationManager::class.java)
            .createNotificationChannel(NotificationChannel(CHANNEL, "Social media timer", NotificationManager.IMPORTANCE_LOW))
    }

    private fun notification(): NotificationCompat.Builder {
        channel()
        val open = PendingIntent.getActivity(
            context, NOTIFICATION_ID, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setContentIntent(open)
    }

    // While a social app is open the notification's clock counts up on its own.
    private fun notifyRunning(now: Long) {
        post(
            notification()
                .setContentTitle("Social · this session")
                .setContentText("In $app")
                .setWhen(now - sessionAt(now))
                .setUsesChronometer(true)
                .setShowWhen(true)
                .setOngoing(true),
        )
    }

    private fun notifyPaused() {
        if (sessionMs <= 0) return
        val min = resetMs(null) / 60_000
        post(
            notification()
                .setContentTitle("Social · ${clock(sessionMs)} this session")
                .setContentText("Paused. Starts again at 0:00 after $min min away.")
                .setShowWhen(false),
        )
    }

    private fun post(builder: NotificationCompat.Builder) {
        val manager = NotificationManagerCompat.from(context)
        if (!manager.areNotificationsEnabled()) return
        try {
            manager.notify(NOTIFICATION_ID, builder.build())
        } catch (_: SecurityException) {
        }
    }

    fun close() {
        pause(System.currentTimeMillis())
        pill.hide()
        main.removeCallbacksAndMessages(null)
    }

    companion object {
        const val STATE = "timer"
        private const val CHANNEL = "timer"
        private const val NOTIFICATION_ID = 2
        const val DEFAULT_RESET_MIN = 5

        // The well-known ones, for apps that don't say they're social (SPEC-v6, "Which apps count").
        private val KNOWN = setOf(
            "com.instagram.android", // Instagram
            "com.instagram.barcelona", // Threads
            "com.zhiliaoapp.musically", "com.ss.android.ugc.trill", // TikTok
            "com.twitter.android", // X
            "com.facebook.katana", "com.facebook.lite", // Facebook
            "com.snapchat.android",
            "com.reddit.frontpage",
            "com.google.android.youtube",
            "com.pinterest",
            "com.tumblr",
            "xyz.blueskyweb.app", // Bluesky
            "com.discord",
        )

        fun socialByDefault(context: Context, pkg: String): Boolean {
            if (pkg in KNOWN) return true
            return try {
                context.packageManager.getApplicationInfo(pkg, 0).category == ApplicationInfo.CATEGORY_SOCIAL
            } catch (_: PackageManager.NameNotFoundException) {
                false
            }
        }

        // The app list in Settings → Phone turns any app on or off; the rest go by default.
        fun isSocial(context: Context, pkg: String, prefs: JSONObject): Boolean {
            val apps = prefs.optJSONObject("apps")
            return if (apps != null && apps.has(pkg)) apps.optBoolean(pkg) else socialByDefault(context, pkg)
        }

        fun label(context: Context, pkg: String): String = try {
            context.packageManager.getApplicationLabel(context.packageManager.getApplicationInfo(pkg, 0)).toString()
        } catch (_: PackageManager.NameNotFoundException) {
            pkg
        }

        // Time spent in social apps today, the stretch running now included. Kept on the phone.
        fun todayMs(context: Context, now: Long = System.currentTimeMillis()): Long {
            val state = context.getSharedPreferences(STATE, Context.MODE_PRIVATE)
            val today = if (state.getLong("day", 0) == dayStart(now)) state.getLong("todayMs", 0) else 0
            val since = state.getLong("runningSince", 0)
            return today + if (since != 0L) now - maxOf(since, dayStart(now)) else 0
        }

        // A stretch over midnight counts only its part after midnight: there's no history.
        private fun addToToday(state: android.content.SharedPreferences, from: Long, to: Long) {
            val day = dayStart(to)
            val before = if (state.getLong("day", 0) == day) state.getLong("todayMs", 0) else 0
            state.edit().putLong("day", day).putLong("todayMs", before + to - maxOf(from, day)).apply()
        }

        private fun dayStart(at: Long): Long = Calendar.getInstance().apply {
            timeInMillis = at
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }.timeInMillis

        // 4:05, or 1:04:05 past an hour.
        fun clock(ms: Long): String {
            val s = ms / 1000
            return if (s >= 3600) "%d:%02d:%02d".format(s / 3600, s / 60 % 60, s % 60) else "%d:%02d".format(s / 60, s % 60)
        }
    }
}
