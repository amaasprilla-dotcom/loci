import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { recordReview } from '../elements/flashcards/session'
import { schedule } from '../elements/flashcards/srs'
import { addCards, DEFAULT_FLASHCARDS_DATA, listCards } from '../elements/flashcards/store'
import { createElement, createLocus, db } from '../store/db'
import { allTasks, nextUpcoming } from './tasks'

const at = (day: number, h: number) => new Date(2026, 0, day, h).getTime()

async function deckWith(locusName: string, title: string, reviewedOn: number[]) {
  const locus = (await db.loci.toArray()).find((l) => l.name === locusName) ?? (await createLocus({ name: locusName, color: '#000000', x: 0.5, y: 0.5 }))
  const deck = await createElement(locus.id, 'flashcards', title, { ...DEFAULT_FLASHCARDS_DATA })
  await addCards(deck.id, reviewedOn.map((_, i) => ({ front: `${title} ${i}`, back: 'x' })))
  const cards = await listCards(deck.id)
  for (const [i, when] of reviewedOn.entries()) await recordReview(cards[i], schedule(cards[i], 2, when, 0.5), 2, when)
  return { locus, deck }
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('allTasks', () => {
  it('lists one task per deck with due reviews, in locus then deck order', async () => {
    const spanish = await deckWith('Spanish', 'Verbs', [at(5, 10), at(5, 10)]) // both due 6 Jan 04:00
    await deckWith('Spanish', 'Nouns', [at(9, 10)]) // due 10 Jan 04:00
    await deckWith('Math', 'Proofs', [at(10, 10)]) // due 11 Jan: not yet
    await deckWith('Math', 'Formulas', [at(8, 10)])

    const tasks = await allTasks(at(10, 12))
    expect(tasks.map((t) => t.label)).toEqual(['2 cards due', '1 card due', '1 card due'])
    expect(tasks[0]).toMatchObject({ locusId: spanish.locus.id, elementId: spanish.deck.id, count: 2 })
  })

  it('ignores element types this version does not know', async () => {
    const locus = await createLocus({ name: 'Future', color: '#000000', x: 0.5, y: 0.5 })
    await createElement(locus.id, 'todo-list', 'Errands', {})
    expect(await allTasks(at(10, 12))).toEqual([])
  })
})

describe('nextUpcoming', () => {
  it('finds the deck whose next review comes soonest', async () => {
    await deckWith('Spanish', 'Verbs', [at(10, 9)]) // Good from new: 1 day → 11 Jan 04:00
    const { deck } = await deckWith('Math', 'Proofs', [at(10, 9)])
    const cards = await listCards(deck.id)
    // Make Proofs come up sooner: graded Again → 10 minutes.
    await recordReview(cards[0], schedule(cards[0], 0, at(10, 11), 0.5), 0, at(10, 11))
    expect(await nextUpcoming(at(10, 11))).toMatchObject({ title: 'Proofs', at: at(10, 11) + 10 * 60_000 })
  })

  it('can be limited to some loci, and is null when nothing is scheduled', async () => {
    const { locus } = await deckWith('Spanish', 'Verbs', [at(10, 9)])
    expect(await nextUpcoming(at(10, 12), new Set(['another-locus']))).toBeNull()
    expect(await nextUpcoming(at(10, 12), new Set([locus.id]))).toMatchObject({ title: 'Verbs', at: at(11, 4) })
  })
})
