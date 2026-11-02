package io.github.amaasprilla.loci

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.webkit.RenderProcessGoneDetail
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import org.json.JSONObject

// Loci's one screen: a WebView on the Cloudflare address (SPEC-v6-android.md, "Native side").
// Everything Loci shows is the web app; this only fills in what a WebView lacks.
class MainActivity : ComponentActivity() {
    private lateinit var web: WebView
    private lateinit var bridge: Bridge
    private val origin = Uri.parse(BuildConfig.LOCI_URL).let { "${it.scheme}://${it.authority}" }

    private val main = Handler(Looper.getMainLooper())
    private var webGone = false // its page's process ended; the screen is being started again
    private var pendingFiles: ValueCallback<Array<Uri>>? = null
    private val pickFiles = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val data = result.data
        val uris = data?.clipData?.let { clip -> Array(clip.itemCount) { clip.getItemAt(it).uri } }
            ?: WebChromeClient.FileChooserParams.parseResult(result.resultCode, data)
        pendingFiles?.onReceiveValue(if (result.resultCode == RESULT_OK) uris else null)
        pendingFiles = null
    }

    // The notification permission pop-up (Android 13+); Bridge asks for it from Settings → Phone.
    private var onNotificationsAnswered: (() -> Unit)? = null
    private val askNotifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) {
        onNotificationsAnswered?.invoke()
        onNotificationsAnswered = null
    }

    fun requestNotifications(done: () -> Unit) {
        onNotificationsAnswered = done
        askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // With the phone plugged in, Chrome's DevTools can look into the page (chrome://inspect).
        WebView.setWebContentsDebuggingEnabled(true)
        web = WebView(this)
        // A WebView lays its page out over its whole size and ignores its own padding, so the
        // padding goes on a frame around it; the window's grey shows through in the bars.
        val frame = FrameLayout(this).apply { addView(web, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT)) }
        setContentView(frame)
        // The page stays clear of the status bar, the camera, the navigation bar and the keyboard.
        ViewCompat.setOnApplyWindowInsetsListener(frame) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            view.updatePadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            WindowInsetsCompat.CONSUMED
        }

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            // window.open and target="_blank" load in this WebView, where links to other
            // sites are sent on to the browser below.
            setSupportMultipleWindows(false)
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                if ("${url.scheme}://${url.authority}" == origin) return false
                // Only http(s) links leave the app; blob: and data: files go through the bridge.
                if (url.scheme == "http" || url.scheme == "https" || url.scheme == "mailto" || url.scheme == "tel") {
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, url))
                    } catch (_: ActivityNotFoundException) {
                    }
                }
                return true
            }

            // Android ends the page's process to free memory (often with Loci in the background),
            // or it crashed. Unhandled, that would crash the whole app, and the timer and sleep
            // mode with it: start the screen again instead.
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                Problems.record(this@MainActivity, if (detail.didCrash()) "The page crashed" else "Android closed the page to free memory")
                (view.parent as? FrameLayout)?.removeView(view)
                view.destroy()
                if (view === web) {
                    webGone = true
                    recreate()
                }
                return true
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                pendingFiles?.onReceiveValue(null)
                pendingFiles = callback
                val intent = params.createIntent().apply {
                    if (params.mode == FileChooserParams.MODE_OPEN_MULTIPLE) putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                }
                try {
                    pickFiles.launch(intent)
                } catch (_: ActivityNotFoundException) {
                    pendingFiles = null
                    return false
                }
                return true
            }
        }

        bridge = Bridge(this, web, origin)

        // Back first asks the page (close the top sheet, go up a screen); on home it leaves the app.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val noAnswer = Runnable { Problems.record(this@MainActivity, "Back got no answer from the page in 3 s") }
                main.postDelayed(noAnswer, 3_000)
                web.evaluateJavascript("window.lociBack ? window.lociBack() : false") { handled ->
                    main.removeCallbacks(noAnswer)
                    if (handled != "true") {
                        isEnabled = false
                        onBackPressedDispatcher.onBackPressed()
                        isEnabled = true
                    }
                }
            }
        })

        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) web.loadUrl(BuildConfig.LOCI_URL)
        if (savedInstanceState == null) openFrom(intent)
        Watchdog.arm(this)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        openFrom(intent) // onResume follows, and tells the page to look
    }

    // A tapped notification: the page opens that to-do (or home) when it next takes its actions.
    private fun openFrom(intent: Intent) {
        val todoId = intent.getStringExtra(Reminders.EXTRA_OPEN_TODO)
        if (todoId == null && !intent.getBooleanExtra(Reminders.EXTRA_OPEN_HOME, false)) return
        Reminders.queue(this, JSONObject().put("type", "open").apply { todoId?.let { put("id", it) } })
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        if (!webGone) web.saveState(outState)
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
        // Back from a system screen (e.g. after allowing a permission): Settings → Phone looks again.
        web.evaluateJavascript("window.dispatchEvent(new Event('loci:resume'))", null)
        main.post(ping)
    }

    override fun onPause() {
        main.removeCallbacks(ping)
        if (!webGone) web.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        main.removeCallbacksAndMessages(null)
        if (!webGone) {
            (web.parent as? FrameLayout)?.removeView(web)
            web.destroy()
        }
        super.onDestroy()
    }

    // While Loci is in front, every 5 seconds: is the page still answering? A page that
    // doesn't for 5 seconds is frozen (busy, or stuck); it's recorded, and when it answers again.
    private var askedAt = 0L
    private var frozenSince = 0L
    private val ping = object : Runnable {
        override fun run() {
            val now = System.currentTimeMillis()
            if (askedAt != 0L && frozenSince == 0L && now - askedAt > FROZEN_MS) {
                frozenSince = askedAt
                Problems.record(this@MainActivity, "The page stopped answering")
            }
            if (askedAt == 0L) {
                askedAt = now
                web.evaluateJavascript("1") {
                    if (frozenSince != 0L) {
                        Problems.record(this@MainActivity, "The page answered again after ${(System.currentTimeMillis() - frozenSince) / 1000} s")
                    }
                    askedAt = 0L
                    frozenSince = 0L
                }
            }
            main.postDelayed(this, 5_000)
        }
    }

    private companion object {
        const val FROZEN_MS = 5_000L
    }

}
