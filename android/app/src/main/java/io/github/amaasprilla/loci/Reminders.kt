package io.github.amaasprilla.loci

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONArray
import org.json.JSONObject

// To-do reminders and the daily summary (SPEC-v6-android.md, "Notifications"). The web app
// works out what to remind and when, and sends the whole list for the next 7 days each
// time something changes (Bridge "schedule"). This keeps it, sets one alarm for the
// earliest, and when that goes off shows what's due and sets the next.
//
// Done and In 1 hour work with Loci closed: Done is queued for the web app to apply when it
// next opens (Bridge "takeActions"); In 1 hour shows the same reminder again an hour later.
object Reminders {
    private const val PREFS = "reminders"
    private const val LATE_LIMIT_MS = 2 * 3_600_000L // a reminder missed by more (phone off) isn't shown late
    private const val SNOOZE_MS = 3_600_000L
    const val CHANNEL_TODOS = "todos"
    const val CHANNEL_SUMMARY = "summary"
    const val ACTION_FIRE = "io.github.amaasprilla.loci.FIRE"
    const val ACTION_DONE = "io.github.amaasprilla.loci.DONE"
    const val ACTION_SNOOZE = "io.github.amaasprilla.loci.SNOOZE"
    const val EXTRA_OPEN_TODO = "openTodo"
    const val EXTRA_OPEN_HOME = "openHome"
    private const val SUMMARY_TAG = "summary"

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private fun array(context: Context, key: String) = JSONArray(prefs(context).getString(key, "[]"))
    private fun JSONArray.objects() = (0 until length()).map { getJSONObject(it) }

    // `schedule`: { reminders: [{ key, at, kind: "todo" | "summary", title, body, todoId?, occurrenceAt? }],
    // pending: { todoId: occurrenceAt } } — every open to-do with a time and the occurrence it's on.
    fun replace(context: Context, schedule: JSONObject) {
        val pending = schedule.getJSONObject("pending")
        val stillOpen = { r: JSONObject -> pending.optLong(r.getString("todoId"), -1) == r.getLong("occurrenceAt") }
        // A snooze lasts while its to-do is still open on that occurrence.
        val snoozes = JSONArray(array(context, "snoozes").objects().filter(stillOpen))
        prefs(context).edit()
            .putString("schedule", schedule.getJSONArray("reminders").toString())
            .putString("snoozes", snoozes.toString())
            .apply()
        // A reminder showing for a to-do that's been done (here or on another device) goes.
        val manager = context.getSystemService(NotificationManager::class.java)
        for (shown in manager.activeNotifications) {
            val todoId = shown.tag ?: continue
            if (todoId == SUMMARY_TAG) continue
            if (pending.optLong(todoId, -1) != shown.notification.extras.getLong("occurrenceAt")) manager.cancel(todoId, 0)
        }
        armNext(context)
    }

    // The alarm went off (or the phone restarted): show what's due, then set the next alarm.
    fun fire(context: Context, now: Long = System.currentTimeMillis()) {
        val p = prefs(context)
        val since = maxOf(p.getLong("lastFired", 0), now - LATE_LIMIT_MS)
        val all = array(context, "schedule").objects() + array(context, "snoozes").objects()
        val due = all.filter { it.getLong("at") in (since + 1)..(now + 1_000) }
        due.forEach { show(context, it) }
        val snoozes = JSONArray(array(context, "snoozes").objects().filter { it.getLong("at") > now + 1_000 })
        p.edit()
            .putLong("lastFired", maxOf(now, due.maxOfOrNull { it.getLong("at") } ?: 0))
            .putString("snoozes", snoozes.toString())
            .apply()
        armNext(context)
    }

    private fun armNext(context: Context) {
        val after = prefs(context).getLong("lastFired", 0)
        val next = (array(context, "schedule").objects() + array(context, "snoozes").objects())
            .map { it.getLong("at") }.filter { it > after }.minOrNull()
        val alarms = context.getSystemService(AlarmManager::class.java)
        val intent = PendingIntent.getBroadcast(
            context, 0, Intent(context, ReminderReceiver::class.java).setAction(ACTION_FIRE),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        if (next == null) return alarms.cancel(intent)
        // Exact, so a 10:00 reminder comes at 10:00, even in battery saving (Doze).
        if (Build.VERSION.SDK_INT < 31 || alarms.canScheduleExactAlarms()) {
            alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, intent)
        } else {
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, intent)
        }
    }

    fun exactAlarmsAllowed(context: Context) =
        Build.VERSION.SDK_INT < 31 || context.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()

    private fun channels(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL_TODOS, "To-do reminders", NotificationManager.IMPORTANCE_HIGH))
        manager.createNotificationChannel(NotificationChannel(CHANNEL_SUMMARY, "Daily summary", NotificationManager.IMPORTANCE_DEFAULT))
    }

    private fun show(context: Context, r: JSONObject) {
        val manager = NotificationManagerCompat.from(context)
        if (!manager.areNotificationsEnabled()) return
        channels(context)
        val summary = r.getString("kind") == "summary"
        val todoId = r.optString("todoId")
        val tap = Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            .apply { if (summary) putExtra(EXTRA_OPEN_HOME, true) else putExtra(EXTRA_OPEN_TODO, todoId) }
        val builder = NotificationCompat.Builder(context, if (summary) CHANNEL_SUMMARY else CHANNEL_TODOS)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(r.getString("title"))
            .setContentText(r.optString("body"))
            .setStyle(NotificationCompat.BigTextStyle().bigText(r.optString("body")))
            .setWhen(r.getLong("at"))
            .setShowWhen(true)
            .setAutoCancel(true)
            .setContentIntent(PendingIntent.getActivity(context, "open$todoId".hashCode(), tap, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
        if (!summary) {
            builder.setCategory(NotificationCompat.CATEGORY_REMINDER)
                .addExtras(android.os.Bundle().apply { putLong("occurrenceAt", r.getLong("occurrenceAt")) })
                .addAction(0, "Done", actionIntent(context, ACTION_DONE, r))
                .addAction(0, "In 1 hour", actionIntent(context, ACTION_SNOOZE, r))
        }
        try {
            manager.notify(if (summary) SUMMARY_TAG else todoId, 0, builder.build())
        } catch (_: SecurityException) {
            // Notifications were switched off between the check and here.
        }
    }

    private fun actionIntent(context: Context, action: String, r: JSONObject): PendingIntent {
        val intent = Intent(context, ReminderReceiver::class.java).setAction(action).putExtra("reminder", r.toString())
        return PendingIntent.getBroadcast(context, "$action${r.getString("todoId")}".hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    fun done(context: Context, r: JSONObject) {
        NotificationManagerCompat.from(context).cancel(r.getString("todoId"), 0)
        queue(context, JSONObject().put("type", "done").put("id", r.getString("todoId")).put("occurrenceAt", r.getLong("occurrenceAt")).put("at", System.currentTimeMillis()))
        val snoozes = JSONArray(array(context, "snoozes").objects().filter { it.getString("todoId") != r.getString("todoId") })
        prefs(context).edit().putString("snoozes", snoozes.toString()).apply()
        armNext(context)
    }

    fun snooze(context: Context, r: JSONObject) {
        NotificationManagerCompat.from(context).cancel(r.getString("todoId"), 0)
        val again = JSONObject(r.toString()).put("key", "snooze:${r.getString("todoId")}").put("at", System.currentTimeMillis() + SNOOZE_MS)
        val snoozes = array(context, "snoozes").objects().filter { it.getString("todoId") != r.getString("todoId") } + again
        prefs(context).edit().putString("snoozes", JSONArray(snoozes).toString()).apply()
        armNext(context)
    }

    // What happened while the web app wasn't looking: Done taps and notification taps.
    fun queue(context: Context, action: JSONObject) {
        prefs(context).edit().putString("actions", array(context, "actions").put(action).toString()).apply()
    }

    fun takeActions(context: Context): JSONArray {
        val actions = array(context, "actions")
        prefs(context).edit().remove("actions").apply()
        return actions
    }
}
