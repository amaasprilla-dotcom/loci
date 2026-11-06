import { describe, expect, it } from 'vitest'
import { applyChange, changeGate, countFor, daysLeft, defaultWeekly, heldTo, isReady, lastWeeks, reviewDue, snapshot, statusOf, weekKey, type WeeklyTarget } from './model'

// Local times. 2 Nov 2026 is a Monday.
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime()
const target = (over: Partial<WeeklyTarget> = {}): WeeklyTarget => ({ id: 't', name: 'Videos', min: 1, good: 2, todoIds: [], ...over })

describe('weeks', () => {
  it('runs Monday 04:00 to Monday 04:00', () => {
    expect(weekKey(at(2, 4))).toBe('2026-11-02')
    expect(weekKey(at(8, 23))).toBe('2026-11-02') // Sunday night
    expect(weekKey(at(9, 3))).toBe('2026-11-02') // 3 a.m. Monday is still Sunday
    expect(weekKey(at(9, 4))).toBe('2026-11-09')
  })
  it('lists the last weeks, oldest first', () => {
    expect(lastWeeks(at(10, 12), 3)).toEqual(['2026-10-26', '2026-11-02', '2026-11-09'])
  })
  it('counts the days left, today included', () => {
    expect(daysLeft(at(2, 12))).toBe(7)
    expect(daysLeft(at(8, 12))).toBe(1)
  })
})

describe('counting', () => {
  it('adds taps to the linked blocks done that week', () => {
    const data = defaultWeekly()
    const t = target({ todoIds: ['block'] })
    data.taps['2026-11-02'] = { t: 1 }
    const done = [
      { todoId: 'block', doneAt: at(3, 15) },
      { todoId: 'block', doneAt: at(9, 15) }, // next week
      { todoId: 'other', doneAt: at(3, 15) },
    ]
    expect(countFor(data, t, '2026-11-02', done)).toBe(2)
  })
  it('makes the minimum a full win, and good a good week', () => {
    expect(statusOf(0, { min: 1, good: 3 })).toBe('short')
    expect(statusOf(1, { min: 1, good: 3 })).toBe('win')
    expect(statusOf(3, { min: 1, good: 3 })).toBe('good')
  })
  it('keeps past weeks held to their own numbers', () => {
    const data = defaultWeekly()
    data.targets = [target({ min: 1, good: 2 })]
    snapshot(data, '2026-11-02')
    const changed = applyChange(data, [target({ min: 3, good: 5 })], data, at(10, 12))
    expect(heldTo(changed, changed.targets[0], '2026-11-02')).toEqual({ min: 1, good: 2 })
    expect(heldTo(changed, changed.targets[0], '2026-11-09')).toEqual({ min: 3, good: 5 })
  })
})

describe('changing', () => {
  const withTargets = () => {
    const d = defaultWeekly()
    d.targets = [target()]
    return d
  }
  it('is free while nothing is set up', () => {
    expect(changeGate(defaultWeekly(), at(4, 12)).kind).toBe('now')
  })
  it('asks for a wait by default, except on review day', () => {
    expect(changeGate(withTargets(), at(4, 12))).toEqual({ kind: 'wait', hours: 24 })
    expect(changeGate(withTargets(), at(8, 12)).kind).toBe('now') // Sunday
  })
  it('stays closed until review day under that rule', () => {
    const d = withTargets()
    d.changeRule = { kind: 'reviewDay' }
    expect(changeGate(d, at(4, 12))).toEqual({ kind: 'closed', opens: at(8, 4) })
    d.changeRule = { kind: 'free' }
    expect(changeGate(d, at(4, 12)).kind).toBe('now')
  })
  it('is ready once the wait is over', () => {
    const p = { askedAt: at(4, 12), readyAt: at(5, 12), reason: 'x', targets: [], rules: defaultWeekly() }
    expect(isReady(p, at(5, 11))).toBe(false)
    expect(isReady(p, at(5, 12))).toBe(true)
  })
})

describe('review', () => {
  it('is due on review day until done', () => {
    const d = defaultWeekly()
    d.targets = [target()]
    expect(reviewDue(d, at(7, 12))).toBe(false)
    expect(reviewDue(d, at(8, 12))).toBe(true)
    d.reviewed = ['2026-11-02']
    expect(reviewDue(d, at(8, 12))).toBe(false)
  })
})
