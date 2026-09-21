package com.example.backup

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.result.ActivityResultLauncher
import java.util.ArrayDeque

/**
 * Exposed to the WebView as `window.MindMeshBackup`.
 *
 * The web layer cannot write to the Android filesystem on its own: an anchor
 * `download` with a `blob:` URL is ignored by WebView, which is why exports
 * appeared to succeed while no file was ever created. This bridge opens the
 * system document picker (`ACTION_CREATE_DOCUMENT`), writes the JSON the user
 * confirmed through `ContentResolver`, verifies the written document, and only
 * then pushes a success event back into the page.
 */
class MindMeshBackupBridge(
    private val context: Context,
    private val webViewProvider: () -> WebView?,
    private val launcherProvider: () -> ActivityResultLauncher<Intent>?
) {
    private val mainHandler = Handler(Looper.getMainLooper())

    /** Saves are queued because the picker is a single-slot activity result. */
    private val pending = ArrayDeque<PendingSave>()

    private data class PendingSave(val requestId: String, val filename: String, val content: String)

    @JavascriptInterface
    fun isSupported(): Boolean = true

    /**
     * @return false when the picker could not be started, in which case the web
     *   layer falls back to its own download path instead of silently failing.
     */
    @JavascriptInterface
    fun saveFile(requestId: String, filename: String, content: String): Boolean {
        if (requestId.isEmpty()) return false

        mainHandler.post {
            val launcher = launcherProvider()
            if (launcher == null) {
                emitResult(requestId, false, "The Android save dialog is unavailable")
                return@post
            }

            pending.addLast(PendingSave(requestId, filename, content))

            val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "application/json"
                putExtra(Intent.EXTRA_TITLE, filename.ifEmpty { "mindmesh-backup.json" })
            }

            try {
                launcher.launch(intent)
            } catch (err: Exception) {
                pending.pollLast()
                Log.e(TAG, "Could not launch the document picker", err)
                emitResult(requestId, false, "Could not open the Android save dialog")
            }
        }

        return true
    }

    /** Called by the Activity when the document picker returns. */
    fun handleActivityResult(resultCode: Int, data: Intent?) {
        val save = pending.pollFirst() ?: return

        if (resultCode != Activity.RESULT_OK) {
            Log.i(TAG, "Backup export cancelled at the document picker")
            emitResult(save.requestId, false, "Export cancelled — no file was written.")
            return
        }

        val uri: Uri? = data?.data
        if (uri == null) {
            emitResult(save.requestId, false, "No save location was returned by Android")
            return
        }

        writeToUri(save, uri)
    }

    private fun writeToUri(save: PendingSave, uri: Uri) {
        // Writing to a document provider can block; keep it off the main thread so
        // the WebView never freezes while a large backup is flushed.
        Thread {
            val payload = save.content.toByteArray(Charsets.UTF_8)
            try {
                val stream = context.contentResolver.openOutputStream(uri, "wt")
                    ?: throw IllegalStateException("Android could not open the chosen file for writing")

                stream.use {
                    it.write(payload)
                    it.flush()
                }

                val written = documentSize(uri)
                if (written >= 0 && written != payload.size.toLong()) {
                    // The provider accepted the stream but the document does not hold
                    // the whole backup, so this is a failure, not a success.
                    emitResult(
                        save.requestId,
                        false,
                        "Android wrote $written bytes but the backup is ${payload.size} bytes"
                    )
                } else {
                    Log.i(TAG, "Backup written: ${save.filename} ($written bytes)")
                    emitResult(save.requestId, true, "Saved ${save.filename}")
                }
            } catch (err: Exception) {
                Log.e(TAG, "Writing the backup document failed", err)
                emitResult(save.requestId, false, err.message ?: "Writing the backup file failed")
            }
        }.start()
    }

    /** @return the provider-reported size, or -1 when the provider does not expose one. */
    private fun documentSize(uri: Uri): Long {
        return try {
            context.contentResolver.openFileDescriptor(uri, "r")?.use { it.statSize } ?: -1L
        } catch (_: Exception) {
            -1L
        }
    }

    /**
     * Callbacks cannot be registered through @JavascriptInterface, so results are
     * pushed onto a global the web layer installs before it starts a save.
     */
    private fun emitResult(requestId: String, ok: Boolean, message: String) {
        val script =
            "$EVENTS.onResult('${escape(requestId)}', $ok, '${escape(message)}')"
        mainHandler.post {
            try {
                webViewProvider()?.evaluateJavascript(script, null)
            } catch (_: Exception) {
                // The WebView can be gone during teardown; the web layer's timeout
                // then reports the failure instead of hanging.
            }
        }
    }

    private fun escape(value: String): String = value
        .replace("\\", "\\\\")
        .replace("'", "\\'")
        .replace("\n", " ")
        .replace("\r", " ")

    private companion object {
        const val TAG = "MindMeshBackupBridge"

        /** Guarded so a partially loaded page cannot throw on an early result. */
        const val EVENTS =
            "window.MindMeshNativeBackupEvents && window.MindMeshNativeBackupEvents"
    }
}
