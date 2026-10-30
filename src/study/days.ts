// The spacing strip (SPEC-v3-coach.md, "Spacing strip"): one dot per day for the
// last four weeks, filled on days something in the locus was studied. Practice
// spread across days beats the same amount in one go; this makes the spread visible.

import { studyDayStart } from '../elements/flashcards/srs'
import { db } from '../store/db'
import type { LocusElement } from '../types'

export const STRIP_DAYS = 28

// The start (04:00) of each of the last `days` study days, oldest first, today last.
// Built from dates, not by subtracting 24 h, so daylight-saving days stay whole.
export function dayStarts(now: number, days = STRIP_DAYS): number[] {
  const today = new Date(studyDayStart(now))
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(today)
    d.setDate(d.getDate() - (days - 1 - i))
    return d.getTime()
  })
}

// Which of those days had any study, given when items were studied.
export function studiedDays(times: number[], now: number, days = STRIP_DAYS): boolean[] {
  const starts = dayStarts(now, days)
  const out = starts.map(() => false)
  for (const t of times) {
    if (t < starts[0] || t > now) continue
    let k = starts.length - 1
    while (starts[k] > t) k--
    out[k] = true
  }
  return out
}

// When anything in these elements was studied since `since`: card reviews,
// problem attempts and note recalls.
export async function studyTimes(elements: LocusElement[], since: number): Promise<number[]> {
  const ids = elements.map((e) => e.id)
  const [cardIds, templateIds, noteIds] = (
    await Promise.all([
      db.cards.where('elementId').anyOf(ids).primaryKeys(),
      db.problemTemplates.where('elementId').anyOf(ids).primaryKeys(),
      db.notes.where('elementId').anyOf(ids).primaryKeys(),
    ])
  ).map((keys) => new Set(keys))
  const [reviews, attempts, recalls] = await Promise.all([
    db.reviews.where('at').aboveOrEqual(since).filter((r) => cardIds.has(r.cardId)).toArray(),
    db.problemAttempts.where('at').aboveOrEqual(since).filter((a) => templateIds.has(a.templateId)).toArray(),
    db.recallAttempts.where('at').aboveOrEqual(since).filter((a) => noteIds.has(a.noteId)).toArray(),
  ])
  return [...reviews, ...attempts, ...recalls].map((x) => x.at)
}
