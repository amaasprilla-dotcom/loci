// IndexedDB storage through Dexie. All data stays on this device.

import Dexie, { type EntityTable } from 'dexie'
import type { Card, Locus, LocusElement, ReviewLog, Tag } from '../types'

export const db = new Dexie('loci') as Dexie & {
  tags: EntityTable<Tag, 'id'>
  loci: EntityTable<Locus, 'id'>
  elements: EntityTable<LocusElement, 'id'>
  cards: EntityTable<Card, 'id'>
  reviews: EntityTable<ReviewLog, 'id'>
}

db.version(1).stores({
  tags: 'id, &key',
  loci: 'id',
  elements: 'id, locusId',
  cards: 'id, elementId, [elementId+due]', // "due cards in this deck" is one range query
  reviews: 'id, cardId, at',
})

// Ask the browser not to evict our data when the device runs low on space.
// Browsers may say no (or ask the user); the app works either way.
export async function requestPersistentStorage(): Promise<void> {
  if (!navigator.storage?.persist) return
  if (await navigator.storage.persisted()) return
  await navigator.storage.persist()
}

export const DEFAULT_RADIUS = 48

export async function listLoci(): Promise<Locus[]> {
  const loci = await db.loci.toArray()
  return loci.sort((a, b) => a.createdAt - b.createdAt)
}

export async function createLocus(input: {
  name: string
  color: string
  tagIds?: string[]
  x: number
  y: number
}): Promise<Locus> {
  const now = Date.now()
  const locus: Locus = {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    color: input.color,
    tagIds: input.tagIds ?? [],
    x: input.x,
    y: input.y,
    radius: DEFAULT_RADIUS,
    createdAt: now,
    updatedAt: now,
  }
  await db.loci.add(locus)
  return locus
}

// x and y are the new home position, normalized 0..1 of the field.
export async function moveLocus(id: string, x: number, y: number): Promise<void> {
  await db.loci.update(id, { x, y, updatedAt: Date.now() })
}

export async function updateLocus(id: string, patch: Pick<Locus, 'name' | 'color' | 'tagIds'>): Promise<void> {
  await db.transaction('rw', db.loci, db.tags, async () => {
    await db.loci.update(id, { ...patch, name: patch.name.trim(), updatedAt: Date.now() })
    await pruneUnusedTags()
  })
}

// Deletes the locus and everything in it: its elements, their cards and the cards' review history.
export async function deleteLocus(id: string): Promise<void> {
  await db.transaction('rw', [db.loci, db.elements, db.cards, db.reviews, db.tags], async () => {
    const elementIds = await db.elements.where('locusId').equals(id).primaryKeys()
    const cardIds = await db.cards.where('elementId').anyOf(elementIds).primaryKeys()
    await db.reviews.where('cardId').anyOf(cardIds).delete()
    await db.cards.bulkDelete(cardIds)
    await db.elements.bulkDelete(elementIds)
    await db.loci.delete(id)
    await pruneUnusedTags()
  })
}

// What deleting a locus would remove, for the confirmation message.
export async function countLocusContents(id: string): Promise<{ elements: number; cards: number }> {
  const elementIds = await db.elements.where('locusId').equals(id).primaryKeys()
  const cards = await db.cards.where('elementId').anyOf(elementIds).count()
  return { elements: elementIds.length, cards }
}

// ---------- Tags ----------

export function tagKey(name: string): string {
  return name.trim().toLowerCase()
}

export async function listTags(): Promise<Tag[]> {
  const tags = await db.tags.toArray()
  return tags.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

// Returns the tag with this name, matching case-insensitively, creating it if needed.
export async function findOrCreateTag(name: string): Promise<Tag> {
  return db.transaction('rw', db.tags, async () => {
    const key = tagKey(name)
    const existing = await db.tags.where('key').equals(key).first()
    if (existing) return existing
    const tag: Tag = { id: crypto.randomUUID(), name: name.trim(), key, updatedAt: Date.now() }
    await db.tags.add(tag)
    return tag
  })
}

// Tags only exist through the loci that carry them: once no locus uses a tag,
// it leaves the filter bar and the tag list.
async function pruneUnusedTags(): Promise<void> {
  const used = new Set((await db.loci.toArray()).flatMap((l) => l.tagIds))
  const unused = (await db.tags.toCollection().primaryKeys()).filter((id) => !used.has(id))
  await db.tags.bulkDelete(unused)
}
