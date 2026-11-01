package io.github.amaasprilla.loci

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.json.JSONObject

// The reminder alarm and the Done and In 1 hour buttons. Only Loci's own alarms and
// notifications reach it (not exported); restarts and clock changes go to BootReceiver.
class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val reminder = intent.getStringExtra("reminder")?.let { JSONObject(it) }
        when (intent.action) {
            Reminders.ACTION_DONE -> reminder?.let { Reminders.done(context, it) }
            Reminders.ACTION_SNOOZE -> reminder?.let { Reminders.snooze(context, it) }
            Reminders.ACTION_FIRE -> Reminders.fire(context)
        }
    }
}
