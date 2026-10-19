import { describe, expect, it } from 'vitest'
import type { Card, Grade } from '../../types'
import { DAY, MIN, formatWait, gradeLabel, schedule, studyDayStart } from './srs'

// Fixed inputs. Local time, on a date far from daylight-saving changes.
const NOW = new Date(2026, 0, 10, 15, 0).getTime() // 10 Jan 2026, 15:00
const at4am = (day: number) => new Date(2026, 0, day, 4, 0).getTime()
const NO_FUZZ = 0.5 // fuzz factor exactly 1.0

function card(overrides: Partial<Card> = {}): Card {
  return { id: 'c', elementId: 'e', front: 'f', back: 'b', due: NOW, interval: 0, ease: 2.5, reps: 0, lapses: 0, createdAt: 0, updatedAt: 0, ...overrides }
}

const grade = (c: Card, g: Grade) => schedule(c, g, NOW, NO_FUZZ)

describe('schedule: a new card', () => {
  it('Again: relearn in 10 minutes, counts a lapse, ease -0.2', () => {
    const c = grade(card(), 0)
    expect(c).toMatchObject({ reps: 0, lapses: 1, interval: 0, ease: 2.3, due: NOW + 10 * MIN })
  })
  it('Hard: 1 day, ease -0.15', () => {
    expect(grade(card(), 1)).toMatchObject({ reps: 1, interval: 1, ease: 2.35, due: at4am(11) })
  })
  it('Good: 1 day, ease unchanged', () => {
    expect(grade(card(), 2)).toMatchObject({ reps: 1, interval: 1, ease: 2.5, due: at4am(11) })
  })
  it('Easy: 4 days, ease +0.15', () => {
    expect(grade(card(), 3)).toMatchObject({ reps: 1, interval: 4, ease: 2.65, due: at4am(14) })
  })
})

describe('schedule: second review', () => {
  const second = card({ reps: 1, interval: 1 })
  it('Hard 3d, Good 6d, Easy 8d', () => {
    expect(grade(second, 1).interval).toBe(3)
    expect(grade(second, 2).interval).toBe(6)
    expect(grade(second, 3).interval).toBe(8)
  })
})

describe('schedule: a mature card (reps 2, 6 days, ease 2.5)', () => {
  const mature = card({ reps: 2, interval: 6 })
  it('Hard: interval × 1.2, at least +1 day', () => {
    expect(grade(mature, 1)).toMatchObject({ reps: 3, interval: 7, ease: 2.35 })
  })
  it('Good: interval × ease', () => {
    expect(grade(mature, 2)).toMatchObject({ reps: 3, interval: 15, ease: 2.5, due: at4am(25) })
  })
  it('Easy: interval × ease × 1.3, using the ease before this review', () => {
    expect(grade(mature, 3)).toMatchObject({ reps: 3, interval: 20, ease: 2.65 })
  })
  it('never grows by less than a day', () => {
    expect(grade(card({ reps: 3, interval: 2, ease: 1.3 }), 1).interval).toBe(3)
  })
})

describe('schedule: lapses', () => {
  const mature = card({ reps: 5, interval: 30, ease: 2.5, lapses: 1 })
  it('Again resets reps and interval, keeps counting lapses', () => {
    expect(grade(mature, 0)).toMatchObject({ reps: 0, interval: 0, lapses: 2, ease: 2.3, due: NOW + 10 * MIN })
  })
  it('after a lapse, Good starts over at 1 day with the lowered ease', () => {
    const relearned = grade(grade(mature, 0), 2)
    expect(relearned).toMatchObject({ reps: 1, interval: 1, ease: 2.3, lapses: 2 })
  })
})

describe('schedule: ease floor', () => {
  it('Again never takes ease below 1.3', () => {
    expect(grade(card({ ease: 1.35 }), 0).ease).toBe(1.3)
  })
  it('Hard never takes ease below 1.3', () => {
    expect(grade(card({ ease: 1.3, reps: 3, interval: 10 }), 1).ease).toBe(1.3)
  })
})

describe('schedule: fuzz', () => {
  const mature = card({ reps: 2, interval: 8 }) // Good → 20 days before fuzz
  it('spreads intervals by at most ±5%', () => {
    expect(schedule(mature, 2, NOW, 0).interval).toBe(19)
    expect(schedule(mature, 2, NOW, 0.9999).interval).toBe(21)
  })
  it('never gives less than 1 day', () => {
    expect(schedule(card(), 2, NOW, 0).interval).toBe(1)
  })
})

describe('due time', () => {
  it('is 04:00 local, even for a review just before midnight', () => {
    const late = new Date(2026, 0, 10, 23, 30).getTime()
    expect(schedule(card(), 2, late, NO_FUZZ).due).toBe(at4am(11))
  })
  it('the study day starts at 04:00', () => {
    expect(studyDayStart(new Date(2026, 0, 10, 3, 59).getTime())).toBe(at4am(9))
    expect(studyDayStart(at4am(10))).toBe(at4am(10))
  })
})

describe('grade button labels', () => {
  it('for a new card: 10m, 1d, 1d, 4d', () => {
    expect(([0, 1, 2, 3] as Grade[]).map((g) => gradeLabel(card(), g, NOW, NO_FUZZ))).toEqual(['10m', '1d', '1d', '4d'])
  })
  it('long waits read as months and years', () => {
    expect(formatWait(45 * DAY)).toBe('1.5mo')
    expect(formatWait(400 * DAY)).toBe('1.1y')
  })
})
