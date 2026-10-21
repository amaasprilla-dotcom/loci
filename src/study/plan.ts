// Study sessions (SPEC-v2.md, "Study sessions"): one queue mixing a locus's due
// cards and problems. Length is in minutes, filled using how long each kind of
// item takes this user; items closest to being forgotten go first so the time
// limit never cuts them; then the session is interleaved.

import { DEFAULT_RETENTION, isNewSrs, recall } from '../elements/flashcards/srs'
import { planSession } from '../elements/flashcards/session'
import type { FlashcardsData } from '../elements/flashcards/store'
import { median, planProblems } from '../elements/problems/schedule'
import type { ProblemsData } from '../elements/problems/type'
import { db } from '../store/db'
import type { Card, LocusElement, ProblemTemplate, Srs } from '../types'

export type StudyKind = 'card' | 'template'

export interface StudyItem {
  kind: StudyKind
  id: string
  elementId: string
  srs: Srs
  isNew: boolean
  estSeconds: number
  recall: number // chance of remembering it now; 0 for new items
}

export const DEFAULT_SECONDS: Record<StudyKind, number> = { card: 8, template: 60 }
const MIN_SAMPLES = 5

// How long a card and a problem take this user: the median of recent ones, or the defaults.
export async function estimates(): Promise<Record<StudyKind, number>> {
  const reviews = (await db.reviews.orderBy('at').reverse().limit(400).toArray()).filter((r) => r.ms != null).map((r) => r.ms!)
  const attempts = (await db.problemAttempts.orderBy('at').reverse().limit(200).toArray()).map((a) => a.ms)
  const est = (xs: number[], fallback: number) => (xs.length >= MIN_SAMPLES ? Math.min(600, Math.max(2, Math.round(median(xs) / 1000))) : fallback)
  return { card: est(reviews, DEFAULT_SECONDS.card), template: est(attempts, DEFAULT_SECONDS.template) }
}

export interface StudyPool {
  items: StudyItem[]
  cards: Map<string, Card>
  templates: Map<string, ProblemTemplate>
  elements: Map<string, LocusElement>
}

// New-item limits per element for today, when something (an exam) overrides the element's own.
export type NewLimits = Map<string, number>

// Everything there is to study now in these elements (their daily limits applied).
export async function studyPool(elements: LocusElement[], now: number, newLimits: NewLimits = new Map()): Promise<StudyPool> {
  const est = await estimates()
  const loci = new Map((await db.loci.bulkGet([...new Set(elements.map((e) => e.locusId))])).filter((l) => l != null).map((l) => [l.id, l]))
  const pool: StudyPool = { items: [], cards: new Map(), templates: new Map(), elements: new Map(elements.map((e) => [e.id, e])) }
  for (const el of elements) {
    const retention = loci.get(el.locusId)?.retention ?? DEFAULT_RETENTION
    const item = (kind: StudyKind, id: string, srs: Srs): StudyItem => {
      const fresh = isNewSrs(srs)
      return { kind, id, elementId: el.id, srs, isNew: fresh, estSeconds: est[kind], recall: fresh ? 0 : recall(srs, now, retention) }
    }
    if (el.type === 'flashcards') {
      for (const c of await planSession(el as LocusElement<FlashcardsData>, now, newLimits.get(el.id))) {
        pool.cards.set(c.id, c)
        pool.items.push(item('card', c.id, c.srs))
      }
    } else if (el.type === 'problems') {
      for (const t of await planProblems(el as LocusElement<ProblemsData>, now, newLimits.get(el.id))) {
        pool.templates.set(t.id, t)
        pool.items.push(item('template', t.id, t.srs))
      }
    }
  }
  return pool
}

// Which items fit in the time: reviews lowest recall first, then new items, taking
// each that still fits. `budget` in seconds; null = until done. Never over budget.
export function selectForBudget(items: StudyItem[], budget: number | null): StudyItem[] {
  const reviews = items.filter((i) => !i.isNew).sort((a, b) => a.recall - b.recall)
  const fresh = interleaveKinds(items.filter((i) => i.isNew))
  const ordered = [...reviews, ...fresh]
  if (budget == null) return ordered
  const out: StudyItem[] = []
  let total = 0
  for (const item of ordered) {
    if (total + item.estSeconds > budget) continue
    out.push(item)
    total += item.estSeconds
  }
  return out
}

// New cards and new problems alternating, so a time limit doesn't keep only one kind.
function interleaveKinds(items: StudyItem[]): StudyItem[] {
  const cards = items.filter((i) => i.kind === 'card')
  const problems = items.filter((i) => i.kind === 'template')
  return merge(cards, problems)
}

// Round-robin across elements, so two items from the same deck or set rarely sit side by side.
function spreadByElement(items: StudyItem[]): StudyItem[] {
  const groups = new Map<string, StudyItem[]>()
  for (const i of items) groups.set(i.elementId, [...(groups.get(i.elementId) ?? []), i])
  const out: StudyItem[] = []
  let last: string | null = null
  while (out.length < items.length) {
    // The fullest group that isn't the one just used.
    const candidates = [...groups.entries()].filter(([, g]) => g.length > 0).sort((a, b) => b[1].length - a[1].length)
    const pick = candidates.find(([id]) => id !== last) ?? candidates[0]
    out.push(pick[1].shift()!)
    last = pick[0]
  }
  return out
}

// Problems spread evenly between cards: with 12 cards and 4 problems, one problem every fourth item.
function merge(cards: StudyItem[], problems: StudyItem[]): StudyItem[] {
  const n = cards.length + problems.length
  const out: StudyItem[] = []
  let ci = 0
  let pi = 0
  for (let k = 0; k < n; k++) {
    const problemDue = pi < problems.length && (ci >= cards.length || ((pi + 0.5) * n) / problems.length <= k + 1)
    out.push(problemDue ? problems[pi++] : cards[ci++])
  }
  return out
}

// The session's order: problems spread evenly between cards, and as few
// neighbours from the same deck or set as can be helped.
export function interleave(items: StudyItem[]): StudyItem[] {
  const out = merge(
    spreadByElement(items.filter((i) => i.kind === 'card')),
    spreadByElement(items.filter((i) => i.kind === 'template')),
  )
  // Where two neighbours still share an element, swap in a later item from elsewhere.
  for (let i = 1; i < out.length; i++) {
    if (out[i].elementId !== out[i - 1].elementId) continue
    const j = out.findIndex((x, k) => k > i && x.elementId !== out[i - 1].elementId && x.kind === out[i].kind && (k + 1 >= out.length || out[k + 1].elementId !== out[i].elementId) && out[k - 1].elementId !== out[i].elementId)
    if (j > i) [out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export function buildSession(items: StudyItem[], budget: number | null): StudyItem[] {
  return interleave(selectForBudget(items, budget))
}

export interface StudySummary {
  cards: number // due card reviews
  problems: number // due problems, new ones included (a new problem is due at once)
  seconds: number
  oldestDue: number | null // the longest-waiting review, for "overdue"
}

// What a Study task says: what's due now, and about how long it takes.
export function summarize(pool: StudyPool): StudySummary {
  const work = pool.items.filter((i) => i.kind === 'template' || !i.isNew)
  const reviews = work.filter((i) => !i.isNew)
  return {
    cards: work.filter((i) => i.kind === 'card').length,
    problems: work.filter((i) => i.kind === 'template').length,
    seconds: work.reduce((s, i) => s + i.estSeconds, 0),
    oldestDue: reviews.length ? Math.min(...reviews.map((i) => i.srs.due)) : null,
  }
}
