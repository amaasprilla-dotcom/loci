import { describe, expect, it } from 'vitest'
import type { BlockerState } from '../android'
import { blockLine, minutesLabel } from './blocker'

const at = (h: number, m = 0) => new Date(2026, 10, 3, h, m).getTime()
const base: BlockerState = { on: true, firmness: 'firm', blocked: null, next: null, moreUntil: 0, moresLeft: 3, locked: false }

describe('the blocker line', () => {
  it('names the block on now and when it ends', () => {
    const line = blockLine({ ...base, blocked: { id: 'a', kind: 'hours', reason: 'Morning', start: at(9), end: at(12) } }, at(10))
    expect(line).toMatch(/^Blocked until .*12.* · Morning$/)
  })

  it('says a daily limit lasts until midnight', () => {
    const line = blockLine({ ...base, blocked: { id: 'b', kind: 'limit', reason: 'Daily limit of 1 h', start: at(0), end: new Date(2026, 10, 4).getTime() } }, at(15))
    expect(line).toBe('Blocked until midnight · Daily limit of 1 h')
  })

  it('shows the next block within a day, and nothing further off', () => {
    const next = { id: 'c', kind: 'bedtime' as const, reason: 'Bedtime', start: at(23, 30), end: at(23, 30) + 8 * 3600_000 }
    expect(blockLine({ ...base, next }, at(20))).toMatch(/^Next: Bedtime at .*11.*30/)
    expect(blockLine({ ...base, next: { ...next, start: next.start + 2 * 86400_000 } }, at(20))).toBe('')
  })

  it("says nothing while the blocker's off", () => {
    expect(blockLine({ ...base, on: false, blocked: { id: 'now', kind: 'now', reason: 'Block now', start: at(9), end: at(10) } }, at(9, 30))).toBe('')
  })

  it("shows Gentle's 5 more minutes", () => {
    const next = { id: 'a', kind: 'hours' as const, reason: 'Morning', start: at(10, 5), end: at(12) }
    expect(blockLine({ ...base, firmness: 'gentle', next, moreUntil: at(10, 5) }, at(10, 1))).toMatch(/^5 more minutes, until /)
  })
})

describe('minutes', () => {
  it('reads as hours and minutes', () => {
    expect(minutesLabel(45)).toBe('45 min')
    expect(minutesLabel(60)).toBe('1 h')
    expect(minutesLabel(90)).toBe('1 h 30 min')
  })
})
