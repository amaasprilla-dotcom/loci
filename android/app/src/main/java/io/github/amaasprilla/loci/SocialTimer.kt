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

// The timer (SPEC-v6-android.md, "Social media timer"; SPEC-v7-wellbeing.md). The pill shows
// your time in distracting apps today, all of them together: it counts while one is in
// front, pauses while you're elsewhere or the screen is off, and starts again at 0:00 at
// midnight. WatchService tells it what's in front; the pill and a silent notification show
// the clock. The blocker's daily limit needs the count too, so it counts with the timer off
// while a limit is on (with no pill or notification).
class SocialTimer(private val context: Context) {
    private val state = context.getSharedPreferences(STATE, Context.MODE_PRIVATE)
    private val main = Handler(Looper.getMainLooper())
    private val pill = TimerPill(context, state)

    private var runningSince = 0L // 0 while paused
    private var app = ""
    private var notified = false
    private var notifiedDay = 0L // the day the notification's clock was set for

    init {
        // The service was stopped mid-stretch (a crash, an update): count up to the last sign of life.
        val since = state.getLong("runningSince", 0)
        if (since != 0L) {
            addToToday(state, since, maxOf(since, state.getLong("lastTick", 0)))
            state.edit().putLong("runningSince", 0).apply()
        }
    }

    // Called on every change of what's in front: `pkg` is the distracting app in front, if
    // any (not one that's blocked). `limit`: a daily limit needs counting; `cutoff`: when the
    // next block starts, for the pill's countdown (0 if none).
    fun update(pkg: String?, prefs: JSONObject?, limit: Boolean, cutoff: Long) {
        val now = System.currentTimeMillis()
        val on = prefs?.optBoolean("on", false) == true
        if (pkg == null || !(on || limit)) {
            pause(now)
            pill.hide()
            return
        }
        val name = label(context, pkg)
        val changed = name != app
        app = name
        if (runningSince == 0L) {
            runningSince = now
            state.edit().putLong("runningSince", now).putLong("lastTick", now).apply()
            main.post(tick)
        }
        if (!on) {
            pill.hide()
            cancelNotice()
            return
        }
        pill.show(app, todayMs(context, now), prefs!!.optString("size", "normal") == "small", cutoff)
        if (!notified || changed) notifyRunning(now)
    }

    private fun cancelNotice() {
        notified = false
        NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
    }

    private fun pause(now: Long) {
        if (runningSince == 0L) return
        addToToday(state, runningSince, now)
        runningSince = 0
        state.edit().putLong("runningSince", 0).apply()
        main.removeCallbacks(tick)
        cancelNotice()
    }

    private val tick = object : Runnable {
        override fun run() {
            if (runningSince == 0L) return
            val now = System.currentTimeMillis()
            Problems.safely(context, "Timer") {
                pill.setTime(todayMs(context, now))
                if (now / 1000 % 15 == 0L) state.edit().putLong("lastTick", now).apply()
                // Past midnight the notification's clock starts again too.
                if (notified && dayStart(now) != notifiedDay) notifyRunning(now)
            }
            main.postAtTime(this, SystemClock.uptimeMillis() + 1_000 - now % 1_000)
        }
    }

    private fun channel() {
        context.getSystemService(NotificationManager::class.java)
            .createNotificationChannel(NotificationChannel(CHANNEL, "Timer", NotificationManager.IMPORTANCE_LOW))
    }

    // While a distracting app is open the notification's clock counts up on its own.
    private fun notifyRunning(now: Long) {
        channel()
        notified = true
        notifiedDay = dayStart(now)
        val open = PendingIntent.getActivity(
            context, NOTIFICATION_ID, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        post(
            NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(R.drawable.ic_notification)
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .setContentIntent(open)
                .setContentTitle("Distracting apps · today")
                .setContentText("In $app")
                .setWhen(now - todayMs(context, now))
                .setUsesChronometer(true)
                .setShowWhen(true)
                .setOngoing(true),
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
