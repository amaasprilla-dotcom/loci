package io.github.amaasprilla.loci

import android.accessibilityservice.AccessibilityServiceInfo
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.view.accessibility.AccessibilityManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

// Phones sometimes switch an accessibility service off (a crash, an update, a cleanup).
// When Loci opens, and once a day, this checks: if the timer or sleep mode is on but WatchService isn't
// running, a notification says so and opens the Accessibility screen (SPEC-v6, "Watchdog").
object Watchdog {
    private const val CHANNEL = "watchdog"
    private const val NOTIFICATION_ID = 3
    const val ACTION_CHECK = "io.github.amaasprilla.loci.WATCHDOG"

    fun serviceRunning(context: Context): Boolean =
        context.getSystemService(AccessibilityManager::class.java)
            .getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK)
            .any { it.resolveInfo.serviceInfo.packageName == context.packageName }

    private fun needed(context: Context) = WatchService.phonePrefs(context).let { phone ->
        listOf("timer", "sleep").any { phone.optJSONObject(it)?.optBoolean("on") == true }
    }

    // Sets the daily check (again: alarms don't survive a restart) and checks now.
    fun arm(context: Context) {
        val intent = PendingIntent.getBroadcast(
            context, 0, Intent(context, WatchdogReceiver::class.java).setAction(ACTION_CHECK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        context.getSystemService(AlarmManager::class.java).setInexactRepeating(
            AlarmManager.RTC, System.currentTimeMillis() + AlarmManager.INTERVAL_DAY, AlarmManager.INTERVAL_DAY, intent,
        )
        check(context)
    }

    // `quiet`: only take the notice away (Settings → Phone shows the Accessibility line itself).
    fun check(context: Context, quiet: Boolean = false) {
        if (!needed(context) || serviceRunning(context)) return cancelNotice(context)
        if (quiet) return
        val manager = NotificationManagerCompat.from(context)
        if (!manager.areNotificationsEnabled()) return
        context.getSystemService(NotificationManager::class.java)
            .createNotificationChannel(NotificationChannel(CHANNEL, "Timer or sleep mode switched off", NotificationManager.IMPORTANCE_DEFAULT))
        val open = PendingIntent.getActivity(
            context, NOTIFICATION_ID, Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notice = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Loci's timer and sleep mode are switched off")
            .setContentText("Tap, then switch Loci on in Accessibility.")
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        try {
            manager.notify(NOTIFICATION_ID, notice)
        } catch (_: SecurityException) {
        }
    }

    fun cancelNotice(context: Context) = NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
}

// The daily check. Only Loci's own alarm reaches it.
class WatchdogReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Watchdog.ACTION_CHECK) Watchdog.check(context)
    }
}
