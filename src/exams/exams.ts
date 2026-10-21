// Test mode (SPEC-v2.md, "Test mode (Exams)"). While an exam is upcoming, items
// in its scope are scheduled to be strong on exam day rather than for the long term:
// 1. Interval cap: a review that would next fall due in the last 2 days or after
//    the exam is brought forward if recall on exam day would be under target.
// 2. Final pass: in the last 2 days, every item under target on exam day is due.
// 3. New material is paced to be seen in time: unseen ÷ (days left − 2) a day.
// 4. Readiness: mean predicted recall on exam day, unseen items counting 0.
// 5. Once the day has passed, the exam is done and everything schedules normally.

import { DAY, dueAfterDays, isNewSrs, recall, studyDayStart } from '../elements/flashcards/srs'
import { db, deleteLinksFor } from '../store/db'
import type { Exam, LocusElement, Srs } from '../types'

export const FINAL_DAYS = 2
export const DEFAULT_TARGET = 0.9
export const EXAM_HOUR = 9 // an exam's date is 09:00 on its day
export const STUDIED_TYPES = ['flashcards', 'problems']

// ---------- Dates ----------

export function examDate(day: Date): number {
  const d = new Date(day)
  d.setHours(EXAM_HOUR, 0, 0, 0)
  return d.getTime()
}

// Upcoming until the exam's day is over (its study day ends at 04:00 the next morning).
export function isUpcoming(exam: Exam, now: number): boolean {
  return exam.status === 'upcoming' && now < studyDayStart(exam.date) + DAY
}

// Whole study days from today to the exam's day: 0 on the day, 1 the day before.
export function daysLeft(exam: Pick<Exam, 'date'>, now: number): number {
  return Math.round((studyDayStart(exam.date) - studyDayStart(now)) / DAY)
}

export function countdown(exam: Pick<Exam, 'date'>, now: number): string {
  const d = daysLeft(exam, now)
  return d <= 0 ? 'Today' : d === 1 ? 'Tomorrow' : `In ${d} days`
}

export const inFinalDays = (exam: Pick<Exam, 'date'>, now: number) => daysLeft(exam, now) <= FINAL_DAYS

// ---------- The rules, on one item ----------

// 1. The due date after a review, capped so recall on exam day stays at target:
// moved to the last day before the exam when recall is still at target (at least tomorrow).
export function capForExam(srs: Srs, exam: Pick<Exam, 'date' | 'targetRecall'>, now: number): Srs {
  if (srs.due <= exam.date - FINAL_DAYS * DAY) return srs // reviewed again before the final days anyway
  if (recall(srs, exam.date) >= exam.targetRecall) return srs
  let best = dueAfterDays(now, 1)
  for (let k = 2; ; k++) {
    const d = dueAfterDays(now, k)
    if (d >= exam.date || recall(srs, d) < exam.targetRecall) break
    best = d
  }
  if (best >= srs.due) return srs // never later than FSRS wanted
  return { ...srs, due: best, scheduled_days: Math.max(1, Math.round((best - studyDayStart(now)) / DAY)) }
}

// 2. In the final days, an item under target on exam day is due whatever its date.
export function inFinalPass(srs: Srs, exam: Pick<Exam, 'date' | 'targetRecall'>, now: number): boolean {
  return !isNewSrs(srs) && inFinalDays(exam, now) && recall(srs, exam.date) < exam.targetRecall
}

// 3. New items a day, so every unseen one is seen before the final days.
export function pace(unseen: number, days: number): number {
  return unseen === 0 ? 0 : Math.ceil(unseen / Math.max(1, days - FINAL_DAYS))
}

// 4. Predicted recall on exam day, for one item (unseen: 0).
export function examRecall(srs: Srs, exam: Pick<Exam, 'date'>): number {
  return isNewSrs(srs) ? 0 : recall(srs, exam.date)
}

// ---------- Exams in the database ----------

export async function listExams(locusId: string): Promise<Exam[]> {
  return (await db.exams.where('locusId').equals(locusId).toArray()).sort((a, b) => a.date - b.date)
}

// The decks and problem sets an exam covers: those linked to it, or all in its locus.
export async function scopeOf(exam: Exam): Promise<LocusElement[]> {
  const linked = await db.links.where('[to.type+to.id]').equals(['exam', exam.id]).filter((l) => l.kind === 'scope').toArray()
  const elements = (await db.elements.where('locusId').equals(exam.locusId).toArray()).filter((e) => STUDIED_TYPES.includes(e.type))
  if (linked.length === 0) return elements
  const ids = new Set(linked.map((l) => l.from.id))
  return elements.filter((e) => ids.has(e.id))
}

export async function hasExplicitScope(exam: Exam): Promise<boolean> {
  return (await db.links.where('[to.type+to.id]').equals(['exam', exam.id]).filter((l) => l.kind === 'scope').count()) > 0
}

// Upcoming exams covering an element, soonest first. Exams whose day has passed are marked done.
export async function examsCovering(element: Pick<LocusElement, 'id' | 'locusId'>, now: number): Promise<Exam[]> {
  const out: Exam[] = []
  for (const exam of await listExams(element.locusId)) {
    if (!(await settle(exam, now))) continue
    if ((await scopeOf(exam)).some((e) => e.id === element.id)) out.push(exam)
  }
  return out
}

// 5. Whether the exam is still upcoming; marks it done once its day has passed.
export async function settle(exam: Exam, now: number): Promise<boolean> {
  if (exam.status === 'done') return false
  if (isUpcoming(exam, now)) return true
  await db.exams.update(exam.id, { status: 'done', updatedAt: now })
  exam.status = 'done'
  return false
}

export interface ExamProgress {
  readiness: number | null // 0..1; null with nothing in scope
  unseen: number
  pacePerDay: number // new items a day it takes to see them all in time (after the user's cap)
  suggestedPace: number // before the user's cap
  items: number
}

// Readiness and pacing for an exam, across everything in scope.
export async function examProgress(exam: Exam, now: number): Promise<ExamProgress> {
  const scope = await scopeOf(exam)
  const ids = scope.map((e) => e.id)
  const srs = [
    ...(await db.cards.where('elementId').anyOf(ids).toArray()).map((c) => c.srs),
    ...(await db.problemTemplates.where('elementId').anyOf(ids).toArray()).filter((t) => !t.tooTight).map((t) => t.srs),
  ]
  const unseen = srs.filter(isNewSrs).length
  const suggested = pace(unseen, daysLeft(exam, now))
  return {
    readiness: srs.length ? srs.reduce((s, x) => s + examRecall(x, exam), 0) / srs.length : null,
    unseen,
    suggestedPace: suggested,
    pacePerDay: exam.newPerDay != null ? Math.min(exam.newPerDay, suggested) : suggested,
    items: srs.length,
  }
}

// What upcoming exams change about today's study for these elements: higher daily
// new limits (pacing), and the final pass.
export interface ExamAdjustments {
  newLimits: Map<string, number>
  finalPass: Map<string, Pick<Exam, 'date' | 'targetRecall'>>
}

export async function examAdjustments(elements: LocusElement[], now: number): Promise<ExamAdjustments> {
  const adj: ExamAdjustments = { newLimits: new Map(), finalPass: new Map() }
  const loci = [...new Set(elements.map((e) => e.locusId))]
  for (const locusId of loci) {
    for (const exam of await listExams(locusId)) {
      if (!(await settle(exam, now))) continue
      const scope = (await scopeOf(exam)).filter((e) => elements.some((x) => x.id === e.id))
      const progress = await examProgress(exam, now)
      for (const el of scope) {
        const unseen =
          el.type === 'flashcards'
            ? (await db.cards.where('elementId').equals(el.id).toArray()).filter((c) => isNewSrs(c.srs)).length
            : (await db.problemTemplates.where('elementId').equals(el.id).toArray()).filter((t) => !t.tooTight && isNewSrs(t.srs)).length
        // This element's share of the exam's pace (the user may have lowered the total).
        const share = progress.unseen ? Math.ceil((progress.pacePerDay * unseen) / progress.unseen) : 0
        const own = (el.data as { newPerDay?: number }).newPerDay ?? 0
        // Pacing only ever raises the element's own limit.
        if (share > own) adj.newLimits.set(el.id, Math.max(adj.newLimits.get(el.id) ?? 0, share))
        const current = adj.finalPass.get(el.id)
        if (inFinalDays(exam, now) && (!current || exam.date < current.date)) adj.finalPass.set(el.id, { date: exam.date, targetRecall: exam.targetRecall })
      }
    }
  }
  return adj
}

// ---------- Editing ----------

export interface ExamDraft {
  title: string
  date: number
  targetRecall: number
  newPerDay?: number
  scope: string[] | null // element ids; null = everything in the locus
}

export async function saveExam(locusId: string, draft: ExamDraft, id?: string): Promise<Exam> {
  const now = Date.now()
  return db.transaction('rw', db.exams, db.links, async () => {
    const old = id ? await db.exams.get(id) : undefined
    const exam: Exam = {
      id: old?.id ?? crypto.randomUUID(),
      locusId,
      title: draft.title.trim(),
      date: draft.date,
      targetRecall: draft.targetRecall,
      ...(draft.newPerDay != null && { newPerDay: draft.newPerDay }),
      // A new date in the future makes a finished exam upcoming again.
      status: isUpcoming({ ...(old as Exam), date: draft.date, status: 'upcoming' }, now) ? 'upcoming' : 'done',
      createdAt: old?.createdAt ?? now,
      updatedAt: now,
    }
    await db.exams.put(exam)
    await db.links.where('[to.type+to.id]').equals(['exam', exam.id]).filter((l) => l.kind === 'scope').delete()
    for (const elementId of draft.scope ?? []) {
      await db.links.add({ id: crypto.randomUUID(), from: { type: 'element', id: elementId }, to: { type: 'exam', id: exam.id }, kind: 'scope', createdAt: now, updatedAt: now })
    }
    return exam
  })
}

export async function deleteExam(id: string): Promise<void> {
  await db.transaction('rw', db.exams, db.links, async () => {
    await deleteLinksFor([{ type: 'exam', id }])
    await db.exams.delete(id)
  })
}
