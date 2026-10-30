// The synced data on the server (SPEC-v4-sync.md, "The record on the server").
// Plain SQL over a minimal interface, so the same code runs on a Durable Object's
// SQLite in production and on Node's built-in SQLite in tests.

import { incomingWins, MAX_CLOCK_LEAD_MS, type Change, type ServerRecord, type SyncedTable } from '../src/sync/rules.ts'

type SqlValue = string | number | null

// The part of a Durable Object's `ctx.storage.sql` this file uses.
export interface SqlLike {
  exec(query: string, ...bindings: SqlValue[]): { toArray(): Record<string, unknown>[] }
}

// Runs fn as one transaction: all of its writes happen, or none.
export type Transact = <T>(fn: () => T) => T

export type ClaimResult = 'claimed' | 'already-yours' | 'taken'

export class SyncStore {
  private sql: SqlLike
  private transact: Transact
  private now: () => number

  constructor(sql: SqlLike, transact: Transact, now: () => number = Date.now) {
    this.sql = sql
    this.transact = transact
    this.now = now
    sql.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)')
    sql.exec(`CREATE TABLE IF NOT EXISTS records (
      tbl TEXT NOT NULL, id TEXT NOT NULL, data TEXT, deleted INTEGER NOT NULL,
      changedAt INTEGER NOT NULL, device TEXT NOT NULL, seq INTEGER NOT NULL,
      PRIMARY KEY (tbl, id))`)
    sql.exec('CREATE INDEX IF NOT EXISTS records_seq ON records (seq)')
  }

  // The first key to arrive becomes the only key (SPEC, "Claiming").
  claim(keyHash: string): ClaimResult {
    return this.transact(() => {
      const current = this.meta('keyHash')
      if (current === keyHash) return 'already-yours'
      if (current !== undefined) return 'taken'
      this.setMeta('keyHash', keyHash)
      return 'claimed'
    })
  }

  isClaimed(): boolean {
    return this.meta('keyHash') !== undefined
  }

  keyMatches(keyHash: string): boolean {
    return this.meta('keyHash') === keyHash
  }

  // Reset sync key: the old key stops working at once.
  rekey(newKeyHash: string): void {
    this.setMeta('keyHash', newKeyHash)
  }

  // The highest `seq` given out so far; 0 before the first change.
  seq(): number {
    return Number(this.meta('seq') ?? 0)
  }

  // The newest app database version any device has used.
  newestVersion(): number {
    return Number(this.meta('newestVersion') ?? 0)
  }

  // Records a device's app version. False if the device is older than one seen
  // before, so it must update before it may push.
  noteVersion(version: number): boolean {
    const newest = this.newestVersion()
    if (version > newest) this.setMeta('newestVersion', String(version))
    return version >= newest
  }

  // Applies a batch of changes from one device, in order. Each result says whether
  // that change is now the server's version ('accepted') or the server already had
  // a newer one ('stale').
  push(device: string, changes: Change[]): { results: ('accepted' | 'stale')[]; seq: number } {
    return this.transact(() => {
      let seq = this.seq()
      const latest = this.now() + MAX_CLOCK_LEAD_MS
      const results = changes.map((change): 'accepted' | 'stale' => {
        const incoming = { changedAt: Math.min(change.changedAt, latest), device }
        const [stored] = this.sql.exec('SELECT changedAt, device FROM records WHERE tbl = ? AND id = ?', change.table, change.id).toArray() as { changedAt: number; device: string }[]
        // The very same change again (a push retried after a lost reply): already done.
        if (stored && stored.changedAt === incoming.changedAt && stored.device === device) return 'accepted'
        if (!incomingWins(incoming, stored)) return 'stale'
        seq++
        const deleted = change.op === 'delete'
        this.sql.exec(
          `INSERT INTO records (tbl, id, data, deleted, changedAt, device, seq) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (tbl, id) DO UPDATE SET data = excluded.data, deleted = excluded.deleted,
             changedAt = excluded.changedAt, device = excluded.device, seq = excluded.seq`,
          change.table,
          change.id,
          deleted ? null : JSON.stringify(change.data),
          deleted ? 1 : 0,
          incoming.changedAt,
          device,
          seq,
        )
        return 'accepted'
      })
      this.setMeta('seq', String(seq))
      return { results, seq }
    })
  }

  // Up to `limit` records changed after `since`, oldest change first. `seq` is the
  // cursor to pull from next time; `more` says whether to pull again right away.
  pull(since: number, limit: number): { changes: ServerRecord[]; more: boolean; seq: number } {
    const rows = this.sql.exec('SELECT tbl, id, data, deleted, changedAt, device, seq FROM records WHERE seq > ? ORDER BY seq LIMIT ?', since, limit + 1).toArray()
    const changes = rows.slice(0, limit).map((row) => ({
      table: row.tbl as SyncedTable,
      id: row.id as string,
      deleted: row.deleted === 1,
      data: row.data === null ? null : (JSON.parse(row.data as string) as Record<string, unknown>),
      changedAt: row.changedAt as number,
      device: row.device as string,
      seq: row.seq as number,
    }))
    return { changes, more: rows.length > limit, seq: changes.at(-1)?.seq ?? since }
  }

  private meta(k: string): string | undefined {
    const [row] = this.sql.exec('SELECT v FROM meta WHERE k = ?', k).toArray()
    return row?.v as string | undefined
  }

  private setMeta(k: string, v: string): void {
    this.sql.exec('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v', k, v)
  }
}
