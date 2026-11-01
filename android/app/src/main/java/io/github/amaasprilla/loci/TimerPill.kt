package io.github.amaasprilla.loci

import android.annotation.SuppressLint
import android.content.Context
import android.content.SharedPreferences
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.ViewConfiguration
import android.view.WindowManager
import android.widget.TextView
import kotlin.math.abs

// The floating pill over a social app: "Instagram · 12:34", or just the time once tapped.
// Drawn by WatchService as an accessibility overlay, so it needs no "Display over other
// apps" and sits over the status bar too. Dragging moves it; the spot is remembered.
class TimerPill(private val context: Context, private val state: SharedPreferences) {
    private val windows = context.getSystemService(WindowManager::class.java)
    private var view: TextView? = null
    private var app = ""
    private var ms = 0L
    private var compact = state.getBoolean("compact", false)

    private fun dp(v: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, context.resources.displayMetrics)

    fun show(app: String, ms: Long, small: Boolean) {
        this.app = app
        this.ms = ms
        val shown = view ?: create().also { view = it }
        shown.setTextSize(TypedValue.COMPLEX_UNIT_SP, if (small) 12f else 14f)
        val (h, v) = if (small) dp(10f) to dp(4f) else dp(14f) to dp(7f)
        shown.setPadding(h.toInt(), v.toInt(), h.toInt(), v.toInt())
        render()
    }

    fun setTime(ms: Long) {
        this.ms = ms
        render()
    }

    fun hide() {
        view?.let { windows.removeView(it) }
        view = null
    }

    private fun render() {
        view?.text = if (compact) SocialTimer.clock(ms) else "$app · ${SocialTimer.clock(ms)}"
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun create(): TextView {
        val pill = TextView(context).apply {
            setTextColor(Color.parseColor("#1D1D1F"))
            fontFeatureSettings = "tnum" // the digits don't jiggle as they change
            maxLines = 1
            background = GradientDrawable().apply {
                cornerRadius = dp(999f)
                setColor(Color.argb(235, 255, 255, 255))
                setStroke(dp(1f).toInt(), Color.argb(40, 0, 0, 0))
            }
            importantForAccessibility = android.view.View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            x = state.getInt("x", 0)
            // Below the status bar and the camera, until it's moved.
            y = state.getInt("y", statusBarHeight() + dp(8f).toInt())
        }

        // A tap shrinks it to the time (or back); a drag moves it.
        val slop = ViewConfiguration.get(context).scaledTouchSlop
        var downX = 0f
        var downY = 0f
        var startX = 0
        var startY = 0
        var dragging = false
        pill.setOnTouchListener { v, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downX = e.rawX; downY = e.rawY; startX = params.x; startY = params.y; dragging = false
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = e.rawX - downX
                    val dy = e.rawY - downY
                    if (dragging || abs(dx) > slop || abs(dy) > slop) {
                        dragging = true
                        params.x = startX + dx.toInt()
                        params.y = maxOf(0, startY + dy.toInt())
                        windows.updateViewLayout(v, params)
                    }
                }
                MotionEvent.ACTION_UP -> {
                    if (dragging) {
                        state.edit().putInt("x", params.x).putInt("y", params.y).apply()
                    } else {
                        compact = !compact
                        state.edit().putBoolean("compact", compact).apply()
                        render()
                    }
                }
            }
            true
        }
        windows.addView(pill, params)
        return pill
    }

    @SuppressLint("DiscouragedApi", "InternalInsetResource")
    private fun statusBarHeight(): Int {
        val id = context.resources.getIdentifier("status_bar_height", "dimen", "android")
        return if (id > 0) context.resources.getDimensionPixelSize(id) else dp(24f).toInt()
    }
}
