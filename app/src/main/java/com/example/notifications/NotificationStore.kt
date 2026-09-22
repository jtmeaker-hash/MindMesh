package com.example.notifications

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** A reminder notification handed to Android for delivery. */
data class ScheduledNotification(
    val id: String,
    val title: String,
    val body: String,
    val triggerAtMillis: Long,
    val sound: Boolean,
    val vibration: Boolean,
    val kind: String = "reminder",
    val actionKind: String = "reminder",
    val priority: String = "high",
    val actions: List<String> = listOf("complete", "snooze", "open"),
    val ongoing: Boolean = false
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("title", title)
        put("body", body)
        put("triggerAt", triggerAtMillis)
        put("sound", sound)
        put("vibration", vibration)
        put("kind", kind)
        put("actionKind", actionKind)
        put("priority", priority)
        put("actions", JSONArray().apply { actions.forEach { put(it) } })
        put("ongoing", ongoing)
    }

    companion object {
        fun fromJson(obj: JSONObject): ScheduledNotification? {
            val id = obj.optString("id", "")
            if (id.isEmpty()) return null
            return ScheduledNotification(
                id = id,
                title = obj.optString("title", "MindMesh reminder"),
                body = obj.optString("body", ""),
                triggerAtMillis = obj.optLong("triggerAt", 0L),
                sound = obj.optBoolean("sound", true),
                vibration = obj.optBoolean("vibration", true),
                kind = obj.optString("kind", "reminder"),
                actionKind = obj.optString("actionKind", "reminder"),
                priority = obj.optString("priority", "high"),
                actions = obj.optJSONArray("actions")?.let { array -> (0 until array.length()).mapNotNull { index -> array.optString(index, "").takeIf { it.isNotEmpty() } } } ?: listOf("complete", "snooze", "open"),
                ongoing = obj.optBoolean("ongoing", false)
            )
        }
    }
}

/** A notification action the WebView still needs to process. */
data class PendingNotificationAction(val reminderId: String, val action: String)

/**
 * Persists scheduled notifications so alarms survive app restarts, and queues
 * events that must be handed back to the WebView once it is ready to receive them.
 *
 * SharedPreferences is used deliberately: no new dependency is required and the
 * payload is tiny (ids plus short titles).
 */
object NotificationStore {
    private const val PREFS = "mindmesh_notifications"
    private const val KEY_SCHEDULED = "scheduled"
    private const val KEY_DELIVERED = "delivered"
    private const val KEY_ACTIONS = "pending_actions"

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    @Synchronized
    fun all(context: Context): List<ScheduledNotification> {
        val raw = prefs(context).getString(KEY_SCHEDULED, null) ?: return emptyList()
        val items = mutableListOf<ScheduledNotification>()
        try {
            val array = JSONArray(raw)
            for (index in 0 until array.length()) {
                val obj = array.optJSONObject(index) ?: continue
                ScheduledNotification.fromJson(obj)?.let { items.add(it) }
            }
        } catch (_: Exception) {
            // Corrupted store: treat as empty rather than crashing the app.
            return emptyList()
        }
        return items
    }

    @Synchronized
    fun put(context: Context, item: ScheduledNotification) {
        val items = all(context).filterNot { it.id == item.id } + item
        write(context, items)
    }

    @Synchronized
    fun remove(context: Context, id: String) {
        val items = all(context).filterNot { it.id == id }
        write(context, items)
    }

    @Synchronized
    fun clear(context: Context) {
        write(context, emptyList())
    }

    @Synchronized
    fun count(context: Context): Int = all(context).size

    private fun write(context: Context, items: List<ScheduledNotification>) {
        val array = JSONArray()
        items.forEach { array.put(it.toJson()) }
        prefs(context).edit().putString(KEY_SCHEDULED, array.toString()).apply()
    }

    /** Records that Android actually showed a notification. */
    @Synchronized
    fun queueDelivered(context: Context, id: String) {
        val array = readArray(context, KEY_DELIVERED)
        array.put(id)
        prefs(context).edit().putString(KEY_DELIVERED, array.toString()).apply()
    }

    /** Returns and clears notifications delivered since the WebView last looked. */
    @Synchronized
    fun takeDelivered(context: Context): List<String> {
        val array = readArray(context, KEY_DELIVERED)
        val ids = mutableListOf<String>()
        for (index in 0 until array.length()) {
            val value = array.optString(index, "")
            if (value.isNotEmpty()) ids.add(value)
        }
        prefs(context).edit().remove(KEY_DELIVERED).apply()
        return ids
    }

    /** Queues an action (open / complete / snooze) for the WebView. */
    @Synchronized
    fun queueAction(context: Context, reminderId: String, action: String) {
        val array = readArray(context, KEY_ACTIONS)
        array.put(JSONObject().put("reminderId", reminderId).put("action", action))
        prefs(context).edit().putString(KEY_ACTIONS, array.toString()).apply()
    }

    @Synchronized
    fun takeActions(context: Context): List<PendingNotificationAction> {
        val array = readArray(context, KEY_ACTIONS)
        val actions = mutableListOf<PendingNotificationAction>()
        for (index in 0 until array.length()) {
            val obj = array.optJSONObject(index) ?: continue
            val reminderId = obj.optString("reminderId", "")
            if (reminderId.isEmpty()) continue
            actions.add(PendingNotificationAction(reminderId, obj.optString("action", "open")))
        }
        prefs(context).edit().remove(KEY_ACTIONS).apply()
        return actions
    }

    private fun readArray(context: Context, key: String): JSONArray {
        val raw = prefs(context).getString(key, null) ?: return JSONArray()
        return try {
            JSONArray(raw)
        } catch (_: Exception) {
            JSONArray()
        }
    }
}
