package io.github.amaasprilla.loci

import android.content.Context
import android.telecom.TelecomManager
import org.json.JSONObject

// The distraction blocker (SPEC-v7-wellbeing.md). While a block is on, the distracting apps
// can't be used: WatchService covers them with the blocked screen. Blocks are rules in the
// phone prefs ("blocker"), worked out afresh each time it's asked, as sleep mode is (no
// alarms). The one-off state (Block now, blocks ended early, Gentle's extra minutes) is kept
// in the "blocker" prefs here.
object Blocker {
    private const val STATE = "blocker"
    const val WARN_MS = 5 * 60_000L // the pill turns red this long before a block
    private const val MORE_MS = 5 * 60_000L
    private const val MORES_A_DAY = 3

    // One stretch of blocking. `id` is its rule's, "now" for Block now.
    data class Window(val id: String, val kind: String, val reason: String, val start: Long, val end: Long)

    // `blocked`: the block on now (the one that lasts longest, if several are). `next`: the
    // next to start, or the one on now coming back after Gentle's 5 more minutes. `change`:
    // when this is next worth working out again.
    data class State(val on: Boolean, val firmness: String, val blocked: Window?, val next: Window?, val moreUntil: Long, val moresLeft: Int, val change: Long) {
        // Firm and Strict: the blocks can't be changed while one is on (End early is the way out).
        val locked get() = blocked != null && firmness != "gentle"
    }

    private fun store(context: Context) = context.getSharedPreferences(STATE, Context.MODE_PRIVATE)

    // Loci (to end a block or see why it's on), the phone, the home screen and the system's
    // settings (so the service can always be switched off) are never blocked.
    fun neverBlocked(context: Context, pkg: String, homes: Set<String>): Boolean =
        pkg == context.packageName || pkg in homes || pkg == "com.android.settings" ||
            pkg == runCatching { context.getSystemService(TelecomManager::class.java).defaultDialerPackage }.getOrNull()

    // `today`: the time in distracting apps so far today; `counting`: one is in front, so the
    // daily limit is getting closer.
    fun state(context: Context, phone: JSONObject, now: Long, today: Long, counting: Boolean): State {
        val prefs = phone.optJSONObject("blocker")
        val firmness = prefs?.optString("firmness", "firm") ?: "firm"
        if (prefs?.optBoolean("on") != true) return State(false, firmness, null, null, 0, 0, 0)
        val s = store(context)
        val all = windows(context, prefs, phone.optJSONObject("sleep"), now, today, counting)
            .filter { it.end > now && s.getLong("skip:${it.id}", 0) < it.end }
        val on = all.filter { it.start <= now }
        val coming = all.filter { it.start > now }
        val day = SleepMode.at(now, 0, 0)
        val mores = if (s.getLong("moreDay", 0) == day) s.getInt("mores", 0) else 0
        val moreUntil = if (firmness == "gentle") s.getLong("moreUntil", 0).takeIf { it > now } ?: 0 else 0
        val longest = on.maxByOrNull { it.end }
        val blocked = longest.takeIf { moreUntil == 0L }
        val next = if (longest != null && moreUntil != 0L) longest.copy(start = moreUntil) else coming.minByOrNull { it.start }
        val change = (all.flatMap { listOf(it.start - WARN_MS, it.start, it.end) } + moreUntil + SleepMode.at(now, 1, 0))
            .filter { it > now }.min()
        return State(true, firmness, blocked, next, moreUntil, (MORES_A_DAY - mores).coerceAtLeast(0), change)
    }

    fun state(context: Context, now: Long = System.currentTimeMillis()) =
        state(context, WatchService.phonePrefs(context), now, SocialTimer.todayMs(context, now), false)

    // Every block on now or starting in the next day or so.
    private fun windows(context: Context, prefs: JSONObject, sleep: JSONObject?, now: Long, today: Long, counting: Boolean): List<Window> {
        val s = store(context)
        val out = mutableListOf<Window>()
        if (s.getLong("nowUntil", 0) > now) out += Window("now", "now", "Block now", s.getLong("nowFrom", now), s.getLong("nowUntil", 0))
        val rules = prefs.optJSONArray("rules") ?: return out
        for (i in 0 until rules.length()) {
            val rule = rules.optJSONObject(i) ?: continue
            if (!rule.optBoolean("on", true)) continue
            val id = rule.optString("id")
            when (rule.optString("kind")) {
                "hours" -> out += daily(id, "hours", rule.optString("name").ifBlank { "Set hours" }, rule.optString("start"), rule.optString("end"), days(rule), now)
                // As set in sleep mode, whether its filter is on or not, and during Sleep now.
                "bedtime" -> {
                    out += daily(id, "bedtime", "Bedtime", sleep?.optString("bed").orEmpty().ifEmpty { "23:30" }, sleep?.optString("wake").orEmpty().ifEmpty { "07:00" }, days(sleep), now)
                    val sleepNow = SleepMode.sleepNowBlock(context)
                    if (sleepNow.second > now) out += Window(id, "bedtime", "Bedtime", sleepNow.first, sleepNow.second)
                }
                // Reached: blocked until midnight. Not yet: it starts once the rest of the
                // limit has gone, if a distracting app stays in front.
                "limit" -> {
                    val limit = rule.optInt("minutes", 60) * 60_000L
                    val midnight = SleepMode.at(now, 1, 0)
                    val reason = "Daily limit of ${duration(limit)}"
                    if (today >= limit) out += Window(id, "limit", reason, SleepMode.at(now, 0, 0), midnight)
                    else if (counting && now + limit - today < midnight) out += Window(id, "limit", reason, now + limit - today, midnight)
                }
            }
        }
        return out
    }

    private fun days(prefs: JSONObject?): Set<Int> =
        prefs?.optJSONArray("days")?.let { a -> (0 until a.length()).map { a.getInt(it) }.toSet() }
            ?: prefs?.optJSONArray("nights")?.let { a -> (0 until a.length()).map { a.getInt(it) }.toSet() }
            ?: (0..6).toSet()

    // From `from` to `to` (the next day if earlier) on the days given, by the day it starts.
    private fun daily(id: String, kind: String, reason: String, from: String, to: String, days: Set<Int>, now: Long): List<Window> {
        val start = SleepMode.minutes(from, -1)
        val end = SleepMode.minutes(to, -1)
        if (start < 0 || end < 0 || start == end) return emptyList()
        return (-1..1).mapNotNull { d ->
            val a = SleepMode.at(now, d, start)
            val b = SleepMode.at(now, if (end > start) d else d + 1, end)
            Window(id, kind, reason, a, b).takeIf { SleepMode.weekday(a) in days }
        }
    }

    // A daily limit is on, so the time in distracting apps is needed with the timer off too.
    fun hasLimit(phone: JSONObject): Boolean {
        val rules = phone.optJSONObject("blocker")?.optJSONArray("rules") ?: return false
        return (0 until rules.length()).any { rules.optJSONObject(it)?.let { r -> r.optString("kind") == "limit" && r.optBoolean("on", true) } == true }
    }

    // "1 h", "1 h 30 min", "45 min".
    fun duration(ms: Long): String {
        val min = ms / 60_000
        return when {
            min < 60 -> "$min min"
            min % 60 == 0L -> "${min / 60} h"
            else -> "${min / 60} h ${min % 60} min"
        }
    }

    // Block now: from now until `until` (a running Block now only gets longer).
    fun blockNow(context: Context, until: Long, now: Long = System.currentTimeMillis()) {
        val s = store(context)
        val running = s.getLong("nowUntil", 0) > now
        s.edit().putLong("nowFrom", if (running) s.getLong("nowFrom", now) else now).putLong("nowUntil", maxOf(until, s.getLong("nowUntil", 0))).apply()
    }

    // End early: the block on now from that rule stops until its next time. Never in Strict.
    fun end(context: Context, id: String, now: Long = System.currentTimeMillis()): Boolean {
        val state = state(context, now)
        if (state.firmness == "strict") return false
        val window = windows(context, WatchService.phonePrefs(context).optJSONObject("blocker") ?: return false, WatchService.phonePrefs(context).optJSONObject("sleep"), now, SocialTimer.todayMs(context, now), false)
            .filter { it.id == id && it.start <= now && it.end > now }.maxByOrNull { it.end } ?: return false
        val s = store(context).edit()
        if (id == "now") s.putLong("nowUntil", 0) else s.putLong("skip:$id", window.end)
        s.apply()
        return true
    }

    // Gentle's 5 more minutes, from the blocked screen, a few times a day.
    fun more(context: Context, now: Long = System.currentTimeMillis()): Boolean {
        val state = state(context, now)
        if (state.firmness != "gentle" || state.moresLeft <= 0) return false
        val day = SleepMode.at(now, 0, 0)
        val s = store(context)
        val mores = if (s.getLong("moreDay", 0) == day) s.getInt("mores", 0) else 0
        s.edit().putLong("moreDay", day).putInt("mores", mores + 1).putLong("moreUntil", now + MORE_MS).apply()
        return true
    }

    // For the page: the state, and when each kind of block ends.
    fun json(state: State): JSONObject {
        fun window(w: Window?) = w?.let { JSONObject().put("id", it.id).put("kind", it.kind).put("reason", it.reason).put("start", it.start).put("end", it.end) } ?: JSONObject.NULL
        return JSONObject()
            .put("on", state.on)
            .put("firmness", state.firmness)
            .put("blocked", window(state.blocked))
            .put("next", window(state.next))
            .put("moreUntil", state.moreUntil)
            .put("moresLeft", state.moresLeft)
            .put("locked", state.locked)
    }

    // While Firm or Strict holds a block on, the page can't change the blocks, the list of
    // distracting apps, or the bedtime they follow: those parts of the new prefs are put back.
    fun guard(context: Context, old: JSONObject, new: JSONObject): JSONObject {
        if (!state(context).locked) return new
        old.optJSONObject("blocker")?.let { new.put("blocker", it) } ?: new.remove("blocker")
        val apps = old.optJSONObject("timer")?.opt("apps")
        new.optJSONObject("timer")?.let { if (apps != null) it.put("apps", apps) else it.remove("apps") }
        val oldSleep = old.optJSONObject("sleep")
        new.optJSONObject("sleep")?.let { sleep -> for (key in listOf("bed", "wake", "nights")) oldSleep?.opt(key)?.let { sleep.put(key, it) } }
        return new
    }
}
