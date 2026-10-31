// The event log (SPEC-v5-now.md, "Event log"): what the Now card showed and what
// you did with it, kept on this device so the score can be tuned from real use.

import type { Task } from '../elements/registry'
import { db } from '../store/db'
import type { AppEvent } from '../types'

const DAY = 86_400_000
export const KEEP_DAYS = 180
export const START_WINDOW_MS = 10 * 60_000 // a card counts as acted on if started within this

// Candidates already logged as shown since the app was opened (or came back to the front).
const shown = new Set<string>()
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') shown.clear()
  })
}

export function resetShown(): void {
  shown.clear()
}

// Writes one event for a ranked task. Never throws: the log must not get in the way.
export async function logEvent(type: AppEvent['type'], task: Task, options: { rank?: number; meta?: Record<string, unknown>; now?: number } = {}): Promise<void> {
  const r = task.rank
  if (!r) return
  try {
    await db.events.add({
      ts: options.now ?? Date.now(),
      type,
      key: r.key,
      ...(task.itemId && { itemId: task.itemId }),
      bubbleId: task.locusId,
      candidateType: r.type,
      rank: options.rank ?? 1,
      score: r.priority,
      terms: r.terms,
      ...(options.meta && { meta: options.meta }),
    })
  } catch (err) {
    console.warn('event log', err)
  }
}

// The top card changed: log it once per candidate per app open.
export async function noteShown(task: Task, now?: number): Promise<void> {
  const key = task.rank?.key
  if (!key || shown.has(key)) return
  shown.add(key)
  await logEvent('card_shown', task, { rank: 1, now })
}

export async function pruneEvents(now = Date.now()): Promise<void> {
  try {
    await db.events.where('ts').below(now - KEEP_DAYS * DAY).delete()
  } catch (err) {
    console.warn('event log', err)
  }
}

// Keys passed over from the top card in the last `ms` (the S term).
export async function passedOver(now: number, ms: number): Promise<Set<string>> {
  const recent = await db.events.where('ts').aboveOrEqual(now - ms).filter((e) => e.type === 'pass').toArray()
  return new Set(recent.map((e) => e.key))
}

// The success metric: cards started within 10 minutes of being shown, over all cards shown.
export async function startRate(now: number, days = 7): Promise<{ started: number; shown: number }> {
  const events = await db.events.where('ts').aboveOrEqual(now - days * DAY).toArray()
  const starts = new Map<string, number[]>()
  for (const e of events) if (e.type === 'start') starts.set(e.key, [...(starts.get(e.key) ?? []), e.ts])
  const cards = events.filter((e) => e.type === 'card_shown')
  const started = cards.filter((c) => starts.get(c.key)?.some((t) => t >= c.ts && t - c.ts <= START_WINDOW_MS)).length
  return { started, shown: cards.length }
}

const csv = (v: unknown) => {
  const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function eventsCsv(): Promise<string> {
  const rows = await db.events.orderBy('ts').toArray()
  const head = ['time', 'type', 'key', 'candidate', 'rank', 'score', 'I', 'U', 'B', 'N', 'S', 'meta']
  const lines = rows.map((e) =>
    [new Date(e.ts).toISOString(), e.type, e.key, e.candidateType, e.rank, e.score.toFixed(3), e.terms.I, e.terms.U.toFixed(3), e.terms.B.toFixed(3), e.terms.N.toFixed(3), e.terms.S, e.meta].map(csv).join(','),
  )
  return [head.join(','), ...lines].join('\n') + '\n'
}
