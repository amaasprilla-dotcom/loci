// The sync engine (SPEC-v4-sync.md, "Push", "Pull", "When sync runs"). A round
// pushes this device's recorded changes, pulls everyone else's, repairs what two
// devices editing apart can leave behind, and pushes the repairs.

import { db } from '../store/db'
import type { Tag } from '../types'
import { createClient, SyncError, type SyncProblem } from './client'
import { markSilent, type OutboxRow, setRecording } from './record'
import { repairAfterPull } from './repair'
import { BATCH_LIMIT, generateKey, incomingWins, normalizeKey, SYNCED_TABLES, type Change, type ServerRecord, type SyncedTable } from './rules'

// Attachments and their files wait in the outbox until files can travel (S4).
const HELD = new Set<SyncedTable>(['attachments', 'blobs'])

const DEBOUNCE_MS = 2000
const SAFETY_NET_MS = 5 * 60 * 1000
const RETRY_MS = [5_000, 30_000, 120_000, 300_000]

export interface SyncStatus {
  on: boolean
  busy: boolean
  lastSyncAt: number | null
  pending: number // changes here not yet sent
  problem: SyncProblem | null
}

const client = createClient(() => db.verno)
let config: { key: string; deviceId: string } | null = null
let status: SyncStatus = { on: false, busy: false, lastSyncAt: null, pending: 0, problem: null }
const listeners = new Set<(status: SyncStatus) => void>()

export function syncStatus(): SyncStatus {
  return status
}

// Calls `listener` now and after every change of status. Returns unsubscribe.
export function onSyncStatus(listener: (status: SyncStatus) => void): () => void {
  listeners.add(listener)
  listener(status)
  return () => listeners.delete(listener)
}

function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch }
  for (const listener of listeners) listener(status)
}

// ---------- This device's sync settings ----------

async function getState<T>(key: string): Promise<T | undefined> {
  return (await db.syncState.get(key))?.value as T | undefined
}

async function setState(key: string, value: unknown): Promise<void> {
  await db.syncState.put({ key, value })
}

async function pendingCount(): Promise<number> {
  return db.syncOutbox.filter((row) => !HELD.has(row.table)).count()
}

// At app start: picks sync back up if this device has it on.
export async function loadSync(): Promise<void> {
  const key = await getState<string>('key')
  const deviceId = await getState<string>('deviceId')
  if (!key || !deviceId) return
  config = { key, deviceId }
  setRecording(true, syncSoon)
  setStatus({ on: true, lastSyncAt: (await getState<number>('lastSyncAt')) ?? null, pending: await pendingCount() })
}

export async function currentKey(): Promise<string | null> {
  return config?.key ?? null
}

// ---------- Turning sync on and off ----------

// The first device: makes the key, claims the server, and sends everything here.
export async function setUpSync(): Promise<string> {
  const key = generateKey()
  await client.claim(key)
  await begin(key)
  await enqueueEverything()
  void syncNow()
  return key
}

// Another device. Merge keeps what's here and adds it to the synced data;
// replace drops what's here and downloads. Resolves after the first round.
export async function joinSync(input: string, mode: 'merge' | 'replace'): Promise<void> {
  const key = normalizeKey(input)
  if (!key) throw new SyncError('wrong-key')
  await client.status(key) // checks the key before anything here changes
  setRecording(false)
  if (mode === 'replace') await clearEverything()
  await begin(key)
  if (mode === 'merge') await enqueueEverything()
  await syncNow({ force: true })
}

// Keeps the data here, forgets the key and anything not yet sent.
export async function stopSync(): Promise<void> {
  setRecording(false)
  config = null
  clearTimeout(soonTimer)
  clearTimeout(retryTimer)
  await db.transaction('rw', db.syncState, db.syncOutbox, async () => {
    await db.syncState.clear()
    await db.syncOutbox.clear()
  })
  setStatus({ on: false, busy: false, lastSyncAt: null, pending: 0, problem: null })
}

// A new key for every device; the old one stops working at once.
export async function resetSyncKey(): Promise<string> {
  if (!config) throw new SyncError('not-set-up')
  const newKey = generateKey()
  await client.rekey(config.key, newKey)
  config.key = newKey
  await setState('key', newKey)
  return newKey
}

async function begin(key: string) {
  const deviceId = crypto.randomUUID()
  await db.transaction('rw', db.syncState, db.syncOutbox, async () => {
    await db.syncState.clear()
    await db.syncOutbox.clear()
    await db.syncState.bulkPut([
      { key: 'key', value: key },
      { key: 'deviceId', value: deviceId },
      { key: 'cursor', value: 0 },
    ])
  })
  config = { key, deviceId }
  setRecording(true, syncSoon)
  setStatus({ on: true, lastSyncAt: null, problem: null, pending: 0 })
}

// Everything here goes in the outbox, stamped with when it last changed (not
// now): old data must not beat newer synced data just for arriving last.
async function enqueueEverything() {
  const rows: OutboxRow[] = []
  for (const table of SYNCED_TABLES) {
    const idField = table === 'settings' ? 'key' : 'id'
    for (const record of await db.table(table).toArray()) {
      rows.push({ table, id: String(record[idField]), op: 'put', changedAt: typeof record.updatedAt === 'number' ? record.updatedAt : 0 })
    }
  }
  await db.syncOutbox.bulkPut(rows)
  setStatus({ pending: await pendingCount() })
}

async function clearEverything() {
  await db.transaction('rw', [...SYNCED_TABLES.map((t) => db.table(t)), db.syncOutbox], async (tx) => {
    markSilent(tx.idbtrans)
    for (const table of SYNCED_TABLES) await db.table(table).clear()
    await db.syncOutbox.clear()
  })
}

// ---------- Rounds ----------

let running: Promise<void> | null = null
let again = false
let soonTimer: ReturnType<typeof setTimeout> | undefined
let retryTimer: ReturnType<typeof setTimeout> | undefined
let retries = 0

// Problems a round can't fix by itself: automatic rounds wait for the user.
const STUCK = new Set<SyncProblem>(['wrong-key', 'not-set-up', 'update', 'unavailable'])

// Runs a round now (or right after the one running). Resolves when done.
// Automatic triggers skip it while sync is stuck; `force` (Sync now) doesn't.
export function syncNow(options: { force?: boolean } = {}): Promise<void> {
  if (!config) return Promise.resolve()
  if (!options.force && status.problem && STUCK.has(status.problem)) return Promise.resolve()
  if (running) {
    again = true
    return running
  }
  running = (async () => {
    do {
      again = false
      await round()
    } while (again && config)
  })().finally(() => {
    running = null
  })
  return running
}

// Soon after a local change, so typing doesn't send a request per keystroke.
function syncSoon() {
  clearTimeout(soonTimer)
  soonTimer = setTimeout(() => void syncNow(), DEBOUNCE_MS)
}

let autoStarted = false
// Rounds when the app opens, comes to the front or back online, and every few
// minutes while it's showing.
export function startAutoSync(): void {
  if (autoStarted) return
  autoStarted = true
  const visible = () => document.visibilityState === 'visible'
  document.addEventListener('visibilitychange', () => visible() && void syncNow())
  window.addEventListener('online', () => void syncNow())
  setInterval(() => visible() && void syncNow(), SAFETY_NET_MS)
  void syncNow()
}

async function round(): Promise<void> {
  if (!config) return
  const { key, deviceId } = config
  clearTimeout(retryTimer)
  setStatus({ busy: true })
  try {
    await pushAll(key, deviceId)
    const pulled = await pullAll(key, deviceId)
    if (pulled.length > 0) {
      await repairAfterPull(pulled, (await getState<Record<string, string>>('tagAliases')) ?? {})
      await pushAll(key, deviceId) // the repairs
    }
    if (config?.deviceId !== deviceId) return // stopped or rejoined meanwhile
    const at = Date.now()
    await setState('lastSyncAt', at)
    retries = 0
    setStatus({ busy: false, lastSyncAt: at, problem: null, pending: await pendingCount() })
  } catch (err) {
    const problem = err instanceof SyncError ? err.problem : 'server'
    if (!(err instanceof SyncError)) console.error(err)
    setStatus({ busy: false, problem, pending: await pendingCount() })
    if (!STUCK.has(problem) && config) {
      retryTimer = setTimeout(() => void syncNow(), RETRY_MS[Math.min(retries, RETRY_MS.length - 1)])
      retries++
    }
  }
}

// ---------- Push ----------

async function pushAll(key: string, deviceId: string): Promise<void> {
  const rows = (await db.syncOutbox.orderBy('changedAt').toArray()).filter((row) => !HELD.has(row.table))
  for (let i = 0; i < rows.length; i += BATCH_LIMIT) {
    const batch = rows.slice(i, i + BATCH_LIMIT)
    await client.push(key, deviceId, await changesFor(batch))
    // Sent rows go, unless the record changed again while they were on the way.
    await db.transaction('rw', db.syncOutbox, async () => {
      for (const sent of batch) {
        const current = await db.syncOutbox.get([sent.table, sent.id])
        if (current && current.changedAt === sent.changedAt && current.op === sent.op) await db.syncOutbox.delete([sent.table, sent.id])
      }
    })
    setStatus({ pending: await pendingCount() })
  }
}

// The records as they are now (so the newest content is sent).
async function changesFor(rows: OutboxRow[]): Promise<Change[]> {
  const values = new Map<string, Record<string, unknown> | undefined>()
  for (const table of new Set(rows.map((r) => r.table))) {
    const ids = rows.filter((r) => r.table === table && r.op === 'put').map((r) => r.id)
    const found = await db.table(table).bulkGet(ids)
    ids.forEach((id, i) => values.set(`${table}/${id}`, found[i]))
  }
  return rows.map((row) => {
    const data = row.op === 'put' ? values.get(`${row.table}/${row.id}`) : undefined
    // Gone since it was recorded: send the deletion.
    return data ? { table: row.table, id: row.id, op: 'put', changedAt: row.changedAt, data } : { table: row.table, id: row.id, op: 'delete', changedAt: row.changedAt }
  })
}

// ---------- Pull ----------

// Pulls until up to date. Returns the records that changed something here.
async function pullAll(key: string, deviceId: string): Promise<ServerRecord[]> {
  const applied: ServerRecord[] = []
  let cursor = (await getState<number>('cursor')) ?? 0
  for (;;) {
    const page = await client.pull(key, cursor)
    applied.push(...(await applyPage(page.changes, page.seq, deviceId)))
    cursor = page.seq
    if (!page.more) return applied
  }
}

// One page, in one transaction with the new cursor. Not recorded: these changes
// came from the server and must not be sent back.
async function applyPage(records: ServerRecord[], seq: number, deviceId: string): Promise<ServerRecord[]> {
  const applied: ServerRecord[] = []
  await db.transaction('rw', [...SYNCED_TABLES.map((t) => db.table(t)), db.syncOutbox, db.syncState], async (tx) => {
    markSilent(tx.idbtrans)
    for (const record of records) {
      // Our own changes coming back: this device already has them, or newer.
      if (record.device === deviceId || HELD.has(record.table)) continue
      const local = await db.syncOutbox.get([record.table, record.id])
      // A newer change here wins, and will be pushed.
      if (local && incomingWins({ changedAt: local.changedAt, device: deviceId }, record)) continue
      if (local) await db.syncOutbox.delete([record.table, record.id])
      if (record.deleted) await db.table(record.table).delete(record.id)
      else if (record.table === 'tags') await applyTag(record.data as unknown as Tag)
      else await db.table(record.table).put(record.data)
      applied.push(record)
    }
    await db.syncState.put({ key: 'cursor', value: seq })
  })
  return applied
}

// Tag names are unique. If both devices made "Math", the one with the smaller id
// survives on every device; the other is deleted, and remembered as an alias so
// loci still pointing at it can be moved over (repair).
async function applyTag(tag: Tag) {
  const sameName = await db.tags.where('key').equals(tag.key).first()
  if (!sameName || sameName.id === tag.id) {
    await db.tags.put(tag)
    return
  }
  const [survivor, loser] = tag.id < sameName.id ? [tag.id, sameName.id] : [sameName.id, tag.id]
  const aliases = (await getState<Record<string, string>>('tagAliases')) ?? {}
  await setState('tagAliases', { ...aliases, [loser]: survivor })
  if (loser === sameName.id) {
    await db.tags.delete(loser)
    await db.tags.put(tag)
  }
  // Recorded by hand: this transaction records nothing by itself.
  await db.syncOutbox.put({ table: 'tags', id: loser, op: 'delete', changedAt: Date.now() })
}
