// Recording changes for sync (SPEC-v4-sync.md, "Recording changes: a Dexie
// middleware"). Every write to a synced table, whichever code made it, leaves a
// row in syncOutbox in the same transaction, so a crash can't lose one without
// the other. The sync engine sends those rows and removes them.

import type { DBCore, DBCoreTable, DBCoreTransaction, Middleware } from 'dexie'
import { SYNCED_TABLES, type SyncedTable } from './rules'

export const OUTBOX = 'syncOutbox'

// One record changed here and not yet sent. A later change to the same record
// replaces the row, so many edits send the record once.
export interface OutboxRow {
  table: SyncedTable
  id: string
  op: 'put' | 'delete'
  changedAt: number
}

// This device's sync settings and progress, one row per key.
export interface SyncStateRow {
  key: string
  value: unknown
}

const SYNCED = new Set<string>(SYNCED_TABLES)

let recording = false
let onRecorded: (() => void) | null = null
// Transactions whose writes are not recorded: the sync engine applying what it
// pulled, which must not be sent back.
const silent = new WeakSet<object>()

// Sync on: record changes, and call `recorded` after each recorded write. Off:
// record nothing, so devices that never sync don't fill an outbox.
export function setRecording(on: boolean, recorded: (() => void) | null = null): void {
  recording = on
  onRecorded = on ? recorded : null
}

// `idbtrans` is a Dexie transaction's `idbtrans`.
export function markSilent(idbtrans: object): void {
  silent.add(idbtrans)
}

export const recordChanges: Middleware<DBCore> = {
  stack: 'dbcore',
  name: 'syncRecord',
  create(down) {
    return {
      ...down,
      // Read-write transactions on synced tables also cover the outbox.
      transaction(stores, mode, options) {
        const withOutbox = mode === 'readwrite' && stores.some((s) => SYNCED.has(s)) && !stores.includes(OUTBOX) ? [...stores, OUTBOX] : stores
        return down.transaction(withOutbox, mode, options)
      },
      table(name) {
        const table = down.table(name)
        if (!SYNCED.has(name)) return table
        return {
          ...table,
          async mutate(req) {
            if (!recording || silent.has(req.trans)) return table.mutate(req)
            // Deletes are recorded only for records that were there, so deleting
            // something already gone (e.g. a cascade repeating what another
            // device did) sends nothing.
            const deleting = req.type === 'delete' ? await existingKeys(table, req.trans, req.keys) : req.type === 'deleteRange' ? await keysInRange(table, req.trans, req.range) : []
            const res = await table.mutate(req)
            const ok = (_: unknown, i: number) => !(i in res.failures)
            const writing = req.type === 'add' || req.type === 'put'
            const keys = writing ? (res.results ?? req.keys ?? req.values.map((v) => table.schema.primaryKey.extractKey!(v))).filter(ok) : deleting
            if (keys.length === 0) return res
            const op = writing ? 'put' : 'delete'
            const changedAt = Date.now()
            const rows: OutboxRow[] = keys.map((id) => ({ table: name as SyncedTable, id: String(id), op, changedAt }))
            await down.table(OUTBOX).mutate({ type: 'put', trans: req.trans, values: rows })
            onRecorded?.()
            return res
          },
        }
      },
    }
  },
}

async function existingKeys(table: DBCoreTable, trans: DBCoreTransaction, keys: unknown[]): Promise<unknown[]> {
  const values = await table.getMany({ trans, keys })
  return keys.filter((_, i) => values[i] !== undefined)
}

async function keysInRange(table: DBCoreTable, trans: DBCoreTransaction, range: Parameters<DBCoreTable['query']>[0]['query']['range']): Promise<unknown[]> {
  const { result } = await table.query({ trans, values: false, query: { index: table.schema.primaryKey, range } })
  return result
}
