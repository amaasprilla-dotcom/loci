// Reading and writing the cards of a flashcard deck.

import { db } from '../../store/db'
import type { Card } from '../../types'
import { isNewSrs, newSrs } from './srs'

export interface FlashcardsData {
  newPerDay: number // new cards introduced per day
  maxReviewsPerDay: number
}

export const DEFAULT_FLASHCARDS_DATA: FlashcardsData = { newPerDay: 20, maxReviewsPerDay: 200 }

// A card that has never been reviewed.
export function isNew(card: Card): boolean {
  return isNewSrs(card.srs)
}

export async function listCards(elementId: string): Promise<Card[]> {
  const cards = await db.cards.where('elementId').equals(elementId).toArray()
  return cards.sort((a, b) => a.createdAt - b.createdAt)
}

function newCard(elementId: string, front: string, back: string, now: number): Card {
  return { id: crypto.randomUUID(), elementId, front, back, srs: newSrs(now), createdAt: now, updatedAt: now }
}

export async function addCard(elementId: string, front: string, back: string): Promise<Card> {
  const card = newCard(elementId, front.trim(), back.trim(), Date.now())
  await db.cards.add(card)
  return card
}

// Adds many cards at once. createdAt goes up by 1ms per card so they keep their order.
export async function addCards(elementId: string, pairs: { front: string; back: string }[]): Promise<number> {
  const start = Date.now()
  await db.cards.bulkAdd(pairs.map((p, i) => newCard(elementId, p.front, p.back, start + i)))
  return pairs.length
}

export async function updateCard(id: string, front: string, back: string): Promise<void> {
  await db.cards.update(id, { front: front.trim(), back: back.trim(), updatedAt: Date.now() })
}

export async function deleteCard(id: string): Promise<void> {
  await db.transaction('rw', db.cards, db.reviews, async () => {
    await db.reviews.where('cardId').equals(id).delete()
    await db.cards.delete(id)
  })
}

export interface DeckStats {
  total: number
  due: number // reviewed before and due now
  fresh: number // never reviewed
  nextDue: number | null // the soonest due time among cards not due yet
}

export function deckStats(cards: Card[], now: number): DeckStats {
  let due = 0
  let fresh = 0
  let nextDue: number | null = null
  for (const c of cards) {
    if (isNew(c)) fresh++
    else if (c.srs.due <= now) due++
    else if (nextDue == null || c.srs.due < nextDue) nextDue = c.srs.due
  }
  return { total: cards.length, due, fresh, nextDue }
}
