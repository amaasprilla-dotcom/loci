// Sync rules shared by the app and the sync server (SPEC-v4-sync.md). No imports,
// no DOM, no Worker APIs: both sides compile this file.

// Every table whose records travel between devices. syncOutbox and syncState are
// this device's own and never listed here.
export const SYNCED_TABLES = [
  'tags',
  'loci',
  'elements',
  'cards',
  'reviews',
  'links',
  'attachments',
  'blobs',
  'notes',
  'todos',
  'todoCompletions',
  'goals',
  'goalContributors',
  'goalEntries',
  'problemTemplates',
  'problemAttempts',
  'exams',
  'recallAttempts',
  'settings',
] as const

export type SyncedTable = (typeof SYNCED_TABLES)[number]

export function isSyncedTable(name: string): name is SyncedTable {
  return (SYNCED_TABLES as readonly string[]).includes(name)
}

// Requests send the app's database version in this header; the server refuses
// pushes from versions older than the newest it has seen.
export const VERSION_HEADER = 'X-Loci-Version'

// The most changes one push may carry, and the most one pull returns.
export const BATCH_LIMIT = 500

// Attached files travel separately from their records, in parts of at most this
// size (the server's database holds values up to 2 MB). Each part's request says
// how many parts the file has in this header.
export const PART_BYTES = 1024 * 1024
export const PARTS_HEADER = 'X-Loci-Parts'
export const MAX_PARTS = 10_000

// The live socket (worker/live.ts) closes with this code when the key is wrong
// or was reset on another device.
export const WRONG_KEY_CLOSE = 4401

// Heartbeat on the live socket: a socket that stops answering (e.g. after the
// device slept) is replaced.
export const PING = 'ping'
export const PONG = 'pong'

// A change's clock may run ahead of the server's by at most this much.
export const MAX_CLOCK_LEAD_MS = 5 * 60 * 1000

// One change to one record, as pushed by a device. `data` is the whole record
// for a put, absent for a delete.
export interface Change {
  table: SyncedTable
  id: string
  op: 'put' | 'delete'
  changedAt: number
  data?: Record<string, unknown>
}

// A record as the server holds it and pull returns it.
export interface ServerRecord {
  table: SyncedTable
  id: string
  deleted: boolean
  data: Record<string, unknown> | null
  changedAt: number
  device: string
  seq: number
}

// When did a change happen, and on which device: enough to decide between two
// versions of a record.
export interface Stamp {
  changedAt: number
  device: string
}

// Does an incoming version replace the stored one? The later change wins; on a
// tie the larger device id does, so every device settles on the same answer.
// The very same change arriving twice (a retried push) does not win again.
export function incomingWins(incoming: Stamp, stored: Stamp | undefined): boolean {
  if (!stored) return true
  if (incoming.changedAt !== stored.changedAt) return incoming.changedAt > stored.changedAt
  return incoming.device > stored.device
}

// Sync keys: 24 characters in groups of four, from an alphabet without the
// look-alikes 0/O and 1/I/L. 31 symbols × 24 ≈ 119 bits.
export const KEY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const KEY_LENGTH = 24

export function generateKey(): string {
  const chars: string[] = []
  // Bytes from 248 up are skipped, so every symbol is equally likely (248 = 31 × 8).
  while (chars.length < KEY_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(32))) {
      if (byte < 248 && chars.length < KEY_LENGTH) chars.push(KEY_ALPHABET[byte % KEY_ALPHABET.length])
    }
  }
  return chars.join('')
}

// What the user typed or pasted, as the bare key: spaces, dashes and case don't
// matter. Returns null if it can't be a key.
export function normalizeKey(input: string): string | null {
  const key = input.toUpperCase().replace(/[\s-]/g, '')
  if (key.length !== KEY_LENGTH) return null
  for (const char of key) if (!KEY_ALPHABET.includes(char)) return null
  return key
}

// K7QF-2M9X-… for showing and copying.
export function formatKey(key: string): string {
  return key.match(/.{1,4}/g)!.join('-')
}
