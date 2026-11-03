package io.github.amaasprilla.loci

import android.accessibilityservice.AccessibilityService
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import java.util.Calendar

// The blocked screen (SPEC-v7-wellbeing.md): a card over the whole of a blocked app, in
// Loci's look, with why and until when, and Close app. The app can't be touched under it.
// Gentle adds 5 more minutes. Drawn by WatchService as an accessibility overlay.
class BlockedScreen(private val service: AccessibilityService) {
    private val windows = service.getSystemService(WindowManager::class.java)
    private var view: View? = null
    private var shown = "" // what's on it, so it's only made again when that changes

    private fun dp(v: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, service.resources.displayMetrics).toInt()

    // `moresLeft`: Gentle's 5 more minutes left today, null when not Gentle.
    fun show(pkg: String, block: Blocker.Window, moresLeft: Int?) {
        val what = "$pkg ${block.id} ${block.end} $moresLeft"
        if (view?.isAttachedToWindow == false) hide()
        if (view != null && what == shown) return
        hide()
        shown = what
        view = create(pkg, block, moresLeft).also { windows.addView(it, params()) }
    }

    fun hide() {
        view?.let { runCatching { windows.removeView(it) } }
        view = null
        shown = ""
    }

    private fun params() = WindowManager.LayoutParams(
        WindowManager.LayoutParams.MATCH_PARENT,
        WindowManager.LayoutParams.MATCH_PARENT,
        WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
        PixelFormat.OPAQUE,
    ).apply {
        if (Build.VERSION.SDK_INT >= 28) layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
    }

    private fun create(pkg: String, block: Blocker.Window, moresLeft: Int?): View {
        val ink = Color.parseColor("#0B0F14")
        val muted = Color.parseColor("#5A6573")
        fun text(value: String, size: Float, color: Int, bold: Boolean = false) = TextView(service).apply {
            text = value
            setTextSize(TypedValue.COMPLEX_UNIT_SP, size)
            setTextColor(color)
            gravity = Gravity.CENTER
            if (bold) typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        }
        fun below(view: View, top: Float) = view.apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(top) }
        }

        val pm = service.packageManager
        val info = runCatching { pm.getApplicationInfo(pkg, 0) }.getOrNull()
        val icon = ImageView(service).apply {
            info?.let { setImageDrawable(pm.getApplicationIcon(it)) }
            layoutParams = LinearLayout.LayoutParams(dp(64f), dp(64f))
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }

        val close = text("Close app", 16f, Color.WHITE, bold = true).apply {
            setPadding(0, dp(14f), 0, dp(14f))
            background = GradientDrawable().apply { cornerRadius = dp(999f).toFloat(); setColor(ink) }
            setOnClickListener { service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME) }
        }

        val card = LinearLayout(service).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(24f), dp(28f), dp(24f), dp(24f))
            background = GradientDrawable().apply {
                cornerRadius = dp(28f).toFloat()
                setColor(Color.argb(235, 255, 255, 255))
                setStroke(dp(1f), Color.argb(217, 255, 255, 255))
            }
            addView(icon)
            addView(below(text(info?.let { pm.getApplicationLabel(it).toString() } ?: pkg, 24f, ink, bold = true), 16f))
            addView(below(text("is blocked", 16f, muted), 2f))
            addView(below(text("${until(block.end)} · ${block.reason}", 16f, ink), 18f))
            addView(below(close, 28f))
            if (moresLeft != null) {
                val more = text(if (moresLeft > 0) "5 more minutes ($moresLeft left today)" else "No more extra minutes today", 15f, muted).apply {
                    setPadding(0, dp(12f), 0, dp(12f))
                    if (moresLeft > 0) setOnClickListener {
                        Problems.safely(service, "Blocker") { Blocker.more(service) }
                        WatchService.refresh()
                    }
                }
                addView(below(more, 6f))
            }
        }

        return FrameLayout(service).apply {
            background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(Color.parseColor("#F1F1F0"), Color.parseColor("#E8E8E7")))
            isClickable = true // nothing reaches the app underneath
            addView(card, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER).apply {
                leftMargin = dp(24f)
                rightMargin = dp(24f)
            })
        }
    }

    // "Until 12:00", "Until midnight".
    private fun until(at: Long): String {
        val c = Calendar.getInstance().apply { timeInMillis = at }
        if (c.get(Calendar.HOUR_OF_DAY) == 0 && c.get(Calendar.MINUTE) == 0) return "Until midnight"
        return "Until " + android.text.format.DateFormat.getTimeFormat(service).format(java.util.Date(at))
    }
}
