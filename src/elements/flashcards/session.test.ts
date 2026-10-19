import 'fake-indexeddb/auto' // an in-memory IndexedDB, so the real Dexie code runs in tests
import { beforeEach, describe, expect, it } from 'vitest'
import { createElement, createLocus, db } from '../../store/db'
import type { LocusElement } from '../../types'
import { planSession, recordReview } from './session'
import { schedule } from './srs'
import { addCards, DEFAULT_FLASHCARDS_DATA, type FlashcardsData, listCards } from './store'
import { flashcardsType } from './type'

const at = (day: number, h: number, m = 0, s = 0, ms = 0) => new Date(2026, 0, day, h, m, s, ms).getTime()

let deck: LocusElement<FlashcardsData>

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  const locus = await createLocus({ name: 'Spanish', color: '#4f8ef7', x: 0.5, y: 0.5 })
  deck = await createElement(locus.id, 'flashcards', 'Verbs', { ...DEFAULT_FLASHCARDS_DATA })
})

async function review(cardFront: string, grade: 0 | 1 | 2 | 3, when: number) {
  const card = (await listCards(deck.id)).find((c) => c.front === cardFront)!
  await recordReview(card, schedule(card, grade, when, 0.5), grade, when)
}

describe('due count at the 04:00 boundary', () => {
  it('a card reviewed Good at 15:00 is due from 04:00 the next morning, not a moment before', async () => {
    await addCards(deck.id, [{ front: 'hablar', back: 'to speak' }])
    await review('hablar', 2, at(10, 15))
    expect(await flashcardsType.getTasks(deck, at(11, 3, 59, 59, 999))).toEqual([])
    const tasks = await flashcardsType.getTasks(deck, at(11, 4))
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ count: 1, label: '1 card due', elementId: deck.id })
  })

  it('never-studied cards are not tasks', async () => {
    await addCards(deck.id, [{ front: 'comer', back: 'to eat' }])
    expect(await flashcardsType.getTasks(deck, at(20, 12))).toEqual([])
  })
})

describe('review log', () => {
  it('records grade, time and the interval before the review', async () => {
    await addCards(deck.id, [{ front: 'ser', back: 'to be' }])
    await review('ser', 2, at(10, 15)) // interval 0 → 1
    await review('ser', 2, at(11, 9)) // interval 1 → 6
    const logs = (await db.reviews.toArray()).sort((a, b) => a.at - b.at)
    expect(logs.map((l) => [l.grade, l.at, l.prevInterval])).toEqual([
      [2, at(10, 15), 0],
      [2, at(11, 9), 1],
    ])
  })
})

describe('planSession', () => {
  it('shows due reviews oldest first, then new cards up to the daily limit', async () => {
    deck.data.newPerDay = 2
    await addCards(deck.id, ['a', 'b', 'c', 'd', 'e'].map((f) => ({ front: f, back: f })))
    await review('a', 2, at(8, 10)) // due 9 Jan 04:00
    await review('b', 2, at(7, 10)) // due 8 Jan 04:00 (older)
    const queue = await planSession(deck, at(10, 12))
    expect(queue.map((c) => c.front)).toEqual(['b', 'a', 'c', 'd'])
  })

  it('new cards already introduced today count toward the limit', async () => {
    deck.data.newPerDay = 2
    await addCards(deck.id, ['a', 'b', 'c', 'd'].map((f) => ({ front: f, back: f })))
    await review('a', 2, at(10, 9)) // introduced this morning
    expect((await planSession(deck, at(10, 12))).map((c) => c.front)).toEqual(['b'])
    // Next study day, the limit is fresh again (and 'a' is not due until 11 Jan 04:00... which is now).
    expect((await planSession(deck, at(11, 5))).map((c) => c.front)).toEqual(['a', 'b', 'c'])
  })

  it('reviews already done today count toward the review limit', async () => {
    deck.data.maxReviewsPerDay = 2
    deck.data.newPerDay = 0
    await addCards(deck.id, ['a', 'b', 'c'].map((f) => ({ front: f, back: f })))
    for (const f of ['a', 'b', 'c']) await review(f, 2, at(5, 10)) // all due 6 Jan 04:00
    await review('a', 2, at(10, 9)) // one review done this morning
    expect(await planSession(deck, at(10, 12))).toHaveLength(1)
  })
})
