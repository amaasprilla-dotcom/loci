// The next FSRS state after a review, for cards and problem templates alike.
// One place, so Test mode can bend schedules toward an exam date for whatever
// is in its scope (SPEC-v2.md, "Test mode").

import { review } from '../elements/flashcards/srs'
import type { Grade, ItemRef, Srs } from '../types'

export async function nextState(_item: ItemRef & { elementId: string }, srs: Srs, grade: Grade, now: number, retention: number): Promise<Srs> {
  return review(srs, grade, now, retention)
}
