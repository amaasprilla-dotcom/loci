// The sync engine against the real server code (worker/), on an in-memory SQLite
// database. "The phone" is another device, writing to the server directly.

import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hashKey, handleSync } from '../../worker/api.ts'
import { SyncStore, type SqlLike } from '../../worker/store.ts'
import { addCards, DEFAULT_FLASHCARDS_DATA, listCards } from '../elements/flashcards/store'
import { createElement, createLocus, db, deleteElement, moveLocus } from '../store/db'
import type { Locus, Tag } from '../types'
import { SyncError } from './client'
import { joinSync, resetSyncKey, setUpSync, stopSync, syncNow, syncStatus } from './engine'
import { setRecording } from './record'
import type { Change } from './rules'

// Node's SQLite, imported by name so the app's type checking (no Node types) skips it.
const sqliteModule = 'node:sqlite'
const { DatabaseSync } = await import(/* @vite-ignore */ sqliteModule)

let server: SyncStore

function newServer(): SyncStore {
  const sqlite = new DatabaseSync(':memory:')
  const sql: SqlLike = {
    exec: (query, ...bindings) => {
      const rows = sqlite.prepare(query).all(...bindings)
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

  it('waits with attachments and files', async () => {
    await setUpSync()
    await db.attachments.add({ id: 'a1', ownerType: 'note', ownerId: 'n1', kind: 'link', name: 'Docs', url: 'https://example.com', createdAt: 1, updatedAt: 1 } as never)
    await syncNow()
    expect(onServer()).toEqual([])
    expect(await db.syncOutbox.count()).toBe(1)
    expect(syncStatus().pending).toBe(0)
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
