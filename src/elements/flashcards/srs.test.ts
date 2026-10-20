import { createEmptyCard, fsrs, generatorParameters, State } from 'ts-fsrs'
import { describe, expect, it } from 'vitest'
import type { Card, Grade, ReviewLog, Srs } from '../../types'
import { DAY, formatWait, migrateCard, MIN, newSrs, outcomes, recall, review, studyDayStart, toSrs, waitLabel } from './srs'

// Fixed inputs. Local time, on dates far from daylight-saving changes.
const at = (day: number, h: number, m = 0) => new Date(2026, 0, day, h, m).getTime()
const NOW = at(10, 15) // 10 Jan 2026, 15:00
const GRADES: Grade[] = [0, 1, 2, 3]

// A card that has graduated to Review (Good, then Good again 10 minutes later).
function reviewCard(): Srs {
  return review(review(newSrs(NOW - DAY), 2, NOW - DAY), 2, NOW - DAY + 10 * MIN)
}

describe('new cards', () => {
  it('start New and due straight away', () => {
    expect(newSrs(NOW)).toMatchObject({ state: State.New, due: NOW, reps: 0, lapses: 0 })
  })

  it('learning steps are exact minutes: Again 1m, Hard 6m, Good 10m', () => {
    const o = outcomes(newSrs(NOW), NOW)
    expect([o[0].due - NOW, o[1].due - NOW, o[2].due - NOW]).toEqual([1 * MIN, 6 * MIN, 10 * MIN])
    expect([0, 1, 2].map((g) => waitLabel(o[g as Grade], NOW))).toEqual(['1m', '6m', '10m'])
  })

  it('Easy skips learning and is due at 04:00 on its day', () => {
    const easy = outcomes(newSrs(NOW), NOW)[3]
    expect(easy.state).toBe(State.Review)
    expect(easy.scheduled_days).toBeGreaterThanOrEqual(1)
    expect(new Date(easy.due).getHours()).toBe(4)
    expect(waitLabel(easy, NOW)).toBe(`${easy.scheduled_days}d`)
  })
})

describe('reviews', () => {
  it('what the buttons show is exactly what grading saves', () => {
    for (const srs of [newSrs(NOW), reviewCard()]) {
      const o = outcomes(srs, NOW)
      for (const g of GRADES) expect(review(srs, g, NOW)).toEqual(o[g])
    }
  })

  it('longer waits for better grades, and Again counts a lapse', () => {
    const srs = reviewCard()
    const o = outcomes(srs, NOW + 3 * DAY)
    expect(o[1].scheduled_days).toBeLessThanOrEqual(o[2].scheduled_days)
    expect(o[2].scheduled_days).toBeLessThan(o[3].scheduled_days)
    expect(o[0]).toMatchObject({ state: State.Relearning, lapses: srs.lapses + 1 })
  })

  it('a day-scale review is due at 04:00, even when studied just before midnight', () => {
    const late = at(10, 23, 30)
    const after = review(reviewCard(), 2, late)
    const due = new Date(after.due)
    expect(due.getHours()).toBe(4)
    expect(Math.round((after.due - at(10, 4)) / DAY)).toBe(after.scheduled_days)
  })

  it('recall is near 1 right after a review and falls with time', () => {
    const srs = reviewCard()
    const r1 = recall(srs, srs.last_review!)
    const r2 = recall(srs, srs.last_review! + 30 * DAY)
    expect(r1).toBeGreaterThan(0.99)
    expect(r2).toBeLessThan(r1)
  })
})

describe('migrating v1 cards', () => {
  const v1 = (o: Partial<Card> = {}): Card =>
    ({ id: 'c', elementId: 'e', front: 'f', back: 'b', createdAt: at(1, 9), updatedAt: 0, due: at(1, 9), interval: 0, ease: 2.5, reps: 0, lapses: 0, ...o }) as Card
  const log = (grade: Grade, when: number): ReviewLog => ({ id: String(when), cardId: 'c', at: when, grade, prevInterval: 0, updatedAt: when })

  it('replays the review history in time order, v1 grades 0–3 as FSRS ratings 1–4', () => {
    const history = [log(2, at(2, 10)), log(0, at(9, 18)), log(2, at(2, 10, 10)), log(3, at(5, 8))] // out of order on purpose
    const migrated = migrateCard(v1({ reps: 2 }), history)

    // The same reviews straight through ts-fsrs, in order, with ratings = grade + 1.
    const f = fsrs(generatorParameters({ request_retention: 0.9, maximum_interval: 365, enable_fuzz: true }))
    let card = createEmptyCard(at(1, 9))
    for (const [rating, when] of [[3, at(2, 10)], [3, at(2, 10, 10)], [4, at(5, 8)], [1, at(9, 18)]] as const) card = f.next(card, when, rating).card
    const expected = toSrs(card)

    expect(migrated).toMatchObject({
      state: expected.state,
      stability: expected.stability,
      difficulty: expected.difficulty,
      reps: expected.reps,
      lapses: expected.lapses,
      last_review: at(9, 18),
      due: expected.due, // the last review was Again: a 10-minute relearning step, not snapped
    })
  })

  it('a reviewed card without history becomes a Review card: stability ≈ interval, mid difficulty, same due', () => {
    const due = at(20, 4)
    expect(migrateCard(v1({ reps: 4, lapses: 1, interval: 12, due }), [])).toMatchObject({
      state: State.Review,
      stability: 12,
      difficulty: 5,
      due,
      reps: 4,
      lapses: 1,
      last_review: due - 12 * DAY,
    })
  })

  it('a never-reviewed card becomes a new card', () => {
    expect(migrateCard(v1(), [])).toMatchObject({ state: State.New, due: at(1, 9), reps: 0 })
  })
})

describe('days', () => {
  it('the study day starts at 04:00', () => {
    expect(studyDayStart(at(10, 3, 59))).toBe(at(9, 4))
    expect(studyDayStart(at(10, 4))).toBe(at(10, 4))
  })

  it('long waits read as months and years', () => {
    expect(formatWait(45 * DAY)).toBe('1.5mo')
    expect(formatWait(400 * DAY)).toBe('1.1y')
  })
})
