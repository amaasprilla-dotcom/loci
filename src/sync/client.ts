// Talking to the sync server (worker/api.ts). Every failure becomes a SyncError
// whose `problem` says what the user can do about it.

import { formatKey, VERSION_HEADER, type Change, type ServerRecord } from './rules'

export type SyncProblem =
  | 'offline' // no connection; retried
  | 'unavailable' // this address has no sync server (e.g. the GitHub Pages copy, or `npm run dev`)
  | 'wrong-key' // the key isn't (or is no longer) the one the server knows
  | 'not-set-up' // the server has no key yet
  | 'taken' // Set up sync, but sync is already set up
  | 'update' // this app is older than another device's: update before pushing
  | 'server' // anything else; retried

const TIMEOUT_MS = 20_000

export class SyncError extends Error {
  problem: SyncProblem
  constructor(problem: SyncProblem) {
    super(`Sync: ${problem}`)
    this.problem = problem
  }
}

export interface PushResult {
  results: ('accepted' | 'stale')[]
  seq: number
}

export interface PullResult {
  changes: ServerRecord[]
  more: boolean
  seq: number
}

export function createClient(version: () => number) {
  async function call<T>(method: 'GET' | 'POST', path: string, key: string, body?: unknown): Promise<T> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new SyncError('offline')
    let response: Response
    try {
      response = await fetch(`/api/sync/${path}`, {
        method,
        headers: { Authorization: `Bearer ${formatKey(key)}`, [VERSION_HEADER]: String(version()), ...(body !== undefined && { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
        // A connection that hangs counts as offline, so the round ends and retries.
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch {
      throw new SyncError('offline')
    }
    let data: { error?: string } & Record<string, unknown>
    try {
      data = await response.json()
    } catch {
      // A page instead of JSON: no sync server at this address.
      throw new SyncError('unavailable')
    }
    if (response.ok) return data as T
    const problems: Record<string, SyncProblem> = { 'wrong-key': 'wrong-key', 'not-set-up': 'not-set-up', taken: 'taken', update: 'update' }
    throw new SyncError(problems[data.error ?? ''] ?? 'server')
  }

  return {
    claim: (key: string) => call<{ seq: number }>('POST', 'claim', key),
    status: (key: string) => call<{ seq: number; newestVersion: number }>('GET', 'status', key),
    push: (key: string, device: string, changes: Change[]) => call<PushResult>('POST', 'push', key, { device, changes }),
    pull: (key: string, since: number) => call<PullResult>('GET', `pull?since=${since}`, key),
    rekey: (key: string, newKey: string) => call<object>('POST', 'rekey', key, { key: newKey }),
  }
}
