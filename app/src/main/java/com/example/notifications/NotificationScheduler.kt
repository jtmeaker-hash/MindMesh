package com.example.notifications

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/**
 * Notification channels. A single channel keeps the user-facing settings simple.
 */
object NotificationChannels {
    const val REMINDERS = "mindmesh-reminders"

    fun ensure(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
        if (manager.getNotificationChannel(REMINDERS) != null) return
        val channel = NotificationChannel(
            REMINDERS,
            "Reminder notifications",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "Scheduled MindMesh reminder alerts"
            enableVibration(true)
        }
        manager.createNotificationChannel(channel)
    }
}

/**
 * Schedules reminder notifications with AlarmManager.
 *
 * Inexact (`setAndAllowWhileIdle`) alarms are used on purpose: exact alarms would
 * require the SCHEDULE_EXACT_ALARM permission, which is not needed for reminders.
 * The trade-off is that Android may delay delivery slightly in battery-saver mode.
 * Alarms are mirrored into [NotificationStore] so they survive process death and
 * can be re-registered after a reboot.
 */
object NotificationScheduler {
    const val ACTION_FIRE = "com.example.notifications.ACTION_FIRE_REMINDER"

    fun requestCode(id: String): Int = id.hashCode()

    private fun alarmManager(context: Context): AlarmManager? =
        context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager

    private fun firePendingIntent(context: Context, item: ScheduledNotification): PendingIntent {
        val intent = Intent(context, NotificationReceiver::class.java).apply {
            action = ACTION_FIRE
            putExtra(NotificationReceiver.EXTRA_ID, item.id)
            putExtra(NotificationReceiver.EXTRA_TITLE, item.title)
            putExtra(NotificationReceiver.EXTRA_BODY, item.body)
            putExtra(NotificationReceiver.EXTRA_SOUND, item.sound)
            putExtra(NotificationReceiver.EXTRA_VIBRATION, item.vibration)
        }
        return PendingIntent.getBroadcast(
            context,
            requestCode(item.id),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun cancelPendingIntent(context: Context, id: String): PendingIntent {
        val intent = Intent(context, NotificationReceiver::class.java).apply { action = ACTION_FIRE }
        return PendingIntent.getBroadcast(
            context,
            requestCode(id),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    /** Registers (or replaces) one notification. Returns false if Android refused it. */
    fun schedule(context: Context, item: ScheduledNotification): Boolean {
        NotificationChannels.ensure(context)
        val manager = alarmManager(context) ?: return false
        // Immediate triggers are pushed a moment out so the alarm is not dropped.
        val triggerAt = maxOf(item.triggerAtMillis, System.currentTimeMillis() + 1000L)
        return try {
            manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, firePendingIntent(context, item))
            NotificationStore.put(context, item)
            true
        } catch (_: SecurityException) {
            try {
                manager.set(AlarmManager.RTC_WAKEUP, triggerAt, firePendingIntent(context, item))
                NotificationStore.put(context, item)
                true
            } catch (_: Exception) {
                false
            }
        } catch (_: Exception) {
            false
        }
    }

    fun cancel(context: Context, id: String) {
        try {
            alarmManager(context)?.cancel(cancelPendingIntent(context, id))
        } catch (_: Exception) {
            // Cancelling a missing alarm is harmless.
        }
        NotificationStore.remove(context, id)
    }

    fun cancelAll(context: Context) {
        NotificationStore.all(context).forEach { cancel(context, it.id) }
    }

    /**
     * Re-registers every stored notification. Called after a reboot, an app update
     * and on app start, so scheduled reminders survive normal restarts.
     */
    fun rescheduleAll(context: Context) {
        NotificationChannels.ensure(context)
        NotificationStore.all(context).forEach { item ->
            val manager = alarmManager(context) ?: return
            val triggerAt = maxOf(item.triggerAtMillis, System.currentTimeMillis() + 1000L)
            try {
                manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, firePendingIntent(context, item))
            } catch (_: Exception) {
                // Leave the entry in the store so a later launch can retry.
            }
        }
    }
}

/**
 * Fires a scheduled reminder notification and offers in-notification actions.
 * Actions are routed back to the WebView, which owns the reminder data.
 */
class NotificationReceiver : BroadcastReceiver() {
    companion object {
        const val EXTRA_ID = "mindmesh_notification_id"
        const val EXTRA_TITLE = "mindmesh_notification_title"
        const val EXTRA_BODY = "mindmesh_notification_body"
        const val EXTRA_SOUND = "mindmesh_notification_sound"
        const val EXTRA_VIBRATION = "mindmesh_notification_vibration"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getStringExtra(EXTRA_ID) ?: return
        val title = intent.getStringExtra(EXTRA_TITLE) ?: "MindMesh reminder"
        val body = intent.getStringExtra(EXTRA_BODY) ?: ""
        val sound = intent.getBooleanExtra(EXTRA_SOUND, true)
        val vibration = intent.getBooleanExtra(EXTRA_VIBRATION, true)

        if (!canPostNotifications(context)) return

        NotificationChannels.ensure(context)
        NotificationStore.remove(context, id)
        NotificationStore.queueDelivered(context, id)

        val openIntent = MainActivityIntent.build(context, id, MainActivityIntent.ACTION_OPEN)

        val builder = NotificationCompat.Builder(context, NotificationChannels.REMINDERS)
            .setSmallIcon(android.R.drawable.ic_popup_reminder)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setContentIntent(openIntent)
            .addAction(0, "Mark Complete", MainActivityIntent.build(context, id, MainActivityIntent.ACTION_COMPLETE))
            .addAction(0, "Snooze", MainActivityIntent.build(context, id, MainActivityIntent.ACTION_SNOOZE))
            .addAction(0, "Open Reminder", openIntent)

        if (!sound) builder.setSilent(true)
        if (vibration) builder.setVibrate(longArrayOf(0L, 250L, 150L, 250L))

        try {
            NotificationManagerCompat.from(context)
                .notify(NotificationScheduler.requestCode(id), builder.build())
        } catch (_: Exception) {
            // Posting can legitimately fail if the user revoked permission mid-flight.
        }
    }

    private fun canPostNotifications(context: Context): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
            if (!granted) return false
        }
        return NotificationManagerCompat.from(context).areNotificationsEnabled()
    }
}

/** Re-registers stored notifications after a reboot or an app update. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            "android.intent.action.QUICKBOOT_POWERON" -> {
                NotificationChannels.ensure(context)
                NotificationScheduler.rescheduleAll(context)
            }
        }
    }
}
