// Reading and writing an experimental locus's weekly targets. They live in the data of
// one "weekly" element; the work blocks are to-dos in a "Blocks" to-do list beside it.

import { createElement, db, listElements, updateElement } from '../../store/db'
import type { LocusElement } from '../../types'
import { type DoneAt, defaultWeekly, snapshot, type WeeklyData, weekKey, weeklyOf } from './model'

export interface ExperimentParts {
  weekly: LocusElement<WeeklyData>
  blocks: LocusElement
}

// The two elements every experimental locus holds, made if missing (a new locus, or one
// whose elements haven't arrived by sync yet).
export async function experimentParts(locusId: string): Promise<ExperimentParts> {
  const els = await listElements(locusId)
  const weekly = els.find((e) => e.type === 'weekly') ?? (await createElement(locusId, 'weekly', 'This week', defaultWeekly()))
  const blocks = els.find((e) => e.type === 'todos') ?? (await createElement(locusId, 'todos', 'Blocks', {}))
  return { weekly: { ...weekly, data: weeklyOf(weekly.data) }, blocks }
}

export async function loadWeekly(elementId: string): Promise<WeeklyData> {
  return weeklyOf((await db.elements.get(elementId))?.data)
}

export async function saveWeekly(elementId: string, data: WeeklyData): Promise<void> {
  await updateElement(elementId, { data })
}

// Changes the targets' data from its latest copy, so two quick taps don't undo each other.
export async function changeWeekly(elementId: string, change: (data: WeeklyData) => void): Promise<WeeklyData> {
  const data = await loadWeekly(elementId)
  change(data)
  await saveWeekly(elementId, data)
  return data
}

// +1 (or -1) by hand on a target, this week.
export function tap(elementId: string, targetId: string, delta: number, now = Date.now()): Promise<WeeklyData> {
  return changeWeekly(elementId, (data) => {
    const week = weekKey(now)
    const taps = { ...(data.taps[week] ?? {}) }
    taps[targetId] = (taps[targetId] ?? 0) + delta
    data.taps = { ...data.taps, [week]: taps }
    snapshot(data, week)
  })
}

// The finished sessions of these to-dos since `since`, for counting.
export async function doneSince(todoIds: string[], since: number): Promise<DoneAt[]> {
  if (todoIds.length === 0) return []
  const rows = await db.todoCompletions.where('todoId').anyOf(todoIds).filter((c) => c.outcome === 'done' && (c.doneAt ?? 0) >= since).toArray()
  return rows.map((c) => ({ todoId: c.todoId, doneAt: c.doneAt! }))
}
