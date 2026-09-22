package com.example.notifications

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.PowerManager
import android.app.AlarmManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.example.MainActivity
import org.json.JSONObject

/**
 * Pending-intent helpers for notifications that open MindMesh and carry the
 * reminder id plus the action the user chose.
 */
object MainActivityIntent {
    const val EXTRA_REMINDER_ID = "mindmesh_reminder_id"
    const val EXTRA_ACTION = "mindmesh_notification_action"

    const val ACTION_OPEN = "open"
    const val ACTION_COMPLETE = "complete"
    const val ACTION_SNOOZE = "snooze"
    const val ACTION_START = "start"
    const val ACTION_SKIP = "skip"
    const val ACTION_FAILED = "failed"

    fun build(context: Context, reminderId: String, action: String): android.app.PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_CLEAR_TOP or
                Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(EXTRA_REMINDER_ID, reminderId)
            putExtra(EXTRA_ACTION, action)
        }
        return android.app.PendingIntent.getActivity(
            context,
            "$reminderId::$action".hashCode(),
            intent,
            android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE
        )
    }
}

/**
 * Lets the Activity supply the runtime-permission flow, which only an Activity can
 * start. The bridge calls this on the main thread.
 */
object NotificationPermissionCoordinator {
    @Volatile
    var request: (() -> Unit)? = null
}

/**
 * JavaScript bridge exposed to the WebView as `window.MindMeshNotifications`.
 *
 * This is what makes the `android-native` notification platform real: scheduling
 * is handed to AlarmManager so notifications fire with the app closed, and events
 * are pushed back into the WebView so the reminder engine's history stays truthful.
 *
 * All methods are safe to call from the WebView's JavaScript thread; anything that
 * touches UI is posted to the main thread.
 */
class MindMeshNotificationBridge(
    private val context: Context,
    private val webViewProvider: () -> WebView?
) {
    private val mainHandler = Handler(Looper.getMainLooper())

    @JavascriptInterface
    fun isSupported(): Boolean = true

    @JavascriptInterface
    fun getPermissionState(): String {
        val enabled = NotificationManagerCompat.from(context).areNotificationsEnabled()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
            return when {
                granted && enabled -> "granted"
                !granted && enabled -> "default"
                else -> "denied"
            }
        }
        return if (enabled) "granted" else "denied"
    }

    @JavascriptInterface
    fun requestPermission() {
        mainHandler.post {
            val requester = NotificationPermissionCoordinator.request
            if (requester != null) {
                requester.invoke()
            } else {
                emitPermission(getPermissionState())
            }
        }
    }

    @JavascriptInterface
    fun schedule(
        id: String,
        title: String,
        body: String,
        triggerAtMillis: Long,
        optionsJson: String
    ): Boolean {
        if (id.isEmpty()) return false

        var sound = true
        var vibration = true
        var kind = "reminder"
        var actionKind = "reminder"
        var priority = "high"
        var actions = listOf("complete", "snooze", "open")
        var ongoing = false
        try {
            val options = JSONObject(optionsJson.ifEmpty { "{}" })
            sound = options.optBoolean("sound", true)
            vibration = options.optBoolean("vibration", true)
            kind = options.optString("kind", "reminder")
            actionKind = options.optString("actionKind", "reminder")
            priority = options.optString("priority", "high")
            ongoing = options.optBoolean("ongoing", false)
            options.optJSONArray("actions")?.let { array -> actions = (0 until array.length()).mapNotNull { index -> array.optString(index, "").takeIf { it.isNotEmpty() } } }
        } catch (_: Exception) {
            // Malformed options fall back to defaults rather than failing.
        }

        val item = ScheduledNotification(
            id = id,
            title = title.ifEmpty { "MindMesh reminder" },
            body = body,
            triggerAtMillis = triggerAtMillis,
            sound = sound,
            vibration = vibration,
            kind = kind,
            actionKind = actionKind,
            priority = priority,
            actions = actions,
            ongoing = ongoing
        )
        return NotificationScheduler.schedule(context, item)
    }

    @JavascriptInterface
    fun cancel(id: String) {
        if (id.isEmpty()) return
        NotificationScheduler.cancel(context, id)
    }

    @JavascriptInterface
    fun cancelAll() {
        NotificationScheduler.cancelAll(context)
    }

    @JavascriptInterface
    fun getScheduledCount(): Int = NotificationStore.count(context)

    @JavascriptInterface
    fun canScheduleExactAlarms(): Boolean = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        (context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager)?.canScheduleExactAlarms() == true
    } else true

    @JavascriptInterface
    fun isIgnoringBatteryOptimizations(): Boolean = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        val power = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
        power?.isIgnoringBatteryOptimizations(context.packageName) == true
    } else true

    @JavascriptInterface
    fun getDiagnosticsJson(): String = JSONObject().apply {
        put("permission", getPermissionState())
        put("scheduledCount", NotificationStore.count(context))
        put("exactAlarms", canScheduleExactAlarms())
        put("batteryOptimizationExempt", isIgnoringBatteryOptimizations())
        put("channelsEnabled", NotificationManagerCompat.from(context).areNotificationsEnabled())
    }.toString()

    @JavascriptInterface
    fun openNotificationSettings() {
        mainHandler.post {
            val appSettings = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                }
            }
            try {
                context.startActivity(appSettings)
                return@post
            } catch (_: ActivityNotFoundException) {
                // Fall through to the generic application details screen.
            } catch (_: Exception) {
                // Fall through.
            }

            try {
                val details = Intent(
                    Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.fromParts("package", context.packageName, null)
                ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(details)
            } catch (_: Exception) {
                // Nothing more can be opened here; the WebView shows instructions.
            }
        }
    }

    /* ---------------- Events pushed into the WebView ---------------- */

    fun emitPermission(state: String) {
        evaluate("$EVENTS.onPermissionResult('${escape(state)}')")
    }

    fun emitDelivered(id: String) {
        evaluate("$EVENTS.onDelivered('${escape(id)}')")
    }

    fun emitOpened(id: String) {
        evaluate("$EVENTS.onOpened('${escape(id)}')")
    }

    fun emitAction(id: String, action: String) {
        evaluate("$EVENTS.onAction('${escape(id)}', '${escape(action)}')")
    }

    private companion object {
        /**
         * Events are pushed to a global the web layer installs. Properties cannot be
         * assigned onto the injected @JavascriptInterface object, so this indirection
         * is required. The guard keeps a partially-loaded page from throwing.
         */
        const val EVENTS =
            "window.MindMeshNativeNotificationEvents && window.MindMeshNativeNotificationEvents"
    }

    private fun escape(value: String): String =
        value.replace("\\", "\\\\").replace("'", "\\'").replace("\n", " ")

    private fun evaluate(script: String) {
        mainHandler.post {
            try {
                webViewProvider()?.evaluateJavascript(script, null)
            } catch (_: Exception) {
                // The WebView may be gone (rotation/teardown); the event stays queued
                // in NotificationStore for the next launch.
            }
        }
    }
}
