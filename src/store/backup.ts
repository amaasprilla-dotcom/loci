// Backup files (SPEC.md, "Export / Import"; SPEC-v2.md, "Attachments"). With no
// server, one file is both the backup and the way to move data between devices.
// Since v2 it is a .zip: data.json plus blobs/<id> for attached files, which can't
// live in JSON. Older .json backups still import.
//
// Import either replaces everything, or merges by id: records only in the file
// are added, and for records on both sides the newer updatedAt wins. Merging
// can't know about deletions: something deleted here comes back if the file
// still has it.

import JSZip from 'jszip'
import { count } from '../locale'
import type { Attachment, Card, Contributor, Goal, GoalEntry, Link, Locus, LocusElement, Note, ReviewLog, Setting, StoredBlob, Tag, Todo, TodoCompletion } from '../types'
import { db, migrateV1Cards, tagKey } from './db'

// 1: v1 (SM-2 cards, .json). 2: cards carry FSRS state (.json).
// 3: a .zip with attachments, their files and settings. Older versions are converted on import.
export const BACKUP_VERSION = 3

export interface Backup {
  version: number
  exportedAt: number
  tags: Tag[]
  loci: Locus[]
  elements: LocusElement[]
  cards: Card[]
  reviews: ReviewLog[]
  links: Link[]
  attachments: Attachment[]
  blobs: StoredBlob[] // in data.json without `data`; the bytes are in blobs/<id>
  settings: Setting[]
  notes: Note[]
  todos: Todo[]
  todoCompletions: TodoCompletion[]
  goals: Goal[]
  goalContributors: Contributor[]
  goalEntries: GoalEntry[]
}

const TABLES = ['tags', 'loci', 'elements', 'cards', 'reviews', 'links', 'attachments', 'blobs', 'settings', 'notes', 'todos', 'todoCompletions', 'goals', 'goalContributors', 'goalEntries'] as const
type TableName = (typeof TABLES)[number]
// Tables added after the first backups: a file from before them simply has none.
const ADDED_LATER = new Set<TableName>(['links', 'attachments', 'blobs', 'settings', 'notes', 'todos', 'todoCompletions', 'goals', 'goalContributors', 'goalEntries'])
const ALL_TABLES = () => [
  db.tags,
  db.loci,
  db.elements,
  db.cards,
  db.reviews,
  db.links,
  db.attachments,
  db.blobs,
  db.settings,
  db.notes,
  db.todos,
  db.todoCompletions,
  db.goals,
  db.goalContributors,
  db.goalEntries,
]

export async function exportBackup(now = Date.now()): Promise<Backup> {
  return db.transaction('r', ALL_TABLES(), async () => ({
    version: BACKUP_VERSION,
    exportedAt: now,
    tags: await db.tags.toArray(),
    loci: await db.loci.toArray(),
    elements: await db.elements.toArray(),
    cards: await db.cards.toArray(),
    reviews: await db.reviews.toArray(),
    links: await db.links.toArray(),
    attachments: await db.attachments.toArray(),
    blobs: await db.blobs.toArray(),
    settings: await db.settings.toArray(),
    notes: await db.notes.toArray(),
    todos: await db.todos.toArray(),
    todoCompletions: await db.todoCompletions.toArray(),
    goals: await db.goals.toArray(),
    goalContributors: await db.goalContributors.toArray(),
    goalEntries: await db.goalEntries.toArray(),
  }))
}

// The backup as a .zip: data.json, plus each file under blobs/<id>.
export async function backupToZip(backup: Backup): Promise<Blob> {
  const zip = new JSZip()
  const data = { ...backup, blobs: backup.blobs.map(({ id, mime, size, updatedAt }) => ({ id, mime, size, updatedAt })) }
  zip.file('data.json', JSON.stringify(data))
  // Files are mostly photos and PDFs, already compressed: store them as they are.
  for (const b of backup.blobs) zip.file(`blobs/${b.id}`, await b.data.arrayBuffer(), { compression: 'STORE' })
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' })
}

export function backupFileName(now = Date.now()): string {
  const d = new Date(now)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `loci-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.zip`
}

// A problem with the file, worded for the person importing it.
export class BackupError extends Error {}

// Reads a backup file: a .zip (v2) or an older .json. Throws BackupError if it
// isn't one we can use.
export async function readBackupFile(file: Blob): Promise<Backup> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b // "PK"
  if (!isZip) return parseBackup(new TextDecoder().decode(bytes))

  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(bytes)
  } catch {
    throw new BackupError('This zip file can’t be opened.')
  }
  const data = zip.file('data.json')
  if (!data) throw new BackupError('This zip file isn’t a Loci backup.')
  const backup = parseBackup(await data.async('string'))
  for (const b of backup.blobs) {
    const entry = zip.file(`blobs/${b.id}`)
    if (!entry) throw new BackupError('This backup is damaged: an attached file is missing.')
    b.data = new Blob([(await entry.async('uint8array')) as Uint8Array<ArrayBuffer>], { type: b.mime })
  }
  return backup
}

// Reads and checks a backup's JSON (an old .json file, or a zip's data.json).
// Throws BackupError if it isn't one we can use.
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
    const idField = table === 'settings' ? 'key' : 'id'
    for (const row of rows) {
      if (typeof row !== 'object' || row === null || typeof row[idField] !== 'string' || typeof row.updatedAt !== 'number') {
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
    attachments: b.attachments as Attachment[],
    blobs: b.blobs as StoredBlob[],
    settings: b.settings as Setting[],
    notes: b.notes as Note[],
    todos: b.todos as Todo[],
    todoCompletions: b.todoCompletions as TodoCompletion[],
    goals: b.goals as Goal[],
    goalContributors: b.goalContributors as Contributor[],
    goalEntries: b.goalEntries as GoalEntry[],
  }
}

export type ImportSummary = Record<TableName, { added: number; updated: number }>

// Replace clears all data first; this device's settings stay unless the file has its own.
export async function importBackup(backup: Backup, mode: 'replace' | 'merge'): Promise<ImportSummary> {
  const summary = Object.fromEntries(TABLES.map((t) => [t, { added: 0, updated: 0 }])) as ImportSummary
  if (backup.blobs.some((b) => !(b.data instanceof Blob))) throw new BackupError('This backup is damaged: an attached file is missing.')

  await db.transaction('rw', ALL_TABLES(), async () => {
    if (mode === 'replace') await Promise.all(TABLES.filter((t) => t !== 'settings').map((t) => db[t].clear()))

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
    await mergeInto('attachments', backup.attachments, summary)
    await mergeInto('blobs', backup.blobs, summary)
    await mergeInto('notes', backup.notes, summary)
    await mergeInto('todos', backup.todos, summary)
    await mergeInto('todoCompletions', backup.todoCompletions, summary)
    await mergeInto('goals', backup.goals, summary)
    await mergeInto('goalContributors', backup.goalContributors, summary)
    await mergeInto('goalEntries', backup.goalEntries, summary)

    // Settings are keyed by name; the newer value wins.
    for (const setting of backup.settings) {
      const ours = await db.settings.get(setting.key)
      if (ours && ours.updatedAt >= setting.updatedAt) continue
      await db.settings.put(setting)
      summary.settings[ours ? 'updated' : 'added']++
    }
  })
  return summary
}

// Adds records we don't have; replaces ours when the file's copy is newer.
async function mergeInto<T extends { id: string; updatedAt: number }>(table: Exclude<TableName, 'tags' | 'settings'>, rows: T[], summary: ImportSummary) {
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
export function describeBackup(b: Pick<Backup, 'loci' | 'elements' | 'cards'> & { blobs?: unknown[] }): string {
  return [
    count(b.loci.length, 'locus', 'loci'),
    count(b.elements.length, 'element', 'elements'),
    count(b.cards.length, 'card', 'cards'),
    ...(b.blobs?.length ? [count(b.blobs.length, 'attached file', 'attached files')] : []),
  ].join(', ')
}
