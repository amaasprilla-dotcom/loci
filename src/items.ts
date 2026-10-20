// Turns an ItemRef into something to show: title, kind, color and where tapping it
// goes. Used by Linked items and the Link to… picker. Each new item type (note,
// to-do, goal…) adds its case here.

import { registry } from './elements/registry'
import { elementHash, go, subHash } from './router'
import { db } from './store/db'
import type { Goal, ItemRef, Locus } from './types'

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
    case 'todo': {
      const todo = await db.todos.get(ref.id)
      const list = todo && (await db.elements.get(todo.elementId))
      if (!todo || !list) return null
      const locus = await db.loci.get(list.locusId)
      return {
        ref,
        title: todo.title,
        kind: todo.status === 'done' ? 'To-do (done)' : 'To-do',
        context: [locus?.name, list.title].filter(Boolean).join(' › '),
        color: locus?.color ?? NO_COLOR,
        open: () => go(subHash(list, 'todo', todo.id)),
      }
    }
    case 'goal': {
      const goal = await db.goals.get(ref.id)
      const list = goal && (await db.elements.get(goal.elementId))
      if (!goal || !list) return null
      const locus = await db.loci.get(list.locusId)
      return {
        ref,
        title: goal.title,
        kind: goalKind(goal.status),
        context: [locus?.name, list.title].filter(Boolean).join(' › '),
        color: locus?.color ?? NO_COLOR,
        open: () => go(subHash(list, 'goal', goal.id)),
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

const goalKind = (status: Goal['status']) => (status === 'achieved' ? 'Goal (achieved)' : status === 'archived' ? 'Goal (archived)' : 'Goal')

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
    const todos = await db.todos.filter((t) => t.status !== 'archived' && t.title.toLowerCase().includes(q)).limit(MAX_RESULTS).toArray()
    for (const todo of todos) {
      const list = elementById.get(todo.elementId)
      if (!list) continue
      const locus = locusById.get(list.locusId)
      results.push({
        ref: { type: 'todo', id: todo.id },
        title: todo.title,
        kind: todo.status === 'done' ? 'To-do (done)' : 'To-do',
        context: [locus?.name, list.title].filter(Boolean).join(' › '),
        color: locus?.color ?? NO_COLOR,
        open: () => go(subHash(list, 'todo', todo.id)),
      })
    }
    const goals = await db.goals.filter((g) => g.status !== 'archived' && (g.title.toLowerCase().includes(q) || (g.why ?? '').toLowerCase().includes(q))).limit(MAX_RESULTS).toArray()
    for (const goal of goals) {
      const list = elementById.get(goal.elementId)
      if (!list) continue
      const locus = locusById.get(list.locusId)
      results.push({
        ref: { type: 'goal', id: goal.id },
        title: goal.title,
        kind: goalKind(goal.status),
        context: [locus?.name, list.title].filter(Boolean).join(' › '),
        color: locus?.color ?? NO_COLOR,
        open: () => go(subHash(list, 'goal', goal.id)),
      })
    }
  }
  return results.filter((r) => !skip.has(`${r.ref.type}:${r.ref.id}`)).slice(0, MAX_RESULTS)
}
