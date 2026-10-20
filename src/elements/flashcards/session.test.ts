import 'fake-indexeddb/auto' // an in-memory IndexedDB, so the real Dexie code runs in tests
import { beforeEach, describe, expect, it } from 'vitest'
import { createElement, createLocus, db } from '../../store/db'
import type { Grade, LocusElement } from '../../types'
import { planSession, recordReview } from './session'
import { MIN, review } from './srs'
import { addCards, DEFAULT_FLASHCARDS_DATA, type FlashcardsData, listCards } from './store'
import { flashcardsType } from './type'

const at = (day: number, h: number, m = 0, s = 0, ms = 0) => new Date(2026, 0, day, h, m, s, ms).getTime()

let deck: LocusElement<FlashcardsData>

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  const locus = await createLocus({ name: 'Spanish', color: '#4f8ef7', x: 0.5, y: 0.5 })
  deck = await createElement(locus.id, 'flashcards', 'Verbs', { ...DEFAULT_FLASHCARDS_DATA })
})

const card = async (front: string) => (await listCards(deck.id)).find((c) => c.front === front)!

async function grade(front: string, g: Grade, when: number) {
  const c = await card(front)
  await recordReview(c, { ...c, srs: review(c.srs, g, when), updatedAt: when }, g, when)
}

// Good, then Good again after the 10-minute learning step: the card graduates to day-scale reviews.
async function learn(front: string, when: number) {
  await grade(front, 2, when)
  await grade(front, 2, when + 10 * MIN)
}

describe('due count at the 04:00 boundary', () => {
  it('a learned card is due from 04:00 on its day, not a moment before', async () => {
    await addCards(deck.id, [{ front: 'hablar', back: 'to speak' }])
    await learn('hablar', at(10, 15))
    const due = (await card('hablar')).srs.due
    expect(new Date(due).getHours()).toBe(4)
    expect(await flashcardsType.getTasks(deck, due - 1)).toEqual([])
    const tasks = await flashcardsType.getTasks(deck, due)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ count: 1, label: '1 card due', elementId: deck.id })
  })

  it('never-studied cards are not tasks', async () => {
    await addCards(deck.id, [{ front: 'comer', back: 'to eat' }])
    expect(await flashcardsType.getTasks(deck, at(20, 12))).toEqual([])
  })
})

describe('review log', () => {
  it('records grade, time and the days scheduled before each review', async () => {
    await addCards(deck.id, [{ front: 'ser', back: 'to be' }])
    await learn('ser', at(10, 15))
    const scheduled = (await card('ser')).srs.scheduled_days
    await grade('ser', 3, at(20, 9))
    const logs = (await db.reviews.toArray()).sort((a, b) => a.at - b.at)
    expect(logs.map((l) => [l.grade, l.at, l.prevInterval])).toEqual([
      [2, at(10, 15), 0],
      [2, at(10, 15, 10), 0],
      [3, at(20, 9), scheduled],
    ])
  })
})

describe('planSession', () => {
  it('shows due reviews oldest first, then new cards up to the daily limit', async () => {
    deck.data.newPerDay = 2
    await addCards(deck.id, ['a', 'b', 'c', 'd', 'e'].map((f) => ({ front: f, back: f })))
    await learn('a', at(2, 10))
    await learn('b', at(1, 10)) // learned earlier, so due earlier
    const queue = await planSession(deck, at(20, 12))
    expect(queue.map((c) => c.front)).toEqual(['b', 'a', 'c', 'd'])
  })

  it('new cards already introduced today count toward the limit', async () => {
    deck.data.newPerDay = 2
    await addCards(deck.id, ['a', 'b', 'c', 'd'].map((f) => ({ front: f, back: f })))
    await learn('a', at(10, 9)) // introduced this morning
    expect((await planSession(deck, at(10, 12))).map((c) => c.front)).toEqual(['b'])
    // A new study day brings a fresh limit.
    expect((await planSession(deck, at(11, 5))).map((c) => c.front).filter((f) => f !== 'a')).toEqual(['b', 'c'])
  })

  it('reviews already done today count toward the review limit', async () => {
    deck.data.maxReviewsPerDay = 2
    deck.data.newPerDay = 0
    await addCards(deck.id, ['a', 'b', 'c'].map((f) => ({ front: f, back: f })))
    for (const f of ['a', 'b', 'c']) await learn(f, at(1, 10))
    await grade('a', 2, at(20, 9)) // one review done this morning
    expect(await planSession(deck, at(20, 12))).toHaveLength(1)
  })
})
