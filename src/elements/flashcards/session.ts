// Which cards a review session shows (SPEC.md, "Review session" step 1):
// cards due for review, oldest first, up to the deck's reviews-per-day limit,
// then up to its new-cards-per-day limit of never-studied cards.
// "Per day" is the study day, which starts at 04:00.

import { db } from '../../store/db'
import type { Card, LocusElement, ReviewLog } from '../../types'
import { studyDayStart } from './srs'
import { type FlashcardsData, isNew, listCards } from './store'

export async function planSession(el: LocusElement<FlashcardsData>, now: number): Promise<Card[]> {
  const cards = await listCards(el.id)
  const logs = await db.reviews.where('cardId').anyOf(cards.map((c) => c.id)).toArray()
  const { introducedToday, reviewedToday } = todaysCounts(logs, studyDayStart(now))

  const due = cards
    .filter((c) => !isNew(c) && c.srs.due <= now)
    .sort((a, b) => a.srs.due - b.srs.due)
    .slice(0, Math.max(0, el.data.maxReviewsPerDay - reviewedToday))
  const fresh = cards.filter(isNew).slice(0, Math.max(0, el.data.newPerDay - introducedToday))
  return [...due, ...fresh]
}

// introducedToday: cards whose first review ever was today (they were new).
// reviewedToday: other cards reviewed today.
export function todaysCounts(logs: ReviewLog[], dayStart: number): { introducedToday: number; reviewedToday: number } {
  const first = new Map<string, number>()
  const today = new Set<string>()
  for (const log of logs) {
    first.set(log.cardId, Math.min(first.get(log.cardId) ?? Infinity, log.at))
    if (log.at >= dayStart) today.add(log.cardId)
  }
  let introducedToday = 0
  for (const id of today) if (first.get(id)! >= dayStart) introducedToday++
  return { introducedToday, reviewedToday: today.size - introducedToday }
}

// Saves a graded card and its review log together. `after` carries the new FSRS state.
export async function recordReview(before: Card, after: Card, grade: ReviewLog['grade'], at: number): Promise<void> {
  await db.transaction('rw', db.cards, db.reviews, async () => {
    await db.cards.put(after)
    await db.reviews.add({ id: crypto.randomUUID(), cardId: before.id, at, grade, prevInterval: before.srs.scheduled_days, updatedAt: at })
  })
}
