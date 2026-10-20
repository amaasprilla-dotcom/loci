// The Goals element type (SPEC-v2.md, "Goals"): goals with a target, made of
// contributors (to-do counts, check-ins, checklists) and a progress %.

import { h } from '../../dom'
import { count, formatNumber } from '../../locale'
import { go, subHash } from '../../router'
import { db } from '../../store/db'
import type { Goal, Level, LocusElement } from '../../types'
import { iconNode } from '../flashcards/type'
import type { ElementType, Task } from '../registry'
import { goalProgress, hasEnded, paceText, timeLeft } from './progress'
import { dueCheckins, listGoals, loadGoalData } from './store'

const ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>'

// "45% · 23 days left · On pace", or "60% · Ended".
export function goalSummary(goal: Goal, progress: number, now: number): string {
  return [`${formatNumber(progress, { style: 'percent', maximumFractionDigits: 0 })}`, timeLeft(goal, now), paceText(goal, progress, now)].filter(Boolean).join(' · ')
}

export const goalsType: ElementType<Record<string, never>> = {
  type: 'goals',
  label: 'Goals',
  noun: 'goal list',
  description: 'Goals with targets, check-ins and progress',
  icon: ICON,

  createDefault: () => ({}),

  async renderCard(el, now) {
    const all = await listGoals(el.id)
    const goals = all.filter((g) => g.status === 'open')
    const achieved = all.filter((g) => g.status === 'achieved').length
    let checkins = 0
    let best: { title: string; progress: number } | null = null
    for (const g of goals) {
      const data = await loadGoalData(g)
      checkins += dueCheckins(data.contributors, now).length > 0 ? 1 : 0
      const progress = goalProgress(data, now)
      if (!best || progress > best.progress) best = { title: g.title, progress }
    }
    return h(
      'div',
      { class: 'tile-content' },
      h('div', { class: 'tile-head' }, iconNode(ICON), h('span', { class: 'tile-kind' }, 'Goals')),
      h('h3', { class: 'tile-title' }, el.title),
      h('p', { class: 'tile-meta' }, goals.length > 0 ? count(goals.length, 'goal', 'goals') : achieved > 0 ? `${formatNumber(achieved)} achieved` : 'No goals yet'),
      h(
        'div',
        { class: 'tile-status' },
        checkins > 0 && h('span', { class: 'pill pill-due' }, checkins === 1 ? 'Check-in due' : `${formatNumber(checkins)} check-ins due`),
        best && h('span', { class: 'pill' }, `${best.title}: ${formatNumber(best.progress, { style: 'percent', maximumFractionDigits: 0 })}`),
      ),
    )
  },

  async renderScreen(el, sub) {
    const screens = await import('./screens')
    if (sub[0] === 'goal' && sub[1]) return screens.renderGoal(el, sub[1], sub[2] === 'checkin')
    return screens.renderGoalList(el)
  },

  async getTasks(el, now) {
    const tasks: Task[] = []
    for (const g of await listGoals(el.id)) {
      if (g.status !== 'open') continue
      const data = await loadGoalData(g)
      const progress = goalProgress(data, now)
      // Always in "Goals and exams", never red.
      tasks.push({
        locusId: el.locusId,
        elementId: el.id,
        itemId: g.id,
        kind: 'goal',
        state: 'info',
        label: g.title,
        sublabel: hasEnded(g, now) ? `${goalSummary(g, progress, now)} · Mark achieved, extend or archive` : goalSummary(g, progress, now),
        importance: 2,
        difficulty: 2,
        dueAt: g.deadline,
        progress,
        open: () => go(subHash(el, 'goal', g.id)),
      })
      // Due check-ins go to Now: active, but never overdue.
      const due = dueCheckins(data.contributors, now)
      if (due.length > 0) {
        tasks.push({
          locusId: el.locusId,
          elementId: el.id,
          itemId: g.id,
          kind: 'checkin',
          state: 'due',
          label: `Check in: ${g.title}`,
          sublabel: due.map((c) => c.title).join(', '),
          importance: Math.max(...due.map((c) => c.importance)) as Level,
          difficulty: 1,
          dueAt: Math.min(...due.map((c) => c.schedule.next)),
          open: () => go(subHash(el, 'goal', g.id, 'checkin')),
        })
      }
    }
    return tasks
  },

  async nextDueAt(el, now) {
    let next: number | null = null
    for (const g of await listGoals(el.id)) {
      if (g.status !== 'open') continue
      for (const c of (await loadGoalData(g)).contributors) {
        if ((c.kind === 'number' || c.kind === 'slider') && c.schedule.next > now && (next == null || c.schedule.next < next)) next = c.schedule.next
      }
    }
    return next
  },
}

// For the Link to… picker and the to-do "When a goal reaches…" option.
export async function openGoals(): Promise<{ goal: Goal; list: LocusElement }[]> {
  const goals = await db.goals.filter((g) => g.status === 'open').toArray()
  const lists = new Map((await db.elements.bulkGet([...new Set(goals.map((g) => g.elementId))])).filter((e): e is LocusElement => e != null).map((e) => [e.id, e]))
  return goals.filter((g) => lists.has(g.elementId)).map((goal) => ({ goal, list: lists.get(goal.elementId)! }))
}
