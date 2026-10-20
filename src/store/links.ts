// Links between items (SPEC-v2.md, "Links"). One table holds every relationship;
// each item's Linked items section reads it in both directions.

import type { ItemRef, Link, LinkKind } from '../types'
import { db } from './db'

export const sameItem = (a: ItemRef, b: ItemRef): boolean => a.type === b.type && a.id === b.id

// Links `from` to `to`. Linking the same pair the same way twice gives back the
// existing link; for "related" (which has no direction) that includes the reverse.
export async function addLink(from: ItemRef, to: ItemRef, kind: LinkKind): Promise<Link> {
  if (sameItem(from, to)) throw new Error('An item can’t link to itself.')
  return db.transaction('rw', db.links, async () => {
    const existing = (await linksOf(from)).find(
      (l) => l.link.kind === kind && sameItem(l.other, to) && (kind === 'related' || l.direction === 'out'),
    )
    if (existing) return existing.link
    const now = Date.now()
    const link: Link = { id: crypto.randomUUID(), from, to, kind, createdAt: now, updatedAt: now }
    await db.links.add(link)
    return link
  })
}

export interface LinkEnd {
  link: Link
  other: ItemRef // the item at the other end
  direction: 'out' | 'in' // out: this item is `from`
}

// Every link touching an item, both directions, newest first.
export async function linksOf(item: ItemRef): Promise<LinkEnd[]> {
  const [out, inbound] = await Promise.all([
    db.links.where('[from.type+from.id]').equals([item.type, item.id]).toArray(),
    db.links.where('[to.type+to.id]').equals([item.type, item.id]).toArray(),
  ])
  return [
    ...out.map((link): LinkEnd => ({ link, other: link.to, direction: 'out' })),
    ...inbound.map((link): LinkEnd => ({ link, other: link.from, direction: 'in' })),
  ].sort((a, b) => b.link.createdAt - a.link.createdAt)
}

export async function removeLink(id: string): Promise<void> {
  await db.links.delete(id)
}
