package io.github.amaasprilla.loci

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

// Alarms don't survive a restart and drift when the clock or time zone changes: set the
// reminder alarm again (and show any missed in the last 2 hours). Only the system can send
// these, which is why this receiver is open to outside broadcasts and ReminderReceiver isn't.
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action in SYSTEM_EVENTS) Reminders.fire(context)
    }

    private companion object {
        val SYSTEM_EVENTS = setOf(
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            Intent.ACTION_TIME_CHANGED,
            Intent.ACTION_TIMEZONE_CHANGED,
        )
    }
}
