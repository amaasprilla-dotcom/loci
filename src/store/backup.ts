// Backup files (SPEC.md, "Export / Import"). With no server, one JSON file is
// both the backup and the way to move data between phone and computer.
//
// Import either replaces everything, or merges by id: records only in the file
// are added, and for records on both sides the newer updatedAt wins. Merging
// can't know about deletions: something deleted here comes back if the file
// still has it.

import type { Card, Link, Locus, LocusElement, ReviewLog, Tag } from '../types'
import { db, migrateV1Cards, tagKey } from './db'

// 2: cards carry FSRS state (srs). Version 1 files (SM-2 cards) are converted on import.
export const BACKUP_VERSION = 2

export interface Backup {
  version: number
  exportedAt: number
  tags: Tag[]
  loci: Locus[]
  elements: LocusElement[]
  cards: Card[]
  reviews: ReviewLog[]
  links: Link[]
}

const TABLES = ['tags', 'loci', 'elements', 'cards', 'reviews', 'links'] as const
type TableName = (typeof TABLES)[number]
// Tables added after the first backups: a file from before them simply has none.
const ADDED_LATER = new Set<TableName>(['links'])

export async function exportBackup(now = Date.now()): Promise<Backup> {
  return db.transaction('r', [db.tags, db.loci, db.elements, db.cards, db.reviews, db.links], async () => ({
    version: BACKUP_VERSION,
    exportedAt: now,
    tags: await db.tags.toArray(),
    loci: await db.loci.toArray(),
    elements: await db.elements.toArray(),
    cards: await db.cards.toArray(),
    reviews: await db.reviews.toArray(),
    links: await db.links.toArray(),
  }))
}

export function backupFileName(now = Date.now()): string {
  const d = new Date(now)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `loci-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`
}

// A problem with the file, worded for the person importing it.
export class BackupError extends Error {}

// Reads and checks a backup file's text. Throws BackupError if it isn't one we can use.
export function parseBackup(text: string): Backup {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new BackupError('This file isn’t a Loci backup (it isn’t JSON).')
  }
  if (typeof data !== 'object' || data === null || !('version' in data)) {
    throw new BackupError('This file isn’t a Loci backup.')
  }
  const b = data as Record<string, unknown>
  if (typeof b.version !== 'number') throw new BackupError('This file isn’t a Loci backup.')
  if (b.version > BACKUP_VERSION) {
    throw new BackupError('This backup was made by a newer version of Loci. Update the app, then try again.')
  }
  for (const table of TABLES) {
    if (b[table] === undefined && ADDED_LATER.has(table)) b[table] = []
    const rows = b[table]
    if (!Array.isArray(rows)) throw new BackupError(`This backup is damaged: “${table}” is missing.`)
    for (const row of rows) {
      if (typeof row !== 'object' || row === null || typeof row.id !== 'string' || typeof row.updatedAt !== 'number') {
        throw new BackupError(`This backup is damaged: a record in “${table}” is incomplete.`)
      }
    }
  }
  return {
    version: b.version,
    exportedAt: typeof b.exportedAt === 'number' ? b.exportedAt : 0,
    // A tag's key is its lowercased name; rebuild it if a hand-edited file lost it.
    tags: (b.tags as Tag[]).map((t) => ({ ...t, key: typeof t.key === 'string' ? t.key : tagKey(String(t.name ?? '')) })),
    loci: (b.loci as Locus[]).map((l) => ({ ...l, tagIds: Array.isArray(l.tagIds) ? l.tagIds : [] })),
    elements: b.elements as LocusElement[],
    cards: migrateV1Cards(b.cards as Card[], b.reviews as ReviewLog[]),
    reviews: b.reviews as ReviewLog[],
    links: b.links as Link[],
  }
}

export type ImportSummary = Record<TableName, { added: number; updated: number }>

export async function importBackup(backup: Backup, mode: 'replace' | 'merge'): Promise<ImportSummary> {
  const summary = Object.fromEntries(TABLES.map((t) => [t, { added: 0, updated: 0 }])) as ImportSummary

  await db.transaction('rw', [db.tags, db.loci, db.elements, db.cards, db.reviews, db.links], async () => {
    if (mode === 'replace') await Promise.all(TABLES.map((t) => db[t].clear()))

    // Tags: names are unique ignoring case. If both sides made "Math" separately,
    // keep ours and point the file's loci at it.
    const tagIdMap = new Map<string, string>()
    for (const tag of backup.tags) {
      const sameId = await db.tags.get(tag.id)
      const sameKey = await db.tags.where('key').equals(tag.key).first()
      if (sameKey && sameKey.id !== tag.id) {
        tagIdMap.set(tag.id, sameKey.id)
        continue
      }
      if (!sameId) {
        await db.tags.add(tag)
        summary.tags.added++
      } else if (tag.updatedAt > sameId.updatedAt) {
        await db.tags.put(tag)
        summary.tags.updated++
      }
    }
    const loci = backup.loci.map((l) => ({ ...l, tagIds: [...new Set(l.tagIds.map((id) => tagIdMap.get(id) ?? id))] }))

    await mergeInto('loci', loci, summary)
    await mergeInto('elements', backup.elements, summary)
    await mergeInto('cards', backup.cards, summary)
    await mergeInto('reviews', backup.reviews, summary)
    await mergeInto('links', backup.links, summary)
  })
  return summary
}

// Adds records we don't have; replaces ours when the file's copy is newer.
async function mergeInto<T extends { id: string; updatedAt: number }>(table: Exclude<TableName, 'tags'>, rows: T[], summary: ImportSummary) {
  const t = db.table<T, string>(table)
  const existing = await t.bulkGet(rows.map((r) => r.id))
  const puts: T[] = []
  rows.forEach((row, i) => {
    const ours = existing[i]
    if (!ours) summary[table].added++
    else if (row.updatedAt > ours.updatedAt) summary[table].updated++
    else return
    puts.push(row)
  })
  await t.bulkPut(puts)
}

// "3 loci, 2 decks, 140 cards" — for the import screens.
export function describeBackup(b: Pick<Backup, 'loci' | 'elements' | 'cards'>): string {
  const n = (count: number, one: string, many: string) => `${count.toLocaleString()} ${count === 1 ? one : many}`
  return [n(b.loci.length, 'locus', 'loci'), n(b.elements.length, 'element', 'elements'), n(b.cards.length, 'card', 'cards')].join(', ')
}
