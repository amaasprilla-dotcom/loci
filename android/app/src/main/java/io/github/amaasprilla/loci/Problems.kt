package io.github.amaasprilla.loci

import android.app.Application
import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

// What went wrong on this phone, kept so it can be seen and copied from Settings → Phone:
// crashes, the page's process ending, the page not answering, errors in the page or the
// services. The last 30, newest first. Nothing leaves the phone unless you copy it.
object Problems {
    private const val PREFS = "problems"
    private const val KEEP = 30

    fun record(context: Context, what: String, error: Throwable? = null, detail: String? = null, now: Boolean = false) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val entry = JSONObject()
            .put("at", System.currentTimeMillis())
            .put("what", what)
            .put("version", BuildConfig.VERSION_NAME)
            .put("detail", (detail ?: error?.stackTraceToString().orEmpty()).take(2_000))
        val old = JSONArray(prefs.getString("list", "[]"))
        val list = JSONArray().put(entry)
        for (i in 0 until minOf(old.length(), KEEP - 1)) list.put(old.get(i))
        val edit = prefs.edit().putString("list", list.toString())
        // A crash ends the process: write before it goes.
        if (now) edit.commit() else edit.apply()
    }

    fun list(context: Context) = JSONArray(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("list", "[]"))

    fun clear(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove("list").apply()

    // Runs `block`, and records instead of crashing: a crash would take the timer and sleep
    // mode down with it, and Android may not start the accessibility service again.
    inline fun <T> safely(context: Context, what: String, block: () -> T): T? = try {
        block()
    } catch (e: Exception) {
        record(context, what, e)
        null
    }
}

// The app's process: anything that still crashes it is recorded first.
class LociApp : Application() {
    override fun onCreate() {
        super.onCreate()
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            try {
                Problems.record(this, "Crash", error, now = true)
            } catch (_: Throwable) {
            }
            previous?.uncaughtException(thread, error)
        }
    }
}
