import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import '../elements/all'
import { review } from '../elements/flashcards/srs'
import { addCards, DEFAULT_FLASHCARDS_DATA, listCards } from '../elements/flashcards/store'
import { generate, rngFor } from '../elements/problems/engine'
import { SAMPLES } from '../elements/problems/samples'
import { deriveGrade, planProblems, recordAttempt } from '../elements/problems/schedule'
import { createTemplate, listTemplates } from '../elements/problems/store'
import type { ProblemsData } from '../elements/problems/type'
import { createElement, createLocus, db } from '../store/db'
import { allTasks } from '../tasks/tasks'
import type { LocusElement, Srs } from '../types'
import { buildSession, interleave, selectForBudget, type StudyItem, studyPool, summarize } from './plan'
import { setSplitStudyTasks } from './tasks'

const srs = (due: number): Srs => ({ due, stability: 3, difficulty: 5, elapsed_days: 3, scheduled_days: 3, learning_steps: 0, reps: 2, lapses: 0, state: 2 })

function item(kind: StudyItem['kind'], i: number, elementId: string, recall = 0.5, isNew = false): StudyItem {
  return { kind, id: `${kind}-${elementId}-${i}`, elementId, srs: srs(0), isNew, estSeconds: kind === 'card' ? 8 : 60, recall }
}

describe('rating a problem from correctness and time', () => {
  it('wrong is Again; the first three right answers are Good', () => {
    expect(deriveGrade(false, 1000, [])).toBe(0)
    expect(deriveGrade(true, 99_000, [1000, 1000])).toBe(2)
  })
  it('against the median of earlier right answers: slow is Hard, quick is Easy', () => {
    const previous = [40_000, 50_000, 60_000]
    expect(deriveGrade(true, 76_000, previous)).toBe(1) // over 1.5 × 50 s
    expect(deriveGrade(true, 74_000, previous)).toBe(2)
    expect(deriveGrade(true, 29_000, previous)).toBe(3) // under 0.6 × 50 s
    expect(deriveGrade(true, 31_000, previous)).toBe(2)
  })
})

describe('building a session', () => {
  // A random mix of decks and sets, seeded so failures can be replayed.
  function randomPool(seed: string): StudyItem[] {
    const rng = rngFor(seed)
    const items: StudyItem[] = []
    const decks = 1 + Math.floor(rng() * 3)
    const sets = Math.floor(rng() * 3)
    for (let d = 0; d < decks; d++) for (let i = 0; i < Math.floor(rng() * 25); i++) items.push({ ...item('card', i, `deck${d}`, rng(), rng() < 0.2), estSeconds: 5 + Math.floor(rng() * 10) })
    for (let s = 0; s < sets; s++) for (let i = 0; i < Math.floor(rng() * 8); i++) items.push({ ...item('template', i, `set${s}`, rng(), rng() < 0.2), estSeconds: 40 + Math.floor(rng() * 60) })
    return items
  }

  it('never goes over its time budget, and never repeats a template back to back', () => {
    for (let k = 0; k < 200; k++) {
      const pool = randomPool(`pool-${k}`)
      for (const minutes of [5, 10, 15, 25]) {
        const session = buildSession(pool, minutes * 60)
        expect(session.reduce((s, i) => s + i.estSeconds, 0)).toBeLessThanOrEqual(minutes * 60)
        for (let i = 1; i < session.length; i++) expect(session[i].id).not.toBe(session[i - 1].id)
      }
      expect(buildSession(pool, null)).toHaveLength(pool.length)
    }
  })

  it('takes the reviews closest to being forgotten first, then new items', () => {
    const pool = [item('card', 1, 'd', 0.9), item('card', 2, 'd', 0.2), item('card', 3, 'd', 0, true), item('card', 4, 'd', 0.5)]
    expect(selectForBudget(pool, 16).map((i) => i.id)).toEqual(['card-d-2', 'card-d-4'])
    expect(selectForBudget(pool, null).map((i) => i.id)).toEqual(['card-d-2', 'card-d-4', 'card-d-1', 'card-d-3'])
  })

  it('spreads problems evenly between cards', () => {
    const pool = [...Array.from({ length: 12 }, (_, i) => item('card', i, 'deck')), ...Array.from({ length: 4 }, (_, i) => item('template', i, 'set'))]
    const order = interleave(pool).map((i) => i.kind)
    const at = order.flatMap((k, i) => (k === 'template' ? [i] : []))
    expect(at).toHaveLength(4)
    for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1]).toBeGreaterThanOrEqual(3)
  })

  it('avoids two items from the same deck side by side when it can', () => {
    const pool = [...Array.from({ length: 6 }, (_, i) => item('card', i, 'a')), ...Array.from({ length: 6 }, (_, i) => item('card', i, 'b'))]
    const order = interleave(pool)
    for (let i = 1; i < order.length; i++) expect(order[i].elementId).not.toBe(order[i - 1].elementId)
  })
})

describe('a locus with a deck and a problem set', () => {
  beforeEach(() => Promise.all(db.tables.map((t) => t.clear())))
  const now = new Date(2026, 9, 21, 10).getTime()

  async function setup() {
    const locus = await createLocus({ name: 'Physics', color: '#000000', x: 0, y: 0 })
    const deck = await createElement(locus.id, 'flashcards', 'Units', { ...DEFAULT_FLASHCARDS_DATA })
    const set = (await createElement(locus.id, 'problems', 'Kinematics', { newPerDay: 2 })) as LocusElement<ProblemsData>
    await addCards(deck.id, [
      { front: 'm/s', back: 'speed' },
      { front: 'N', back: 'force' },
      { front: 'J', back: 'energy' },
    ])
    // Two cards reviewed earlier and due now; one still new.
    const [a, b] = await listCards(deck.id)
    for (const c of [a, b]) await db.cards.put({ ...c, srs: { ...review(c.srs, 2, now - 5 * 86_400_000), due: now - 3600_000 } })
    for (const name of ['speed', 'ohm', 'circleArea'] as const) await createTemplate(set.id, SAMPLES[name], now - 1000)
    return { locus, deck, set }
  }

  it('pools due cards, new cards and new problems within the daily limits', async () => {
    const { deck, set } = await setup()
    const pool = await studyPool([deck, set], now)
    expect(pool.items.filter((i) => i.kind === 'card' && !i.isNew)).toHaveLength(2)
    expect(pool.items.filter((i) => i.kind === 'card' && i.isNew)).toHaveLength(1)
    expect(pool.items.filter((i) => i.kind === 'template')).toHaveLength(2) // new per day: 2
    expect(summarize(pool)).toMatchObject({ cards: 2, problems: 2, seconds: 2 * 8 + 2 * 60 })
  })

  it('makes one Study task per locus, or one per deck and set', async () => {
    const { locus } = await setup()
    const merged = (await allTasks(now)).filter((t) => t.kind === 'review')
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ locusId: locus.id, elementId: '', label: 'Study · 2 cards, 2 problems', state: 'due' })
    expect(merged[0].sublabel).toBe('~2 min')

    await setSplitStudyTasks(true)
    const split = (await allTasks(now)).filter((t) => t.kind === 'review')
    expect(split.map((t) => t.label).sort()).toEqual(['2 cards due', '2 problems due'])
  })

  it('saves each attempt and schedules the template by its derived rating', async () => {
    const { set } = await setup()
    const [t] = await planProblems(set, now)
    const g = generate(t, 'seed-1')
    if (!g.ok) throw new Error('no instance')
    const { grade, template } = await recordAttempt(t, g.instance, { correct: false, given: 1, ms: 30_000 }, now, 0.9)
    expect(grade).toBe(0)
    expect(template.srs.reps).toBe(1)
    expect(await db.problemAttempts.where('templateId').equals(t.id).toArray()).toMatchObject([{ seed: 'seed-1', correct: false, grade: 0, ms: 30_000 }])
    // A template first tried today counts toward today's new limit.
    expect((await planProblems(set, now + 60_000)).filter((x) => x.srs.state === 0)).toHaveLength(1)
    expect((await listTemplates(set.id)).find((x) => x.id === t.id)!.srs.state).not.toBe(0)
  })
})
