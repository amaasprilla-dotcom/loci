// The sync engine against the real server code (worker/), on an in-memory SQLite
// database. "The phone" is another device, writing to the server directly.

import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hashKey, handleSync } from '../../worker/api.ts'
import { SyncStore, type SqlLike } from '../../worker/store.ts'
import { addCards, DEFAULT_FLASHCARDS_DATA, listCards } from '../elements/flashcards/store'
import { createNote } from '../elements/notes/store'
import { addFileAttachment } from '../store/attachments'
import { createElement, createLocus, db, deleteElement, moveLocus } from '../store/db'
import type { Locus, Tag } from '../types'
import { SyncError } from './client'
import { joinSync, loadSync, onRemoteChanges, resetSyncKey, setUpSync, stopSync, syncNow, syncStatus } from './engine'
import { startEditing, tellEditors } from './editing'
import { markSilent, setRecording } from './record'
import { PART_BYTES, type Change } from './rules'

// Node's SQLite, imported by name so the app's type checking (no Node types) skips it.
const sqliteModule = 'node:sqlite'
const { DatabaseSync } = await import(/* @vite-ignore */ sqliteModule)

let server: SyncStore

function newServer(): SyncStore {
  const sqlite = new DatabaseSync(':memory:')
  const sql: SqlLike = {
    exec: (query, ...bindings) => {
      const rows = sqlite.prepare(query).all(...bindings.map((b) => (b instanceof ArrayBuffer ? new Uint8Array(b) : b)))
      return { toArray: () => rows }
    },
  }
  return new SyncStore(sql, (fn) => {
    sqlite.exec('BEGIN')
    try {
      const result = fn()
      sqlite.exec('COMMIT')
      return result
    } catch (error) {
      sqlite.exec('ROLLBACK')
      throw error
    }
  })
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => handleSync(new Request(new URL(String(input), 'https://loci.test'), init), server)

// Everything the server holds, live records only, as "table/id".
const onServer = () =>
  server
    .pull(0, 10_000)
    .changes.filter((c) => !c.deleted)
    .map((c) => `${c.table}/${c.id}`)
    .sort()
const serverRecord = (table: string, id: string) => server.pull(0, 10_000).changes.find((c) => c.table === table && c.id === id)
const phone = (changes: Change[], version = db.verno) => {
  expect(server.noteVersion(version)).toBe(true)
  return server.push('phone', changes)
}
const locusData = (id: string, name: string, tagIds: string[] = [], updatedAt = Date.now()): Locus => ({ id, name, color: '#4f8ef7', tagIds, x: 0.5, y: 0.5, radius: 48, createdAt: updatedAt, updatedAt })

async function seedDeck(name = 'Spanish') {
  const locus = await createLocus({ name, color: '#4f8ef7', x: 0.3, y: 0.6 })
  const deck = await createElement(locus.id, 'flashcards', 'Verbs', { ...DEFAULT_FLASHCARDS_DATA })
  await addCards(deck.id, [{ front: 'hablar', back: 'to speak' }])
  return { locus, deck, card: (await listCards(deck.id))[0] }
}

beforeEach(async () => {
  server = newServer()
  setRecording(false)
  await Promise.all(db.tables.map((t) => t.clear()))
})

afterEach(async () => {
  await syncNow()
  await stopSync()
})

describe('setting up', () => {
  it('sends everything on this device', async () => {
    const { locus, deck, card } = await seedDeck()
    await setUpSync()
    await syncNow()
    expect(onServer()).toEqual([`cards/${card.id}`, `elements/${deck.id}`, `loci/${locus.id}`].sort())
    expect(await db.syncOutbox.count()).toBe(0)
    expect(syncStatus()).toMatchObject({ on: true, pending: 0, problem: null })
  })

  it('refuses when sync is already set up', async () => {
    await setUpSync()
    await syncNow()
    await stopSync()
    await expect(setUpSync()).rejects.toThrow(SyncError)
  })
})

describe('rounds', () => {
  it('sends edits and deletions made here', async () => {
    await setUpSync()
    const { locus, deck, card } = await seedDeck()
    await syncNow()
    expect(onServer()).toContain(`cards/${card.id}`)
    await deleteElement(deck.id)
    await syncNow()
    expect(onServer()).toEqual([`loci/${locus.id}`])
  })

  it('brings in what other devices changed, without sending it back', async () => {
    await setUpSync()
    await syncNow()
    phone([{ table: 'loci', id: 'from-phone', op: 'put', changedAt: Date.now(), data: { ...locusData('from-phone', 'Chemistry') } }])
    await syncNow()
    expect((await db.loci.get('from-phone'))?.name).toBe('Chemistry')
    expect(await db.syncOutbox.count()).toBe(0)
    const seq = server.seq()
    await syncNow()
    expect(server.seq()).toBe(seq)
  })

  it('tells screens what other devices changed, and only that', async () => {
    const seen: string[][] = []
    const stop = onRemoteChanges((records) => seen.push(records.map((r) => `${r.table}/${r.id}`)))
    try {
      await setUpSync()
      await seedDeck()
      await syncNow()
      expect(seen).toEqual([]) // our own changes coming back aren't news
      phone([{ table: 'loci', id: 'from-phone', op: 'put', changedAt: Date.now(), data: { ...locusData('from-phone', 'Chemistry') } }])
      await syncNow()
      expect(seen).toEqual([['loci/from-phone']])
    } finally {
      stop()
    }
  })

  it('keeps the newer side when both changed the same record', async () => {
    await setUpSync()
    const { locus } = await seedDeck()
    await syncNow()

    // The phone's edit is older than the one here: ours wins everywhere.
    phone([{ table: 'loci', id: locus.id, op: 'put', changedAt: Date.now() - 60_000, data: { ...locusData(locus.id, 'Phone, earlier') } }])
    await moveLocus(locus.id, 0.9, 0.9)
    await syncNow()
    expect((await db.loci.get(locus.id))?.name).toBe('Spanish')
    expect(serverRecord('loci', locus.id)?.data?.x).toBe(0.9)

    // The phone's is newer: it wins here too.
    await moveLocus(locus.id, 0.1, 0.1)
    phone([{ table: 'loci', id: locus.id, op: 'put', changedAt: Date.now() + 60_000, data: { ...locusData(locus.id, 'Phone, later') } }])
    await syncNow()
    expect((await db.loci.get(locus.id))?.name).toBe('Phone, later')
    expect(await db.syncOutbox.count()).toBe(0)
  })

  it('keeps changes made offline and sends them once back online', async () => {
    await setUpSync()
    await syncNow()
    const online = globalThis.fetch
    globalThis.fetch = () => Promise.reject(new TypeError('Failed to fetch'))
    try {
      await seedDeck()
      await syncNow()
      expect(syncStatus()).toMatchObject({ problem: 'offline', pending: 3 })
    } finally {
      globalThis.fetch = online
    }
    await syncNow()
    expect(syncStatus()).toMatchObject({ problem: null, pending: 0 })
    expect(onServer()).toHaveLength(3)
  })

})

describe('joining', () => {
  it('merges what is here with what is synced', async () => {
    const key = await setUpSync()
    await syncNow()
    phone([{ table: 'loci', id: 'from-phone', op: 'put', changedAt: 1000, data: { ...locusData('from-phone', 'Chemistry', [], 1000) } }])
    await stopSync()

    const { locus } = await seedDeck('Here')
    await joinSync(key, 'merge')
    expect((await db.loci.toArray()).map((l) => l.name).sort()).toEqual(['Chemistry', 'Here'])
    expect(onServer()).toContain(`loci/${locus.id}`)
  })

  it('replace drops what is here and downloads', async () => {
    const key = await setUpSync()
    await syncNow()
    phone([{ table: 'loci', id: 'from-phone', op: 'put', changedAt: 1000, data: { ...locusData('from-phone', 'Chemistry', [], 1000) } }])
    await stopSync()

    const { locus } = await seedDeck('Here')
    await joinSync(key.toLowerCase(), 'replace')
    expect((await db.loci.toArray()).map((l) => l.name)).toEqual(['Chemistry'])
    expect(onServer()).not.toContain(`loci/${locus.id}`)
  })

  it('changes nothing here when the key is wrong', async () => {
    await setUpSync()
    await syncNow()
    await stopSync()
    await seedDeck('Here')
    await expect(joinSync('ABCD-EFGH-JKMN-PQRS-TUVW-XYZ2', 'replace')).rejects.toMatchObject({ problem: 'wrong-key' })
    expect(await db.loci.count()).toBe(1)
    expect(syncStatus().on).toBe(false)
  })
})

describe('keys and versions', () => {
  it('a reset key keeps working here; the old one stops', async () => {
    const oldKey = await setUpSync()
    await syncNow()
    const newKey = await resetSyncKey()
    expect(newKey).not.toBe(oldKey)
    expect(server.keyMatches(await hashKey(newKey))).toBe(true)
    await seedDeck()
    await syncNow()
    expect(syncStatus().problem).toBeNull()
  })

  it('notices when the key was changed on another device', async () => {
    await setUpSync()
    await syncNow()
    server.rekey(await hashKey('ZZZZZZZZZZZZZZZZZZZZZZZZ'))
    await seedDeck()
    await syncNow()
    expect(syncStatus().problem).toBe('wrong-key')
  })

  it('stops sending when another device runs a newer app', async () => {
    await setUpSync()
    await syncNow()
    phone([], db.verno + 1)
    await seedDeck()
    await syncNow()
    expect(syncStatus().problem).toBe('update')
    expect(syncStatus().pending).toBeGreaterThan(0)
  })
})

describe('repairs', () => {
  async function tagHere(id: string, name: string, lociId: string) {
    await db.tags.add({ id, name, key: name.toLowerCase(), updatedAt: Date.now() })
    await db.loci.add(locusData(lociId, `Locus ${lociId}`, [id]))
  }

  const tagOnPhone = (id: string, name: string, lociId: string) =>
    phone([
      { table: 'tags', id, op: 'put', changedAt: Date.now(), data: { id, name, key: name.toLowerCase(), updatedAt: Date.now() } satisfies Tag },
      { table: 'loci', id: lociId, op: 'put', changedAt: Date.now(), data: { ...locusData(lociId, `Locus ${lociId}`, [id]) } },
    ])

  it('the same tag made on two devices becomes one: the phone’s survives', async () => {
    await setUpSync()
    await tagHere('t-zzz', 'Math', 'here')
    tagOnPhone('t-aaa', 'math', 'there')
    await syncNow()
    expect((await db.tags.toArray()).map((t) => t.id)).toEqual(['t-aaa'])
    expect((await db.loci.get('here'))?.tagIds).toEqual(['t-aaa'])
    expect(serverRecord('tags', 't-zzz')?.deleted).toBe(true)
    expect(serverRecord('loci', 'here')?.data?.tagIds).toEqual(['t-aaa'])
  })

  it('the same tag made on two devices becomes one: ours survives', async () => {
    await setUpSync()
    await tagHere('t-aaa', 'Math', 'here')
    await syncNow()
    tagOnPhone('t-zzz', 'math', 'there')
    await syncNow()
    expect((await db.tags.toArray()).map((t) => t.id)).toEqual(['t-aaa'])
    expect((await db.loci.get('there'))?.tagIds).toEqual(['t-aaa'])
    expect(serverRecord('tags', 't-zzz')?.deleted).toBe(true)
    expect(serverRecord('loci', 'there')?.data?.tagIds).toEqual(['t-aaa'])
  })

  it('what was added here under something deleted elsewhere goes too', async () => {
    await setUpSync()
    const { locus, deck } = await seedDeck()
    await syncNow()
    await addCards(deck.id, [{ front: 'comer', back: 'to eat' }]) // not sent yet
    phone([
      { table: 'elements', id: deck.id, op: 'delete', changedAt: Date.now() },
      { table: 'loci', id: locus.id, op: 'delete', changedAt: Date.now() },
    ])
    await syncNow()
    expect(await db.cards.count()).toBe(0)
    expect(onServer()).toEqual([])
  })

  it('what was added elsewhere under something deleted here goes too', async () => {
    await setUpSync()
    const { deck } = await seedDeck()
    await syncNow()
    await deleteElement(deck.id)
    phone([{ table: 'cards', id: 'phone-card', op: 'put', changedAt: Date.now(), data: { id: 'phone-card', elementId: deck.id, front: 'a', back: 'b', updatedAt: Date.now() } }])
    await syncNow()
    expect(await db.cards.get('phone-card')).toBeUndefined()
    expect(serverRecord('cards', 'phone-card')?.deleted).toBe(true)
  })

  it('links to something gone go', async () => {
    await setUpSync()
    const { locus } = await seedDeck()
    await syncNow()
    phone([{ table: 'links', id: 'l1', op: 'put', changedAt: Date.now(), data: { id: 'l1', from: { type: 'locus', id: locus.id }, to: { type: 'note', id: 'nowhere' }, kind: 'related', createdAt: 1, updatedAt: 1 } }])
    await syncNow()
    expect(await db.links.get('l1')).toBeUndefined()
    expect(serverRecord('links', 'l1')?.deleted).toBe(true)
  })
})

describe('editors', () => {
  it('hear about changes to what they edit, and deletions', () => {
    const heard: boolean[] = []
    const stop = startEditing('notes', 'n1', (deleted) => heard.push(deleted))
    const record = (id: string, deleted: boolean) => ({ table: 'notes' as const, id, deleted, data: null, changedAt: 1, device: 'phone', seq: 1 })
    tellEditors([record('other', false)])
    tellEditors([record('n1', false)])
    tellEditors([record('n1', true)])
    stop()
    tellEditors([record('n1', false)])
    expect(heard).toEqual([false, true])
  })
})

describe('attached files', () => {
  const bytesOf = async (blob: Blob) => [...new Uint8Array(await blob.arrayBuffer())]
  const fileRecords = (id: string, blobId: string, size: number, ownerId: string): Change[] => [
    { table: 'blobs', id: blobId, op: 'put', changedAt: Date.now(), data: { id: blobId, mime: 'application/pdf', size, updatedAt: Date.now() } },
    { table: 'attachments', id, op: 'put', changedAt: Date.now(), data: { id, ownerType: 'note', ownerId, kind: 'file', name: 'notes.pdf', blobId, mime: 'application/pdf', size, createdAt: 1, updatedAt: 1 } },
  ]

  async function noteHere() {
    const { locus } = await seedDeck()
    const notebook = await createElement(locus.id, 'notes', 'Notes', {})
    return createNote(notebook.id)
  }

  it('go up in parts, before their record, which carries no bytes', async () => {
    await setUpSync()
    const note = await noteHere()
    const size = 2 * PART_BYTES + 10
    const content = new Uint8Array(size).map((_, i) => i % 251)
    const attachment = await addFileAttachment({ type: 'note', id: note.id }, new File([content], 'big.pdf', { type: 'application/pdf' }))
    await syncNow()
    const record = serverRecord('blobs', attachment.blobId!)
    expect(record?.data).toEqual({ id: attachment.blobId, mime: 'application/pdf', size, updatedAt: expect.any(Number) })
    expect(onServer()).toContain(`attachments/${attachment.id}`)
    const parts = [0, 1, 2].map((p) => server.getBlobPart(attachment.blobId!, p))
    expect(parts.map((p) => [p?.parts, p?.data.byteLength])).toEqual([[3, PART_BYTES], [3, PART_BYTES], [3, 10]])
  })

  it('come down from other devices', async () => {
    await setUpSync()
    const note = await noteHere()
    await syncNow()
    server.putBlobPart('b1', 0, 2, new Uint8Array([1, 2]).buffer)
    server.putBlobPart('b1', 1, 2, new Uint8Array([3]).buffer)
    phone(fileRecords('a1', 'b1', 3, note.id))
    await syncNow()
    const blob = await db.blobs.get('b1')
    expect(blob && (await bytesOf(blob.data))).toEqual([1, 2, 3])
    expect(blob?.mime).toBe('application/pdf')
    expect((await db.attachments.get('a1'))?.blobId).toBe('b1')
  })

  it('whose bytes aren’t up yet come down in a later round', async () => {
    await setUpSync()
    const note = await noteHere()
    await syncNow()
    phone(fileRecords('a1', 'b1', 1, note.id))
    await syncNow()
    expect(await db.blobs.get('b1')).toBeUndefined()
    expect(await db.attachments.get('a1')).toBeDefined() // shows "Downloading…"
    server.putBlobPart('b1', 0, 1, new Uint8Array([7]).buffer)
    await syncNow()
    const blob = await db.blobs.get('b1')
    expect(blob && (await bytesOf(blob.data))).toEqual([7])
  })

  it('skipped by an older app version are pulled once after updating', async () => {
    await setUpSync()
    const note = await noteHere()
    await syncNow()
    server.putBlobPart('b1', 0, 1, new Uint8Array([9]).buffer)
    phone(fileRecords('a1', 'b1', 1, note.id))
    await syncNow()
    // As an older version left it: the cursor past the file records, which it skipped.
    await db.transaction('rw', db.attachments, db.blobs, db.syncState, async (tx) => {
      markSilent(tx.idbtrans)
      await db.attachments.clear()
      await db.blobs.clear()
      await db.syncState.delete('pullVersion')
    })
    await loadSync() // the app starting with the new version
    await syncNow()
    expect(await db.attachments.get('a1')).toBeDefined()
    expect(await db.blobs.get('b1')).toBeDefined()
  })

  it('deleted elsewhere go here too', async () => {
    await setUpSync()
    const note = await noteHere()
    const attachment = await addFileAttachment({ type: 'note', id: note.id }, new File([new Uint8Array([1])], 'a.pdf', { type: 'application/pdf' }))
    await syncNow()
    phone([
      { table: 'attachments', id: attachment.id, op: 'delete', changedAt: Date.now() },
      { table: 'blobs', id: attachment.blobId!, op: 'delete', changedAt: Date.now() },
    ])
    await syncNow()
    expect(await db.attachments.get(attachment.id)).toBeUndefined()
    expect(await db.blobs.get(attachment.blobId!)).toBeUndefined()
  })
})
