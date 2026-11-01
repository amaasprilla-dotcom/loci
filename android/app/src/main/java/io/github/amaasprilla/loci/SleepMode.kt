package io.github.amaasprilla.loci

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject
import java.util.Calendar

// Sleep mode (SPEC-v6-android.md, "Sleep mode"). From bedtime to wake time, an amber layer
// warms and dims the screen (fading in over the 30 minutes before), the real brightness goes
// down if "Modify system settings" is allowed, and while the screen is on a reminder comes
// every few minutes. WatchService drives it: the layer is an accessibility overlay, so it
// covers the status and navigation bars and lets every touch through.
class SleepMode(private val context: Context) {
    private val state = context.getSharedPreferences(STATE, Context.MODE_PRIVATE)
    private val main = Handler(Looper.getMainLooper())
    private val windows = context.getSystemService(WindowManager::class.java)
    private var layer: View? = null
    private var screenOn = true
    private var prefs: JSONObject? = null

    fun update(screenOn: Boolean, prefs: JSONObject?) {
        // Turning the screen on again reminds straight away.
        if (!screenOn) state.edit().putLong("lastReminder", 0).apply()
        this.screenOn = screenOn
        this.prefs = prefs
        apply()
    }

    // Every 30 seconds while the screen is on: the fade, bedtime and wake time, reminders.
    private val tick = Runnable { apply() }

    private fun apply() {
        main.removeCallbacks(tick)
        val now = System.currentTimeMillis()
        val phase = phase(context, prefs, now)
        when (phase.kind) {
            Kind.OFF -> end()
            Kind.WIND_DOWN -> {
                showLayer(phase.progress)
                restoreBrightness()
                NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
            }
            Kind.ASLEEP -> {
                showLayer(1f)
                lowerBrightness()
                if (screenOn) remindIfDue(now, phase)
            }
        }
        if (screenOn && prefs?.optBoolean("on") == true) main.postDelayed(tick, 30_000)
    }

    private fun end() {
        layer?.let { windows.removeView(it) }
        layer = null
        restoreBrightness()
        NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
    }

    fun close() {
        main.removeCallbacksAndMessages(null)
        layer?.let { windows.removeView(it) }
        layer = null
    }

    // At most 80% opaque, so the screen underneath stays readable.
    private fun showLayer(progress: Float) {
        val strength = (prefs?.optInt("strength", DEFAULT_STRENGTH) ?: DEFAULT_STRENGTH).coerceIn(0, 100)
        val alpha = (strength / 100f * 0.8f * progress * 255).toInt()
        val view = layer ?: View(context).also {
            it.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            windows.addView(it, layerParams())
            layer = it
        }
        view.setBackgroundColor(Color.argb(alpha, 0x5A, 0x2C, 0x00)) // a deep amber: warmer and darker
    }

    private fun layerParams(): WindowManager.LayoutParams {
        // The whole display, bars and camera cut-out included.
        val (w, h) = if (Build.VERSION.SDK_INT >= 30) {
            windows.maximumWindowMetrics.bounds.let { it.width() to it.height() }
        } else {
            val m = android.util.DisplayMetrics()
            @Suppress("DEPRECATION")
            windows.defaultDisplay.getRealMetrics(m)
            m.widthPixels to m.heightPixels
        }
        return WindowManager.LayoutParams(
            w, h,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            if (Build.VERSION.SDK_INT >= 28) layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
    }

    // The brightness before sleep mode is kept and put back when it ends.
    private fun lowerBrightness() {
        if (!Settings.System.canWrite(context) || state.contains("savedBrightness")) return
        val resolver = context.contentResolver
        state.edit()
            .putInt("savedBrightness", Settings.System.getInt(resolver, Settings.System.SCREEN_BRIGHTNESS, 128))
            .putInt("savedMode", Settings.System.getInt(resolver, Settings.System.SCREEN_BRIGHTNESS_MODE, 0))
            .apply()
        Settings.System.putInt(resolver, Settings.System.SCREEN_BRIGHTNESS_MODE, Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL)
        Settings.System.putInt(resolver, Settings.System.SCREEN_BRIGHTNESS, LOW_BRIGHTNESS)
    }

    private fun restoreBrightness() {
        if (!state.contains("savedBrightness")) return
        if (Settings.System.canWrite(context)) {
            val resolver = context.contentResolver
            Settings.System.putInt(resolver, Settings.System.SCREEN_BRIGHTNESS, state.getInt("savedBrightness", 128))
            Settings.System.putInt(resolver, Settings.System.SCREEN_BRIGHTNESS_MODE, state.getInt("savedMode", 0))
        }
        state.edit().remove("savedBrightness").remove("savedMode").apply()
    }

    private fun remindIfDue(now: Long, phase: Phase) {
        if (now < state.getLong("snoozeUntil", 0)) return
        val every = (prefs?.optInt("every", DEFAULT_EVERY_MIN) ?: DEFAULT_EVERY_MIN) * 60_000L
        if (now - state.getLong("lastReminder", 0) < every - 1_000) return
        state.edit().putLong("lastReminder", now).apply()
        val line = "${clock(now)} · You're meant to be asleep"
        showPill(line)
        notify(line, phase.end)
    }

    // The same line over whatever is open, fading after 5 seconds.
    private fun showPill(line: String) {
        val pill = TimerPill.styled(context).apply { text = line }
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            y = TimerPill.statusBarHeight(context) +
                TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 56f, context.resources.displayMetrics).toInt()
        }
        windows.addView(pill, params)
        pill.animate().alpha(0f).setStartDelay(5_000).setDuration(600).withEndAction {
            if (pill.isAttachedToWindow) windows.removeView(pill)
        }
    }

    private fun notify(line: String, until: Long) {
        val manager = NotificationManagerCompat.from(context)
        if (!manager.areNotificationsEnabled()) return
        context.getSystemService(NotificationManager::class.java)
            .createNotificationChannel(NotificationChannel(CHANNEL, "Sleep reminders", NotificationManager.IMPORTANCE_LOW))
        val notice = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(line)
            .setContentText("Sleep mode until ${clock(until)}.")
            .setShowWhen(false)
            .addAction(0, "I'm up", action(ACTION_UP))
            .addAction(0, "10 more minutes", action(ACTION_MORE))
            .build()
        try {
            manager.notify(NOTIFICATION_ID, notice)
        } catch (_: SecurityException) {
        }
    }

    private fun action(name: String) = PendingIntent.getBroadcast(
        context, name.hashCode(), Intent(context, SleepReceiver::class.java).setAction(name),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    private fun clock(at: Long) = android.text.format.DateFormat.getTimeFormat(context).format(java.util.Date(at))

    enum class Kind { OFF, WIND_DOWN, ASLEEP }

    // `start`–`end`: tonight's sleep (or Sleep now's); `progress`: how far the fade has got.
    data class Phase(val kind: Kind, val start: Long = 0, val end: Long = 0, val progress: Float = 0f)

    companion object {
        const val STATE = "sleep"
        private const val CHANNEL = "sleep"
        const val NOTIFICATION_ID = 4
        const val ACTION_UP = "io.github.amaasprilla.loci.SLEEP_UP"
        const val ACTION_MORE = "io.github.amaasprilla.loci.SLEEP_MORE"
        private const val WIND_DOWN_MS = 30 * 60_000L
        private const val MORE_MS = 10 * 60_000L
        private const val LOW_BRIGHTNESS = 10 // of 255
        private const val DEFAULT_STRENGTH = 60
        private const val DEFAULT_EVERY_MIN = 10

        private fun state(context: Context) = context.getSharedPreferences(STATE, Context.MODE_PRIVATE)
        private fun sleepPrefs(context: Context) = WatchService.phonePrefs(context).optJSONObject("sleep")

        private fun minutes(clock: String, fallback: Int): Int {
            val parts = clock.split(":").mapNotNull { it.toIntOrNull() }
            return if (parts.size == 2) parts[0] * 60 + parts[1] else fallback
        }

        // `minute` past midnight on the day `days` from today's.
        private fun at(now: Long, days: Int, minute: Int): Long = Calendar.getInstance().apply {
            timeInMillis = now
            add(Calendar.DAY_OF_YEAR, days)
            set(Calendar.HOUR_OF_DAY, minute / 60)
            set(Calendar.MINUTE, minute % 60)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }.timeInMillis

        // 0 = Sunday, as in the web app (Date.getDay).
        private fun weekday(at: Long) = Calendar.getInstance().apply { timeInMillis = at }.get(Calendar.DAY_OF_WEEK) - 1

        private fun nextWake(prefs: JSONObject?, now: Long): Long {
            val wake = minutes(prefs?.optString("wake").orEmpty(), 7 * 60)
            return at(now, 0, wake).let { if (it > now) it else at(now, 1, wake) }
        }

        // Where sleep mode is at `now`. A night counts by the day its bedtime falls on.
        fun phase(context: Context, prefs: JSONObject?, now: Long): Phase {
            if (prefs?.optBoolean("on") != true) return Phase(Kind.OFF)
            val s = state(context)
            if (now < s.getLong("upUntil", 0)) return Phase(Kind.OFF)
            val nowUntil = s.getLong("sleepNowUntil", 0)
            if (now < nowUntil) return Phase(Kind.ASLEEP, s.getLong("sleepNowFrom", now), nowUntil, 1f)
            val bed = minutes(prefs.optString("bed"), 23 * 60 + 30)
            val wake = minutes(prefs.optString("wake"), 7 * 60)
            val nights = prefs.optJSONArray("nights")?.let { a -> (0 until a.length()).map { a.getInt(it) }.toSet() } ?: (0..6).toSet()
            for (days in -1..1) {
                val start = at(now, days, bed)
                val end = at(now, days, wake).let { if (it > start) it else at(now, days + 1, wake) }
                if (weekday(start) !in nights) continue
                if (now in start until end) return Phase(Kind.ASLEEP, start, end, 1f)
                if (now in (start - WIND_DOWN_MS) until start) {
                    return Phase(Kind.WIND_DOWN, start, end, (now - (start - WIND_DOWN_MS)).toFloat() / WIND_DOWN_MS)
                }
            }
            return Phase(Kind.OFF)
        }

        fun phase(context: Context, now: Long = System.currentTimeMillis()) = phase(context, sleepPrefs(context), now)

        // Sleep now: straight away, until the next wake time.
        fun sleepNow(context: Context, now: Long = System.currentTimeMillis()) {
            state(context).edit()
                .putLong("sleepNowFrom", now)
                .putLong("sleepNowUntil", nextWake(sleepPrefs(context), now))
                .putLong("upUntil", 0)
                .putLong("snoozeUntil", 0)
                .putLong("lastReminder", 0)
                .apply()
        }

        // I'm up: tonight's sleep mode ends (wind-down included), back tomorrow night.
        fun imUp(context: Context, now: Long = System.currentTimeMillis()) {
            val phase = phase(context, now)
            state(context).edit()
                .putLong("upUntil", if (phase.kind == Kind.OFF) 0 else phase.end)
                .putLong("sleepNowUntil", 0)
                .apply()
        }

        // 10 more minutes: no reminders for a while; the filter stays.
        fun more(context: Context, now: Long = System.currentTimeMillis()) {
            state(context).edit().putLong("snoozeUntil", now + MORE_MS).apply()
        }
    }
}

// I'm up and 10 more minutes on the reminder. Only Loci's own notification reaches it.
class SleepReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            SleepMode.ACTION_UP -> SleepMode.imUp(context)
            SleepMode.ACTION_MORE -> SleepMode.more(context)
            else -> return
        }
        NotificationManagerCompat.from(context).cancel(SleepMode.NOTIFICATION_ID)
        WatchService.refresh()
    }
}
