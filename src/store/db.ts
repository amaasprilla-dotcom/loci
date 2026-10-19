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
