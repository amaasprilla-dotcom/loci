// Study sessions (SPEC-v2.md, "Study sessions"): one queue mixing a locus's due
// cards and problems, and notes practised by blank-page recall (SPEC-v3-coach.md). Length is in minutes, filled using how long each kind of
// item takes this user; items closest to being forgotten go first so the time
// limit never cuts them; then the session is interleaved.

import { DEFAULT_RETENTION, isNewSrs, recall } from '../elements/flashcards/srs'
import { type ExamAdjustments, inFinalPass } from '../exams/exams'
import { planSession } from '../elements/flashcards/session'
import { type FlashcardsData, listCards } from '../elements/flashcards/store'
import { median, planProblems } from '../elements/problems/schedule'
import { listTemplates } from '../elements/problems/store'
import { recallDue } from '../elements/notes/recall'
import type { ProblemsData } from '../elements/problems/type'
import { db } from '../store/db'
import type { Card, LocusElement, Note, ProblemTemplate, Srs } from '../types'

export type StudyKind = 'card' | 'template' | 'note'

export interface StudyItem {
  kind: StudyKind
  id: string
  elementId: string
  srs: Srs
  isNew: boolean
  estSeconds: number
  recall: number // chance of remembering it now; 0 for new items
}

// Element types whose items can be studied: decks, problem sets, and notebooks (recall).
const STUDY_TYPES = new Set(['flashcards', 'problems', 'notes'])
export const isStudyable = (el: Pick<LocusElement, 'type'>): boolean => STUDY_TYPES.has(el.type)

export const DEFAULT_SECONDS: Record<StudyKind, number> = { card: 8, template: 60, note: 180 }
const MIN_SAMPLES = 5

// How long a card, a problem and a recall take this user: the median of recent ones, or the defaults.
export async function estimates(): Promise<Record<StudyKind, number>> {
  const reviews = (await db.reviews.orderBy('at').reverse().limit(400).toArray()).filter((r) => r.ms != null).map((r) => r.ms!)
  const attempts = (await db.problemAttempts.orderBy('at').reverse().limit(200).toArray()).map((a) => a.ms)
  const recalls = (await db.recallAttempts.orderBy('at').reverse().limit(100).toArray()).map((a) => a.ms)
  const est = (xs: number[], fallback: number, max = 600) => (xs.length >= MIN_SAMPLES ? Math.min(max, Math.max(2, Math.round(median(xs) / 1000))) : fallback)
  return { card: est(reviews, DEFAULT_SECONDS.card), template: est(attempts, DEFAULT_SECONDS.template), note: est(recalls, DEFAULT_SECONDS.note, 900) }
}

export interface StudyPool {
  items: StudyItem[]
  cards: Map<string, Card>
  templates: Map<string, ProblemTemplate>
  notes: Map<string, Note>
  elements: Map<string, LocusElement>
}

const NO_ADJUSTMENTS: ExamAdjustments = { newLimits: new Map(), finalPass: new Map() }

// Everything there is to study now in these elements: their daily limits applied,
// with what upcoming exams change (paced new material, the final pass).
export async function studyPool(elements: LocusElement[], now: number, adj: ExamAdjustments = NO_ADJUSTMENTS): Promise<StudyPool> {
  const est = await estimates()
  const loci = new Map((await db.loci.bulkGet([...new Set(elements.map((e) => e.locusId))])).filter((l) => l != null).map((l) => [l.id, l]))
  const pool: StudyPool = { items: [], cards: new Map(), templates: new Map(), notes: new Map(), elements: new Map(elements.map((e) => [e.id, e])) }
  for (const el of elements) {
    const retention = loci.get(el.locusId)?.retention ?? DEFAULT_RETENTION
    const item = (kind: StudyKind, id: string, srs: Srs): StudyItem => {
      const fresh = isNewSrs(srs)
      return { kind, id, elementId: el.id, srs, isNew: fresh, estSeconds: est[kind], recall: fresh ? 0 : recall(srs, now, retention) }
    }
    const finalPass = adj.finalPass.get(el.id)
    if (el.type === 'flashcards') {
      for (const c of await planSession(el as LocusElement<FlashcardsData>, now, adj.newLimits.get(el.id))) {
        pool.cards.set(c.id, c)
        pool.items.push(item('card', c.id, c.srs))
      }
      // An exam's final days: everything under target on exam day, due or not.
      if (finalPass) {
        for (const c of await listCards(el.id)) {
          if (pool.cards.has(c.id) || !inFinalPass(c.srs, finalPass, now)) continue
          pool.cards.set(c.id, c)
          pool.items.push(item('card', c.id, c.srs))
        }
      }
    } else if (el.type === 'problems') {
      for (const t of await planProblems(el as LocusElement<ProblemsData>, now, adj.newLimits.get(el.id))) {
        pool.templates.set(t.id, t)
        pool.items.push(item('template', t.id, t.srs))
      }
      if (finalPass) {
        for (const t of await listTemplates(el.id)) {
          if (pool.templates.has(t.id) || t.tooTight || !inFinalPass(t.srs, finalPass, now)) continue
          pool.templates.set(t.id, t)
          pool.items.push(item('template', t.id, t.srs))
        }
      }
    } else if (el.type === 'notes') {
      // Recall was asked for note by note, so every due one is in: no daily limits.
      for (const n of await recallDue(el.id, now)) {
        pool.notes.set(n.id, n)
        pool.items.push(item('note', n.id, n.recall!.srs))
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

// New cards and new problems (or notes) alternating, so a time limit doesn't keep only one kind.
function interleaveKinds(items: StudyItem[]): StudyItem[] {
  const cards = items.filter((i) => i.kind === 'card')
  const long = items.filter((i) => i.kind !== 'card')
  return merge(cards, long)
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

// Problems (and recalled notes, the other long items) spread evenly between cards:
// with 12 cards and 4 problems, one problem every fourth item.
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

// The session's order: problems and notes spread evenly between cards, and as few
// neighbours from the same deck, set or notebook as can be helped.
export function interleave(items: StudyItem[]): StudyItem[] {
  const out = merge(
    spreadByElement(items.filter((i) => i.kind === 'card')),
    spreadByElement(items.filter((i) => i.kind !== 'card')),
  )
  // Where two neighbours still share an element, swap in a later item from elsewhere.
  for (let i = 1; i < out.length; i++) {
    if (out[i].elementId !== out[i - 1].elementId) continue
    const j = out.findIndex((x, k) => k > i && x.elementId !== out[i - 1].elementId && (x.kind === 'card') === (out[i].kind === 'card') && (k + 1 >= out.length || out[k + 1].elementId !== out[i].elementId) && out[k - 1].elementId !== out[i].elementId)
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
  notes: number // notes to recall, new ones included
  seconds: number
  oldestDue: number | null // the longest-waiting review, for "overdue"
}

// What a Study task says: what's due now, and about how long it takes.
export function summarize(pool: StudyPool): StudySummary {
  const work = pool.items.filter((i) => i.kind !== 'card' || !i.isNew)
  const reviews = work.filter((i) => !i.isNew)
  return {
    cards: work.filter((i) => i.kind === 'card').length,
    problems: work.filter((i) => i.kind === 'template').length,
    notes: work.filter((i) => i.kind === 'note').length,
    seconds: work.reduce((s, i) => s + i.estSeconds, 0),
    oldestDue: reviews.length ? Math.min(...reviews.map((i) => i.srs.due)) : null,
  }
}
