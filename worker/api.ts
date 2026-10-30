// The sync API (SPEC-v4-sync.md, "Push", "Pull", "Security and privacy"). Every
// request carries the sync key as `Authorization: Bearer <key>`; all but claim
// also carry the app's database version in X-Loci-Version.
//
//   POST /api/sync/claim   first device: make this key the only key
//   GET  /api/sync/status  check the key; the current seq and newest app version
//   POST /api/sync/push    { device, changes: Change[] } → { results, seq }
//   GET  /api/sync/pull?since=<seq>  → { changes, more, seq }
//   POST /api/sync/rekey   { key } → the new key replaces this one
//   GET  /api/sync/live    a WebSocket that says when other devices pushed (worker/live.ts)
//   PUT  /api/sync/blobs/<id>/<part>   one part of an attached file (X-Loci-Parts: how many)
//   GET  /api/sync/blobs/<id>/<part>   → the part's bytes, with X-Loci-Parts

import { BATCH_LIMIT, isSyncedTable, MAX_PARTS, normalizeKey, PART_BYTES, PARTS_HEADER, VERSION_HEADER, type Change } from '../src/sync/rules.ts'
import type { SyncStore } from './store.ts'

// What the Durable Object does after some requests: tell other devices about a
// push, and drop live connections made with a key that no longer works.
export interface SyncHooks {
  pushed?(device: string): void
  rekeyed?(): void
}

export async function handleSync(request: Request, store: SyncStore, hooks: SyncHooks = {}): Promise<Response> {
  const url = new URL(request.url)
  const route = `${request.method} ${url.pathname.replace(/^\/api\/sync\//, '')}`

  const key = normalizeKey(request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '')
  if (!key) return json(401, { error: 'wrong-key' })
  const keyHash = await hashKey(key)

  if (route === 'POST claim') {
    const result = store.claim(keyHash)
    if (result === 'taken') return json(409, { error: 'taken' })
    return json(result === 'claimed' ? 201 : 200, { seq: store.seq() })
  }
  if (!store.isClaimed()) return json(404, { error: 'not-set-up' })
  if (!store.keyMatches(keyHash)) return json(401, { error: 'wrong-key' })

  const version = Number(request.headers.get(VERSION_HEADER))
  if (!Number.isInteger(version) || version < 1) return json(400, { error: 'no-version' })
  const upToDate = store.noteVersion(version)

  const blobPart = /^(GET|PUT) blobs\/([\w-]{1,200})\/(\d{1,5})$/.exec(route)
  if (blobPart) return handleBlobPart(request, store, blobPart[1], blobPart[2], Number(blobPart[3]))

  switch (route) {
    case 'GET status':
      return json(200, { seq: store.seq(), newestVersion: store.newestVersion() })

    case 'GET pull': {
      const since = Number(url.searchParams.get('since') ?? 0)
      if (!Number.isInteger(since) || since < 0) return json(400, { error: 'bad-since' })
      return json(200, store.pull(since, BATCH_LIMIT))
    }

    case 'POST push': {
      if (!upToDate) return json(426, { error: 'update', newestVersion: store.newestVersion() })
      const body = await readJson(request)
      if (!isRecord(body) || typeof body.device !== 'string' || !/^[\w-]{1,64}$/.test(body.device) || !Array.isArray(body.changes)) return json(400, { error: 'bad-push' })
      if (body.changes.length > BATCH_LIMIT) return json(413, { error: 'too-many', limit: BATCH_LIMIT })
      const bad = body.changes.findIndex((change) => !isChange(change))
      if (bad >= 0) return json(400, { error: 'bad-change', index: bad })
      const result = store.push(body.device, body.changes as Change[])
      if (result.results.includes('accepted')) hooks.pushed?.(body.device)
      return json(200, result)
    }

    case 'POST rekey': {
      const body = await readJson(request)
      const newKey = isRecord(body) && typeof body.key === 'string' ? normalizeKey(body.key) : null
      if (!newKey) return json(400, { error: 'bad-key' })
      store.rekey(await hashKey(newKey))
      hooks.rekeyed?.()
      return json(200, {})
    }
  }
  return json(404, { error: 'not-found' })
}

async function handleBlobPart(request: Request, store: SyncStore, method: string, id: string, part: number): Promise<Response> {
  if (method === 'GET') {
    const found = store.getBlobPart(id, part)
    if (!found) return json(404, { error: 'no-file' })
    return new Response(found.data, { headers: { 'Content-Type': 'application/octet-stream', [PARTS_HEADER]: String(found.parts), 'Cache-Control': 'no-store' } })
  }
  const parts = Number(request.headers.get(PARTS_HEADER))
  if (!Number.isInteger(parts) || parts < 1 || parts > MAX_PARTS || part >= parts) return json(400, { error: 'bad-part' })
  const data = await request.arrayBuffer()
  if (data.byteLength > PART_BYTES) return json(413, { error: 'part-too-big', limit: PART_BYTES })
  store.putBlobPart(id, part, parts, data)
  return json(200, {})
}

// Hex SHA-256 of the key: the server never stores the key itself.
export async function hashKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function isChange(value: unknown): value is Change {
  if (!isRecord(value)) return false
  const { table, id, op, changedAt, data } = value
  return (
    typeof table === 'string' &&
    isSyncedTable(table) &&
    typeof id === 'string' &&
    id.length > 0 &&
    id.length <= 200 &&
    (op === 'delete' || (op === 'put' && isRecord(data))) &&
    typeof changedAt === 'number' &&
    Number.isFinite(changedAt) &&
    changedAt >= 0
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return undefined
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}
