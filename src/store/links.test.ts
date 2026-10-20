import 'fake-indexeddb/auto'
import '../elements/all'
import { beforeEach, describe, expect, it } from 'vitest'
import { addCards, deleteCard, DEFAULT_FLASHCARDS_DATA, listCards } from '../elements/flashcards/store'
import type { ItemRef } from '../types'
import { exportBackup, importBackup, parseBackup } from './backup'
import { createElement, createLocus, db, deleteElement, deleteLocus } from './db'
import { addLink, linksOf, removeLink } from './links'

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

async function world() {
  const spanish = await createLocus({ name: 'Spanish', color: '#000000', x: 0.5, y: 0.5 })
  const math = await createLocus({ name: 'Math', color: '#000000', x: 0.5, y: 0.5 })
  const deck = await createElement(spanish.id, 'flashcards', 'Verbs', { ...DEFAULT_FLASHCARDS_DATA })
  await addCards(deck.id, [{ front: 'hablar', back: 'to speak' }])
  const [card] = await listCards(deck.id)
  const ref = {
    spanish: { type: 'locus', id: spanish.id } as ItemRef,
    math: { type: 'locus', id: math.id } as ItemRef,
    deck: { type: 'element', id: deck.id } as ItemRef,
    card: { type: 'card', id: card.id } as ItemRef,
  }
  return { spanish, math, deck, card, ref }
}

describe('links', () => {
  it('are found from both ends', async () => {
    const { ref } = await world()
    const link = await addLink(ref.card, ref.math, 'related')
    expect(await linksOf(ref.card)).toEqual([{ link, other: ref.math, direction: 'out' }])
    expect(await linksOf(ref.math)).toEqual([{ link, other: ref.card, direction: 'in' }])
  })

  it('linking the same pair twice gives back the one link (either way round, for related)', async () => {
    const { ref } = await world()
    const a = await addLink(ref.deck, ref.math, 'related')
    expect(await addLink(ref.deck, ref.math, 'related')).toEqual(a)
    expect(await addLink(ref.math, ref.deck, 'related')).toEqual(a)
    expect(await db.links.count()).toBe(1)
  })

  it('an item cannot link to itself', async () => {
    const { ref } = await world()
    await expect(addLink(ref.deck, ref.deck, 'related')).rejects.toThrow()
  })

  it('can be removed', async () => {
    const { ref } = await world()
    const link = await addLink(ref.deck, ref.math, 'related')
    await removeLink(link.id)
    expect(await linksOf(ref.math)).toEqual([])
  })
})

describe('deleting an item deletes its links', () => {
  it('a card', async () => {
    const { ref, card } = await world()
    await addLink(ref.card, ref.math, 'related')
    await deleteCard(card.id)
    expect(await db.links.count()).toBe(0)
  })

  it('a deck, with its cards’ links', async () => {
    const { ref, deck } = await world()
    await addLink(ref.deck, ref.math, 'related')
    await addLink(ref.math, ref.card, 'related')
    await deleteElement(deck.id)
    expect(await db.links.count()).toBe(0)
  })

  it('a locus, with everything inside it, but not links elsewhere', async () => {
    const { ref, spanish } = await world()
    const other = await createLocus({ name: 'Other', color: '#000000', x: 0.5, y: 0.5 })
    await addLink(ref.card, ref.math, 'related')
    await addLink(ref.spanish, ref.math, 'related')
    const kept = await addLink(ref.math, { type: 'locus', id: other.id }, 'related')
    await deleteLocus(spanish.id)
    expect(await db.links.toArray()).toEqual([kept])
  })
})

describe('backup', () => {
  it('round-trips links', async () => {
    const { ref } = await world()
    const link = await addLink(ref.card, ref.math, 'related')
    const file = JSON.stringify(await exportBackup())
    await Promise.all(db.tables.map((t) => t.clear()))
    await importBackup(parseBackup(file), 'replace')
    expect(await db.links.toArray()).toEqual([link])
  })

  it('a backup from before links imports with none', () => {
    const old = { version: 2, exportedAt: 0, tags: [], loci: [], elements: [], cards: [], reviews: [] }
    expect(parseBackup(JSON.stringify(old)).links).toEqual([])
  })
})
