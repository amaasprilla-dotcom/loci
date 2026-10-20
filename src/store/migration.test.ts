import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { State } from 'ts-fsrs'
import { describe, expect, it } from 'vitest'
import { migrateCard } from '../elements/flashcards/srs'
import type { Card, ReviewLog } from '../types'

const at = (day: number, h: number, m = 0) => new Date(2026, 0, day, h, m).getTime()

// A database exactly as v1 left it: SM-2 cards, review history, no srs.
async function makeV1Database() {
  const v1 = new Dexie('loci')
  v1.version(1).stores({ tags: 'id, &key', loci: 'id', elements: 'id, locusId', cards: 'id, elementId, [elementId+due]', reviews: 'id, cardId, at' })
  const base = { elementId: 'deck', back: 'x', ease: 2.5, createdAt: at(1, 9), updatedAt: at(1, 9) }
  const cards = [
    { ...base, id: 'studied', front: 'hablar', due: at(9, 4), interval: 6, reps: 2, lapses: 0 },
    { ...base, id: 'no-history', front: 'comer', due: at(20, 4), interval: 12, reps: 3, lapses: 1 },
    { ...base, id: 'new', front: 'vivir', due: at(1, 9), interval: 0, reps: 0, lapses: 0 },
  ]
  const logs: ReviewLog[] = [
    { id: 'l2', cardId: 'studied', at: at(3, 10), grade: 2, prevInterval: 1, updatedAt: 0 },
    { id: 'l1', cardId: 'studied', at: at(2, 10), grade: 2, prevInterval: 0, updatedAt: 0 },
  ]
  await v1.table('cards').bulkAdd(cards)
  await v1.table('reviews').bulkAdd(logs)
  v1.close()
  return { cards: cards as unknown as Card[], logs }
}

describe('opening a v1 database with v2', () => {
  it('gives every card its FSRS state once, replaying history, and re-indexes due', async () => {
    const { cards, logs } = await makeV1Database()
    const { db } = await import('./db') // first open: the version 2 upgrade runs

    const migrated = await db.cards.toArray()
    const byId = Object.fromEntries(migrated.map((c) => [c.id, c]))
    expect(byId.studied.srs).toEqual(migrateCard(cards[0], logs))
    expect(byId.studied.srs.reps).toBe(2)
    expect(byId['no-history'].srs).toMatchObject({ state: State.Review, stability: 12, due: at(20, 4) })
    expect(byId.new.srs.state).toBe(State.New)
    // The old SM-2 fields stay on the record, unused.
    expect(byId.studied).toMatchObject({ interval: 6, ease: 2.5 })

    // The new index answers "due in this deck" from srs.due.
    const due = await db.cards.where('[elementId+srs.due]').between(['deck', 0], ['deck', at(21, 0)], true, true).primaryKeys()
    expect(due.sort()).toEqual(['new', 'no-history', 'studied'])
    expect(await db.reviews.count()).toBe(2) // history kept
  })
})
