import 'fake-indexeddb/auto'
import '../elements/all'
import { beforeEach, describe, expect, it } from 'vitest'
import { recordReview } from '../elements/flashcards/session'
import { MIN, review } from '../elements/flashcards/srs'
import { addCards, DEFAULT_FLASHCARDS_DATA, listCards } from '../elements/flashcards/store'
import { createElement, createLocus, db } from '../store/db'
import type { Grade } from '../types'
import { allTasks, nextUpcoming } from './tasks'

const at = (day: number, h: number) => new Date(2026, 0, day, h).getTime()

async function grade(cardId: string, g: Grade, when: number) {
  const c = (await db.cards.get(cardId))!
  await recordReview(c, { ...c, srs: review(c.srs, g, when), updatedAt: when }, g, when)
}

// A deck with one card per date, each learned then (Good, and Good again after the
// 10-minute step), so it moves on to reviews a few days later.
async function deckWith(locusName: string, title: string, learnedOn: number[]) {
  const locus = (await db.loci.toArray()).find((l) => l.name === locusName) ?? (await createLocus({ name: locusName, color: '#000000', x: 0.5, y: 0.5 }))
  const deck = await createElement(locus.id, 'flashcards', title, { ...DEFAULT_FLASHCARDS_DATA })
  await addCards(deck.id, learnedOn.map((_, i) => ({ front: `${title} ${i}`, back: 'x' })))
  const cards = await listCards(deck.id)
  for (const [i, when] of learnedOn.entries()) {
    await grade(cards[i].id, 2, when)
    await grade(cards[i].id, 2, when + 10 * MIN)
  }
  return { locus, deck, cards }
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('allTasks', () => {
  it('lists one review task per deck with due reviews', async () => {
    const spanish = await deckWith('Spanish', 'Verbs', [at(1, 10), at(1, 10)])
    await deckWith('Spanish', 'Nouns', [at(2, 10)])
    await deckWith('Math', 'Proofs', [at(10, 10)]) // learned this morning: not due yet
    await deckWith('Math', 'Formulas', [at(3, 10)])

    const tasks = await allTasks(at(10, 12))
    expect(tasks.map((t) => t.label).sort()).toEqual(['1 card due', '1 card due', '2 cards due'])
    expect(tasks.find((t) => t.elementId === spanish.deck.id)).toMatchObject({
      locusId: spanish.locus.id,
      kind: 'review',
      importance: 3, // the locus's study priority defaults: High
      difficulty: 2, // Medium
    })
  })

  it('reviews are overdue once they have waited past a 04:00 rollover, due before that', async () => {
    const { deck, cards } = await deckWith('Spanish', 'Verbs', [at(1, 10)])
    const due = (await db.cards.get(cards[0].id))!.srs.due // 04:00 on some day
    const [onTheDay] = await allTasks(due + 23 * 60 * MIN) // 03:00 the next night: same study day
    const [nextDay] = await allTasks(due + 24 * 60 * MIN) // 04:00 the next day
    expect(onTheDay).toMatchObject({ elementId: deck.id, state: 'due' })
    expect(nextDay).toMatchObject({ elementId: deck.id, state: 'overdue' })
    expect(nextDay.sublabel).toMatch(/^Waiting since /)
  })

  it('a locus can rank its reviews differently', async () => {
    const { locus } = await deckWith('Spanish', 'Verbs', [at(1, 10)])
    await db.loci.update(locus.id, { studyImportance: 4, studyDifficulty: 1 })
    expect((await allTasks(at(20, 12)))[0]).toMatchObject({ importance: 4, difficulty: 1 })
  })

  it('ignores element types this version does not know', async () => {
    const locus = await createLocus({ name: 'Future', color: '#000000', x: 0.5, y: 0.5 })
    await createElement(locus.id, 'todo-list', 'Errands', {})
    expect(await allTasks(at(10, 12))).toEqual([])
  })
})

describe('nextUpcoming', () => {
  it('finds the deck whose next review comes soonest', async () => {
    await deckWith('Spanish', 'Verbs', [at(10, 9)]) // reviews in a few days
    const { deck } = await deckWith('Math', 'Proofs', [])
    await addCards(deck.id, [{ front: 'q', back: 'a' }])
    // Proofs comes up sooner: a new card graded Again is back in 1 minute.
    await grade((await listCards(deck.id))[0].id, 0, at(10, 11))
    expect(await nextUpcoming(at(10, 11))).toMatchObject({ title: 'Proofs', at: at(10, 11) + 1 * MIN })
  })

  it('can be limited to some loci, and is null when nothing is scheduled', async () => {
    const { locus, cards } = await deckWith('Spanish', 'Verbs', [at(10, 9)])
    const due = (await db.cards.get(cards[0].id))!.srs.due
    expect(await nextUpcoming(at(10, 12), new Set(['another-locus']))).toBeNull()
    expect(await nextUpcoming(at(10, 12), new Set([locus.id]))).toMatchObject({ title: 'Verbs', at: due })
  })
})
