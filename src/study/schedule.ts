// The next FSRS state after a review, for cards and problem templates alike.
// One place, so Test mode can bend schedules toward an exam date for whatever
// is in its scope (SPEC-v2.md, "Test mode").

import { review } from '../elements/flashcards/srs'
import { capForExam, examsCovering } from '../exams/exams'
import { db } from '../store/db'
import type { Grade, ItemRef, Srs } from '../types'

export async function nextState(item: ItemRef & { elementId: string }, srs: Srs, grade: Grade, now: number, retention: number): Promise<Srs> {
  let next = review(srs, grade, now, retention)
  const element = await db.elements.get(item.elementId)
  if (!element) return next
  // Each upcoming exam covering it may bring the next review forward.
  for (const exam of await examsCovering(element, now)) next = capForExam(next, exam, now)
  return next
}
