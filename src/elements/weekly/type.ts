// The "weekly" element type (SPEC-v8-experimental.md): an experimental locus's weekly
// targets and review. It has no tile or screen of its own (the experimental locus screen
// shows it), and isn't offered in a normal locus's + menu. Its tasks bring the weekly
// review, a change ready to confirm, and a target running short to the Now card and Tasks.

import { h } from '../../dom'
import { go } from '../../router'
import type { LocusElement } from '../../types'
import type { ElementType, Task } from '../registry'
import { formatDay, formatTime } from '../todos/when'
import { countFor, daysLeft, heldTo, isReady, nextDay, reviewDue, type WeeklyData, weekKey, weeklyOf, weekStart } from './model'
import { doneSince } from './store'

const ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3.5h6M10 3.5v5.2L4.8 18a1.8 1.8 0 0 0 1.6 2.6h11.2a1.8 1.8 0 0 0 1.6-2.6L14 8.7V3.5M7.5 14h9"/></svg>'

export const locusHash = (locusId: string) => `#/locus/${encodeURIComponent(locusId)}`

// What the Now card and Tasks see from one experimental locus's targets.
export async function weeklyTasks(el: LocusElement, now: number): Promise<Task[]> {
  const data: WeeklyData = weeklyOf(el.data)
  const open = () => go(locusHash(el.locusId))
  const base = { locusId: el.locusId, elementId: el.id, itemId: el.id, importance: 3 as const, difficulty: 1 as const, open }
  const out: Task[] = []
  if (reviewDue(data, now)) {
    out.push({ ...base, kind: 'checkin', state: 'due', label: 'Weekly review', sublabel: data.reviewSteps.slice(0, 2).join(' · '), dueAt: now })
  }
  if (data.pending) {
    out.push(
      isReady(data.pending, now)
        ? { ...base, kind: 'checkin', state: 'due', label: 'A change is ready to confirm', sublabel: data.pending.reason, dueAt: data.pending.readyAt }
        : { ...base, kind: 'checkin', state: 'upcoming', label: 'A change is waiting', sublabel: `Ready ${formatDay(data.pending.readyAt, now)} at ${formatTime(data.pending.readyAt)}`, dueAt: data.pending.readyAt },
    )
  }
  // Near the end of the week, a target still under its minimum.
  const left = daysLeft(now)
  if (left <= 2 && data.targets.length > 0) {
    const week = weekKey(now)
    const done = await doneSince(data.targets.flatMap((t) => t.todoIds), weekStart(now))
    for (const t of data.targets) {
      const count = countFor(data, t, week, done)
      const { min } = heldTo(data, t, week)
      if (count >= min) continue
      out.push({ ...base, kind: 'checkin', state: 'due', importance: 3, label: `${t.name}: ${count} of ${min}`, sublabel: left === 1 ? 'Last day of the week' : '2 days left this week', dueAt: now })
    }
  }
  return out
}

export const weeklyType: ElementType<WeeklyData> = {
  type: 'weekly',
  label: 'Weekly targets',
  noun: 'set of weekly targets',
  description: 'Ranges counted Monday to Sunday',
  icon: ICON,
  hidden: true,
  createDefault: () => weeklyOf({}),
  async renderCard(el) {
    return h('div', { class: 'tile-content' }, h('h3', { class: 'tile-title' }, el.title))
  },
  async renderScreen(el) {
    // Shown on the experimental locus's own screen.
    location.replace(locusHash(el.locusId))
    return h('div')
  },
  getTasks: weeklyTasks,
  async nextDueAt(el, now) {
    const data = weeklyOf(el.data)
    if (data.targets.length === 0) return null
    return Math.min(nextDay(now, data.reviewDay), data.pending && data.pending.readyAt > now ? data.pending.readyAt : Infinity)
  },
}
