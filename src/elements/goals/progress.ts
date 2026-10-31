// Goal progress (SPEC-v2.md, "Goals"): pure functions over a goal's data, so they
// can be tested and can also replay the past (for the chart).

import type { Contributor, Goal, GoalEntry, Todo, TodoCompletion } from '../../types'

const DAY = 86_400_000

// Everything progress depends on, for one goal.
export interface GoalData {
  goal: Goal
  contributors: Contributor[]
  entries: GoalEntry[] // check-in answers, any contributor
  todos: Map<string, Todo> // to-do count: linkId → its to-do
  completions: Map<string, TodoCompletion[]> // to-do id → its completions
}

// Weight (SPEC-v2.md, "Weights"): 2 × importance + difficulty unless set by hand.
// A to-do count takes importance and difficulty from its to-do.
export function weight(c: Contributor, data?: GoalData): number {
  if (c.weightOverride != null) return c.weightOverride
  const todo = c.kind === 'todoCount' ? data?.todos.get(c.linkId) : undefined
  return 2 * (todo?.importance ?? c.importance) + (todo?.difficulty ?? c.difficulty)
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

// The value a check-in contributor stands at (at time `at`): its latest answer, else its start.
export function currentValue(c: Contributor, data: GoalData, at = Infinity): number | null {
  if (c.kind === 'number' || c.kind === 'slider') {
    let latest: GoalEntry | null = null
    for (const e of data.entries) if (e.contributorId === c.id && e.at <= at && (!latest || e.at > latest.at)) latest = e
    return latest ? latest.value : c.start
  }
  if (c.kind === 'todoCount') return doneCount(c, data, at)
  if (c.kind === 'checklist') return c.items.filter((i) => i.doneAt != null && i.doneAt <= at).length
  return null
}

function doneCount(c: Extract<Contributor, { kind: 'todoCount' }>, data: GoalData, at: number): number {
  const todo = data.todos.get(c.linkId)
  if (!todo) return 0
  return (data.completions.get(todo.id) ?? []).filter((x) => x.outcome === 'done' && x.doneAt != null && x.doneAt >= data.goal.startAt && x.doneAt <= at).length
}

export function checklistTarget(c: Extract<Contributor, { kind: 'checklist' }>): number {
  return c.target === 'all' ? c.items.length : Math.min(c.target, c.items.length)
}

// One contributor's progress, 0..1 (SPEC-v2.md, "Contributors").
export function contributorProgress(c: Contributor, data: GoalData, at = Infinity): number {
  switch (c.kind) {
    case 'todoCount':
      return c.target > 0 ? clamp01(doneCount(c, data, at) / c.target) : 0
    case 'number':
    case 'slider': {
      const v = currentValue(c, data, at)!
      if (c.target === c.start) return v === c.target ? 1 : 0
      return clamp01((v - c.start) / (c.target - c.start)) // works for going down (80 → 75 kg) too
    }
    case 'checklist': {
      const target = checklistTarget(c)
      return target > 0 ? clamp01(currentValue(c, data, at)! / target) : 0
    }
  }
}

// The goal's progress: the weighted average of its contributors'.
export function goalProgress(data: GoalData, at = Infinity): number {
  let sum = 0
  let total = 0
  for (const c of data.contributors) {
    if (c.createdAt > at) continue // didn't exist yet (the chart replays the past)
    const w = weight(c, data)
    sum += w * contributorProgress(c, data, at)
    total += w
  }
  return total > 0 ? sum / total : 0
}

// ---------- Time ----------

export function hasEnded(goal: Goal, now: number): boolean {
  return goal.status === 'open' && goal.deadline != null && now > goal.deadline
}

// "23 days left", "Last day", or nothing for an open-ended goal.
export function timeLeft(goal: Goal, now: number): string | null {
  if (goal.deadline == null) return null
  if (now > goal.deadline) return 'Ended'
  const days = Math.ceil((goal.deadline - now) / DAY)
  return days <= 1 ? 'Last day' : `${days} days left`
}

// Expected progress if it went at a steady rate (SPEC-v2.md, "Time left and pace").
export function expectedProgress(goal: Goal, now: number): number | null {
  if (goal.deadline == null || goal.deadline <= goal.startAt) return null
  return clamp01((now - goal.startAt) / (goal.deadline - goal.startAt))
}

// How many percentage points behind a steady rate the goal is (0 when ahead). Null
// without a deadline, or once it has passed.
export function behindPace(goal: Goal, progress: number, now: number): number | null {
  const expected = expectedProgress(goal, now)
  if (expected == null || now > goal.deadline!) return null
  return Math.max(0, Math.round((expected - progress) * 100))
}

// "On pace" or "Behind by 12%": plain text, never an alarm. Null without a deadline.
export function paceText(goal: Goal, progress: number, now: number): string | null {
  const behind = behindPace(goal, progress, now)
  if (behind == null) return null
  return behind <= 2 ? 'On pace' : `Behind by ${behind}%`
}

// Progress over time for the chart: at the start, at every event, and now.
export function progressSeries(data: GoalData, now: number): { at: number; value: number }[] {
  const times = new Set<number>([data.goal.startAt, now])
  for (const e of data.entries) times.add(e.at)
  for (const list of data.completions.values()) for (const x of list) if (x.doneAt && x.doneAt >= data.goal.startAt) times.add(x.doneAt)
  for (const c of data.contributors) if (c.kind === 'checklist') for (const i of c.items) if (i.doneAt) times.add(i.doneAt)
  return [...times]
    .filter((t) => t >= data.goal.startAt && t <= now)
    .sort((a, b) => a - b)
    .map((at) => ({ at, value: goalProgress(data, at) }))
}
