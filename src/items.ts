// Turns an ItemRef into something to show: title, kind, color and where tapping it
// goes. Used by Linked items and the Link to… picker. Each new item type (note,
// to-do, goal…) adds its case here.

import { registry } from './elements/registry'
import { elementHash, go, subHash } from './router'
import { db } from './store/db'
import type { ItemRef, Locus } from './types'

export interface ItemInfo {
  ref: ItemRef
  title: string
  kind: string // "Locus", "Flashcards", "Card"
  context?: string // where it lives: "Spanish › Verbs"
  color: string // its locus's color
  open(): void
}

const NO_COLOR = '#9aa5b1'

export async function describeItem(ref: ItemRef): Promise<ItemInfo | null> {
  switch (ref.type) {
    case 'locus': {
      const locus = await db.loci.get(ref.id)
      return locus ? locusInfo(locus) : null
    }
    case 'element': {
      const el = await db.elements.get(ref.id)
      if (!el) return null
      const locus = await db.loci.get(el.locusId)
      return {
        ref,
        title: el.title,
        kind: registry.get(el.type)?.label ?? 'Element',
        context: locus?.name,
        color: locus?.color ?? NO_COLOR,
        open: () => go(elementHash(el)),
      }
    }
    case 'card': {
      const card = await db.cards.get(ref.id)
      const deck = card && (await db.elements.get(card.elementId))
      if (!card || !deck) return null
      const locus = await db.loci.get(deck.locusId)
      return {
        ref,
        title: card.front,
        kind: 'Card',
        context: [locus?.name, deck.title].filter(Boolean).join(' › '),
        color: locus?.color ?? NO_COLOR,
        open: () => go(elementHash(deck)),
      }
    }
    case 'note': {
      const note = await db.notes.get(ref.id)
      const book = note && (await db.elements.get(note.elementId))
      if (!note || !book) return null
      const locus = await db.loci.get(book.locusId)
      return {
        ref,
        title: note.title.trim() || 'Untitled',
        kind: 'Note',
        context: [locus?.name, book.title].filter(Boolean).join(' › '),
        color: locus?.color ?? NO_COLOR,
        open: () => go(subHash(book, 'note', note.id)),
      }
    }
    default:
      return null // a type from a later milestone
  }
}

function locusInfo(locus: Locus): ItemInfo {
  return {
    ref: { type: 'locus', id: locus.id },
    title: locus.name,
    kind: 'Locus',
    color: locus.color,
    open: () => go(`#/locus/${encodeURIComponent(locus.id)}`),
  }
}

const MAX_RESULTS = 40

// Items whose title (or a card's back, or a note's text) contains the query. With no query: loci and
// elements only, since a list of every card isn't useful.
export async function searchItems(query: string, exclude: ItemRef[]): Promise<ItemInfo[]> {
  const q = query.trim().toLowerCase()
  const skip = new Set(exclude.map((r) => `${r.type}:${r.id}`))
  const has = (text: string) => !q || text.toLowerCase().includes(q)
  const [loci, elements] = await Promise.all([db.loci.toArray(), db.elements.toArray()])
  const locusById = new Map(loci.map((l) => [l.id, l]))
  const elementById = new Map(elements.map((e) => [e.id, e]))

  const results: ItemInfo[] = []
  for (const locus of loci) if (has(locus.name)) results.push(locusInfo(locus))
  for (const el of elements) {
    if (!has(el.title)) continue
    const locus = locusById.get(el.locusId)
    results.push({
      ref: { type: 'element', id: el.id },
      title: el.title,
      kind: registry.get(el.type)?.label ?? 'Element',
      context: locus?.name,
      color: locus?.color ?? NO_COLOR,
      open: () => go(elementHash(el)),
    })
  }
  if (q) {
    const cards = await db.cards.filter((c) => c.front.toLowerCase().includes(q) || c.back.toLowerCase().includes(q)).limit(MAX_RESULTS).toArray()
    for (const card of cards) {
      const deck = elementById.get(card.elementId)
      if (!deck) continue
      const locus = locusById.get(deck.locusId)
      results.push({
        ref: { type: 'card', id: card.id },
        title: card.front,
        kind: 'Card',
        context: [locus?.name, deck.title].filter(Boolean).join(' › '),
        color: locus?.color ?? NO_COLOR,
        open: () => go(elementHash(deck)),
      })
    }
    const notes = await db.notes.filter((n) => n.title.toLowerCase().includes(q) || n.plainText.toLowerCase().includes(q)).limit(MAX_RESULTS).toArray()
    for (const note of notes) {
      const book = elementById.get(note.elementId)
      if (!book) continue
      const locus = locusById.get(book.locusId)
      results.push({
        ref: { type: 'note', id: note.id },
        title: note.title.trim() || 'Untitled',
        kind: 'Note',
        context: [locus?.name, book.title].filter(Boolean).join(' › '),
        color: locus?.color ?? NO_COLOR,
        open: () => go(subHash(book, 'note', note.id)),
      })
    }
  }
  return results.filter((r) => !skip.has(`${r.ref.type}:${r.ref.id}`)).slice(0, MAX_RESULTS)
}
