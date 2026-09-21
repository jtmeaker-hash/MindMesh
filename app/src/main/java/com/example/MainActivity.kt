package com.example

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.ValueCallback
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.webkit.WebViewAssetLoader
import com.example.backup.MindMeshBackupBridge
import com.example.notifications.MainActivityIntent
import com.example.notifications.MindMeshNotificationBridge
import com.example.notifications.NotificationChannels
import com.example.notifications.NotificationPermissionCoordinator
import com.example.notifications.NotificationScheduler
import com.example.notifications.NotificationStore
import com.example.ui.theme.MyApplicationTheme

class MainActivity : ComponentActivity() {
  private var notificationBridge: MindMeshNotificationBridge? = null
  private var backupBridge: MindMeshBackupBridge? = null
  private var webViewRef: WebView? = null

  /** Declared as a field so it is registered before the activity is started. */
  private val notificationPermissionLauncher =
    registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
      notificationBridge?.emitPermission(if (granted) "granted" else "denied")
    }

  /**
   * Backup export goes through the system document picker. The result carries the
   * URI the user chose, which is then written to and verified natively.
   */
  private val backupSaveLauncher =
    registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
      backupBridge?.handleActivityResult(result.resultCode, result.data)
    }

  /**
   * Restore needs the reverse: a `<input type="file">` inside the WebView only
   * works when `onShowFileChooser` is implemented, otherwise tapping "Choose
   * MindMesh Backup File" does nothing at all.
   */
  private var pendingFileChooser: ValueCallback<Array<Uri>>? = null

  private val fileChooserLauncher =
    registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
      val callback = pendingFileChooser
      pendingFileChooser = null
      if (callback != null) {
        callback.onReceiveValue(
          WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
        )
      }
    }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    enableEdgeToEdge()

    // Create the channel up front so the user sees it before the first reminder,
    // then re-register anything that survived a reboot or an app update.
    NotificationChannels.ensure(this)
    NotificationScheduler.rescheduleAll(this)

    val bridge = MindMeshNotificationBridge(this) { webViewRef }
    notificationBridge = bridge
    backupBridge = MindMeshBackupBridge(this, { webViewRef }, { backupSaveLauncher })

    // Only an Activity can start the runtime permission flow, so the bridge defers to us.
    NotificationPermissionCoordinator.request = {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        val granted = ContextCompat.checkSelfPermission(
          this,
          Manifest.permission.POST_NOTIFICATIONS
        ) == PackageManager.PERMISSION_GRANTED
        if (granted) bridge.emitPermission("granted")
        else notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
      } else {
        val enabled = NotificationManagerCompat.from(this).areNotificationsEnabled()
        bridge.emitPermission(if (enabled) "granted" else "denied")
      }
    }

    // A notification may have launched the app: queue its action for the WebView.
    handleNotificationIntent(intent)

    setContent {
      MyApplicationTheme {
        MindMeshApp(
          notificationBridge = bridge,
          backupBridge = backupBridge,
          onWebViewReady = { web ->
            webViewRef = web
            flushPendingNotificationEvents()
          }
        )
      }
    }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    handleNotificationIntent(intent)
    flushPendingNotificationEvents()
  }

  override fun onResume() {
    super.onResume()
    // The user may have changed permissions in system settings while away.
    notificationBridge?.emitPermission(notificationBridge?.getPermissionState() ?: "default")
    flushPendingNotificationEvents()
  }

  private fun handleNotificationIntent(intent: Intent?) {
    val reminderId = intent?.getStringExtra(MainActivityIntent.EXTRA_REMINDER_ID)
    if (reminderId.isNullOrEmpty()) return
    val action = intent.getStringExtra(MainActivityIntent.EXTRA_ACTION)
      ?: MainActivityIntent.ACTION_OPEN
    NotificationStore.queueAction(this, reminderId, action)
  }

  /** Hands queued delivered/opened/action events to the WebView. */
  private fun flushPendingNotificationEvents() {
    val bridge = notificationBridge ?: return
    NotificationStore.takeDelivered(this).forEach { bridge.emitDelivered(it) }
    NotificationStore.takeActions(this).forEach { pending ->
      if (pending.action == MainActivityIntent.ACTION_OPEN) {
        bridge.emitOpened(pending.reminderId)
      } else {
        bridge.emitAction(pending.reminderId, pending.action)
      }
    }
  }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun MindMeshApp(
  notificationBridge: MindMeshNotificationBridge?,
  backupBridge: MindMeshBackupBridge? = null,
  onWebViewReady: (WebView) -> Unit
) {
  var webViewInstance by remember { mutableStateOf<WebView?>(null) }

  BackHandler(enabled = webViewInstance?.canGoBack() == true) {
    webViewInstance?.goBack()
  }

  Box(
    modifier = Modifier
      .fillMaxSize()
      .background(androidx.compose.ui.graphics.Color(0xFF080B12))
      .statusBarsPadding()
      .navigationBarsPadding()
      .testTag("mindmesh_canvas")
  ) {
    AndroidView(
      modifier = Modifier.fillMaxSize(),
      factory = { context ->
        val assetLoader = WebViewAssetLoader.Builder()
          .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
          .build()

        WebView(context).apply {
          layoutParams = ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
          )
          setBackgroundColor(Color.parseColor("#080B12"))

          settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            allowFileAccessFromFileURLs = true
            allowUniversalAccessFromFileURLs = true
            useWideViewPort = true
            loadWithOverviewMode = true
            setSupportZoom(false)
            cacheMode = WebSettings.LOAD_DEFAULT
          }

          // Native reminder notifications: exposed as window.MindMeshNotifications.
          notificationBridge?.let { addJavascriptInterface(it, "MindMeshNotifications") }

          // Native backup export: exposed as window.MindMeshBackup.
          backupBridge?.let { addJavascriptInterface(it, "MindMeshBackup") }

          webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
              view: WebView?,
              request: WebResourceRequest?
            ): WebResourceResponse? {
              val uri = request?.url ?: return null
              if (uri.path?.endsWith("favicon.ico") == true) {
                return WebResourceResponse("image/x-icon", "UTF-8", java.io.ByteArrayInputStream(ByteArray(0)))
              }
              return assetLoader.shouldInterceptRequest(uri)
            }

            override fun onPageFinished(view: WebView?, url: String?) {
              super.onPageFinished(view, url)
              // The web layer is ready to receive queued notification events.
              onWebViewReady(this@apply)
            }

            override fun onReceivedError(
              view: WebView?,
              request: WebResourceRequest?,
              error: WebResourceError?
            ) {
              super.onReceivedError(view, request, error)
              val path = request?.url?.path.orEmpty()
              if (!path.endsWith("favicon.ico")) {
                Log.e(
                  "MindMeshWebView",
                  "Load error on ${request?.url}: ${error?.description} (code: ${error?.errorCode})"
                )
              }
            }
          }

          webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
              webView: WebView?,
              filePathCallback: ValueCallback<Array<Uri>>?,
              fileChooserParams: WebChromeClient.FileChooserParams?
            ): Boolean {
              if (filePathCallback == null) return false

              // A second request supersedes the first; never leave one hanging.
              pendingFileChooser?.onReceiveValue(null)
              pendingFileChooser = filePathCallback

              val intent = fileChooserParams?.createIntent()
                ?: Intent(Intent.ACTION_GET_CONTENT).apply { type = "*/*" }

              return try {
                fileChooserLauncher.launch(intent)
                true
              } catch (err: Exception) {
                Log.e("MindMeshWebView", "Could not open the file picker", err)
                pendingFileChooser = null
                filePathCallback.onReceiveValue(null)
                false
              }
            }

            override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
              Log.d(
                "MindMeshWebConsole",
                "[${consoleMessage?.messageLevel()}] ${consoleMessage?.message()} (${consoleMessage?.sourceId()}:${consoleMessage?.lineNumber()})"
              )
              return true
            }
          }

          loadUrl("https://appassets.androidplatform.net/assets/web/index.html")
          webViewInstance = this
        }
      },
      update = {
        webViewInstance = it
        onWebViewReady(it)
      }
    )
  }
}
