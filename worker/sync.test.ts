// The sync server, against a real SQLite database (Node's built-in one stands in
// for the Durable Object's).

import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { BATCH_LIMIT, formatKey, generateKey, MAX_CLOCK_LEAD_MS, VERSION_HEADER, type Change } from '../src/sync/rules.ts'
import { handleSync } from './api.ts'
import { SyncStore, type SqlLike, type Transact } from './store.ts'

const NOW = Date.UTC(2026, 9, 30, 12)
const KEY = generateKey()

function memoryStore(db = new DatabaseSync(':memory:')): SyncStore {
  const sql: SqlLike = {
    exec: (query, ...bindings) => {
      const rows = db.prepare(query).all(...bindings) as Record<string, unknown>[]
      return { toArray: () => rows }
    },
  }
  const transact: Transact = (fn) => {
    db.exec('BEGIN')
    try {
      const result = fn()
      db.exec('COMMIT')
      return result
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
  return new SyncStore(sql, transact, () => NOW)
}

interface CallOptions {
  key?: string | null
  version?: number
  body?: unknown
}

async function call(store: SyncStore, method: string, path: string, { key = KEY, version = 11, body }: CallOptions = {}) {
  const headers: Record<string, string> = { [VERSION_HEADER]: String(version) }
  if (key) headers.Authorization = `Bearer ${formatKey(key)}`
  const request = new Request(`https://loci.test/api/sync/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const response = await handleSync(request, store)
  return { status: response.status, body: (await response.json()) as any }
}

async function claimedStore(): Promise<SyncStore> {
  const store = memoryStore()
  await call(store, 'POST', 'claim')
  return store
}

const put = (id: string, changedAt: number, data: Record<string, unknown> = { id }): Change => ({ table: 'notes', id, op: 'put', changedAt, data })
const del = (id: string, changedAt: number): Change => ({ table: 'notes', id, op: 'delete', changedAt })
const push = (store: SyncStore, device: string, changes: Change[], options: CallOptions = {}) => call(store, 'POST', 'push', { ...options, body: { device, changes } })
const pull = (store: SyncStore, since = 0) => call(store, 'GET', `pull?since=${since}`)

describe('claiming', () => {
  it('lets the first key in, and only that key', async () => {
    const store = memoryStore()
    expect((await call(store, 'GET', 'status')).body).toEqual({ error: 'not-set-up' })
    expect((await call(store, 'POST', 'claim')).status).toBe(201)
    expect((await call(store, 'POST', 'claim')).status).toBe(200) // a retried claim
    expect((await call(store, 'POST', 'claim', { key: generateKey() })).status).toBe(409)
    expect((await call(store, 'GET', 'status')).body).toEqual({ seq: 0, newestVersion: 11 })
  })

  it('turns away wrong, missing and malformed keys', async () => {
    const store = await claimedStore()
    expect((await call(store, 'GET', 'status', { key: generateKey() })).status).toBe(401)
    expect((await call(store, 'GET', 'status', { key: null })).status).toBe(401)
    expect((await call(store, 'GET', 'status', { key: 'NOT-A-KEY' })).status).toBe(401)
  })

  it('reset: the new key works and the old one stops', async () => {
    const store = await claimedStore()
    const newKey = generateKey()
    expect((await call(store, 'POST', 'rekey', { body: { key: formatKey(newKey) } })).status).toBe(200)
    expect((await call(store, 'GET', 'status')).status).toBe(401)
    expect((await call(store, 'GET', 'status', { key: newKey })).status).toBe(200)
  })

  it('stores only a hash of the key', async () => {
    const db = new DatabaseSync(':memory:')
    await call(memoryStore(db), 'POST', 'claim')
    const stored = JSON.stringify(db.prepare('SELECT * FROM meta').all())
    expect(stored).not.toContain(KEY)
    expect(stored).toMatch(/[0-9a-f]{64}/)
  })
})

describe('push and pull', () => {
  it('carries records from one device to another, unknown fields and all', async () => {
    const store = await claimedStore()
    const data = { id: 'n1', title: 'Verbs', content: { type: 'doc', content: [] }, futureField: [1, 2] }
    expect((await push(store, 'laptop', [put('n1', NOW, data)])).body).toEqual({ results: ['accepted'], seq: 1 })
    expect((await pull(store)).body).toEqual({
      changes: [{ table: 'notes', id: 'n1', deleted: false, data, changedAt: NOW, device: 'laptop', seq: 1 }],
      more: false,
      seq: 1,
    })
  })

  it('carries deletions as tombstones', async () => {
    const store = await claimedStore()
    await push(store, 'laptop', [put('n1', NOW - 10)])
    await push(store, 'phone', [del('n1', NOW)])
    const { changes } = (await pull(store)).body
    expect(changes).toEqual([{ table: 'notes', id: 'n1', deleted: true, data: null, changedAt: NOW, device: 'phone', seq: 2 }])
  })

  it('keeps the newer version when two devices changed the same record', async () => {
    const store = await claimedStore()
    await push(store, 'laptop', [put('n1', NOW, { title: 'laptop' })])
    expect((await push(store, 'phone', [put('n1', NOW - 1000, { title: 'phone, earlier' })])).body.results).toEqual(['stale'])
    expect((await push(store, 'phone', [put('n1', NOW + 1000, { title: 'phone, later' })])).body.results).toEqual(['accepted'])
    expect((await pull(store)).body.changes[0].data).toEqual({ title: 'phone, later' })
  })

  it('settles exact ties by device id', async () => {
    const store = await claimedStore()
    await push(store, 'bbb', [put('n1', NOW, { by: 'bbb' })])
    expect((await push(store, 'aaa', [put('n1', NOW, { by: 'aaa' })])).body.results).toEqual(['stale'])
    expect((await push(store, 'ccc', [put('n1', NOW, { by: 'ccc' })])).body.results).toEqual(['accepted'])
  })

  it('treats a retried push as done, without new changes', async () => {
    const store = await claimedStore()
    const batch = [put('n1', NOW), put('n2', NOW)]
    await push(store, 'laptop', batch)
    expect((await push(store, 'laptop', batch)).body).toEqual({ results: ['accepted', 'accepted'], seq: 2 })
  })

  it('lets a newer edit bring back a deleted record, but not an older one', async () => {
    const store = await claimedStore()
    await push(store, 'laptop', [del('n1', NOW)])
    expect((await push(store, 'phone', [put('n1', NOW - 1)])).body.results).toEqual(['stale'])
    expect((await push(store, 'phone', [put('n1', NOW + 1)])).body.results).toEqual(['accepted'])
    expect((await pull(store)).body.changes[0].deleted).toBe(false)
  })

  it('caps clocks that run far ahead', async () => {
    const store = await claimedStore()
    await push(store, 'broken-clock', [put('n1', NOW + 365 * 24 * 3600 * 1000)])
    expect((await pull(store)).body.changes[0].changedAt).toBe(NOW + MAX_CLOCK_LEAD_MS)
    // So a correct device's edit a little later still wins.
    expect((await push(store, 'phone', [put('n1', NOW + MAX_CLOCK_LEAD_MS + 1)])).body.results).toEqual(['accepted'])
  })

  it('returns each record once, at its latest change, oldest change first', async () => {
    const store = await claimedStore()
    await push(store, 'laptop', [put('a', NOW), put('b', NOW), put('c', NOW)])
    await push(store, 'laptop', [put('a', NOW + 1, { edited: true })])
    const { changes, seq } = (await pull(store)).body
    expect(changes.map((c: { id: string }) => c.id)).toEqual(['b', 'c', 'a'])
    expect(seq).toBe(4)
    expect((await pull(store, 4)).body).toEqual({ changes: [], more: false, seq: 4 })
  })

  it('pages through long histories', () => {
    const store = memoryStore()
    store.push('laptop', ['a', 'b', 'c', 'd', 'e'].map((id) => put(id, NOW)))
    const first = store.pull(0, 2)
    expect([first.changes.map((c) => c.id), first.more, first.seq]).toEqual([['a', 'b'], true, 2])
    const second = store.pull(first.seq, 2)
    expect([second.changes.map((c) => c.id), second.more]).toEqual([['c', 'd'], true])
    const last = store.pull(second.seq, 2)
    expect([last.changes.map((c) => c.id), last.more, last.seq]).toEqual([['e'], false, 5])
  })
})

describe('app versions', () => {
  it('stops an older app from pushing, but still lets it pull', async () => {
    const store = await claimedStore()
    await push(store, 'laptop', [put('n1', NOW)], { version: 12 })
    expect((await push(store, 'phone', [put('n2', NOW)], { version: 11 })).body).toEqual({ error: 'update', newestVersion: 12 })
    expect((await pull(store)).status).toBe(200)
    expect((await push(store, 'phone', [put('n2', NOW)], { version: 12 })).status).toBe(200)
  })

  it('requires a version', async () => {
    const store = await claimedStore()
    expect((await call(store, 'GET', 'status', { version: 0 })).status).toBe(400)
  })
})

describe('bad requests', () => {
  it('refuses changes that are malformed or for tables that do not sync', async () => {
    const store = await claimedStore()
    const bad = [
      { ...put('n1', NOW), table: 'syncOutbox' },
      { ...put('n1', NOW), data: undefined },
      { ...put('n1', NOW), data: [1] },
      { ...put('n1', NOW), id: '' },
      { ...put('n1', NOW), changedAt: Number.NaN },
      { ...put('n1', NOW), op: 'patch' },
    ]
    for (const change of bad) {
      expect((await push(store, 'laptop', [put('ok', NOW), change as Change])).body).toEqual({ error: 'bad-change', index: 1 })
    }
    // Nothing from a refused batch is kept.
    expect((await pull(store)).body.changes).toEqual([])
  })

  it('refuses bad device ids, oversized batches and bad cursors', async () => {
    const store = await claimedStore()
    expect((await push(store, 'not a device!', [])).status).toBe(400)
    const tooMany = Array.from({ length: BATCH_LIMIT + 1 }, (_, i) => put(`n${i}`, NOW))
    expect((await push(store, 'laptop', tooMany)).status).toBe(413)
    expect((await pull(store, -1)).status).toBe(400)
    expect((await call(store, 'GET', 'nothing-here')).status).toBe(404)
  })
})
