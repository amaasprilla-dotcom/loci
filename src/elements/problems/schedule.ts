// Problems in study sessions (SPEC-v2.md, "Sessions and scheduling"): which
// templates are up today, the rating each attempt earns, and saving attempts.
// The rating is derived, not self-reported: wrong is Again; right but slow is
// Hard; right is Good; right and quick is Easy, against the user's own median
// time on that template.

import { db } from '../../store/db'
import type { Grade, LocusElement, ProblemAttempt, ProblemTemplate } from '../../types'
import { isNewSrs, studyDayStart } from '../flashcards/srs'
import { nextState } from '../../study/schedule'
import type { Answered } from './present'
import type { Instance } from './engine'
import { listTemplates } from './store'
import type { ProblemsData } from './type'

export const SLOW = 1.5 // slower than 1.5× your median: Hard
export const QUICK = 0.6 // under 0.6× your median: Easy
export const MEDIAN_AFTER = 3 // the first 3 attempts have no median yet
export const MAX_MS = 10 * 60_000 // time beyond this (a problem left open) doesn't count

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

// `previous`: times (ms) of earlier right answers on this template.
export function deriveGrade(correct: boolean, ms: number, previous: number[]): Grade {
  if (!correct) return 0
  if (previous.length < MEDIAN_AFTER) return 2
  const m = median(previous)
  if (ms > SLOW * m) return 1
  if (ms < QUICK * m) return 3
  return 2
}

// Today's problems in a set: those due for review, oldest first, then new ones up
// to the set's new-per-day limit. Templates whose constraints leave no numbers sit out.
// `newLimit` overrides the set's own limit (an exam pacing new material).
export async function planProblems(set: LocusElement<ProblemsData>, now: number, newLimit?: number): Promise<ProblemTemplate[]> {
  const templates = (await listTemplates(set.id)).filter((t) => !t.tooTight)
  const attempts = await db.problemAttempts.where('templateId').anyOf(templates.map((t) => t.id)).toArray()
  const dayStart = studyDayStart(now)
  const first = new Map<string, number>()
  for (const a of attempts) first.set(a.templateId, Math.min(first.get(a.templateId) ?? Infinity, a.at))
  const introducedToday = [...first.values()].filter((at) => at >= dayStart).length
  const due = templates.filter((t) => !isNewSrs(t.srs) && t.srs.due <= now).sort((a, b) => a.srs.due - b.srs.due)
  const fresh = templates.filter((t) => isNewSrs(t.srs)).slice(0, Math.max(0, (newLimit ?? set.data.newPerDay ?? 10) - introducedToday))
  return [...due, ...fresh]
}

// Saves an attempt and the template's new schedule. Returns the rating and the updated template.
export async function recordAttempt(t: ProblemTemplate, inst: Instance, answered: Answered, now: number, retention: number): Promise<{ grade: Grade; template: ProblemTemplate }> {
  const ms = Math.min(answered.ms, MAX_MS)
  const previous = (await db.problemAttempts.where('templateId').equals(t.id).toArray()).filter((a) => a.correct).map((a) => a.ms)
  const grade = deriveGrade(answered.correct, ms, previous)
  const srs = await nextState({ type: 'template', id: t.id, elementId: t.elementId }, t.srs, grade, now, retention)
  const template: ProblemTemplate = { ...t, srs, updatedAt: now }
  const attempt: ProblemAttempt = {
    id: crypto.randomUUID(),
    templateId: t.id,
    at: now,
    seed: inst.seed,
    answer: inst.answer,
    given: answered.given,
    ...(answered.rule && { rule: answered.rule }),
    correct: answered.correct,
    ms,
    grade,
    updatedAt: now,
  }
  await db.transaction('rw', db.problemTemplates, db.problemAttempts, async () => {
    await db.problemTemplates.put(template)
    await db.problemAttempts.add(attempt)
  })
  return { grade, template }
}
