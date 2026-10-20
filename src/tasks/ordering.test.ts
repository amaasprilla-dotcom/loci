import { describe, expect, it } from 'vitest'
import type { Task } from '../elements/registry'
import type { Level } from '../types'
import { compareActive, score, sectionOf, sections } from './tasks'

function task(label: string, o: Partial<Task> = {}): Task {
  return { locusId: 'l', elementId: 'e', kind: 'todo', state: 'due', label, importance: 2, difficulty: 2, open: () => {}, ...o }
}
const p = (importance: Level, difficulty: Level) => ({ importance, difficulty })

describe('score (SPEC-v2.md, "Ordering")', () => {
  it('is 3 × importance − difficulty', () => {
    expect(score(task('x', p(3, 1)))).toBe(8) // High / Easy
    expect(score(task('x', p(4, 4)))).toBe(8) // Critical / Very hard
  })

  it('one step of importance beats up to two steps of difficulty', () => {
    const highHard = task('High/Hard', p(3, 3)) // 6
    const mediumEasy = task('Medium/Easy', p(2, 1)) // 5
    expect([mediumEasy, highHard].sort(compareActive).map((t) => t.label)).toEqual(['High/Hard', 'Medium/Easy'])
  })

  it('a tie goes to the overdue task, then the earlier one', () => {
    const a = task('High/Easy, due', { ...p(3, 1), state: 'due', dueAt: 100 })
    const b = task('Critical/Very hard, overdue', { ...p(4, 4), state: 'overdue', dueAt: 500 })
    const c = task('High/Easy, due earlier', { ...p(3, 1), state: 'due', dueAt: 50 })
    expect([a, b, c].sort(compareActive).map((t) => t.label)).toEqual([
      'Critical/Very hard, overdue',
      'High/Easy, due earlier',
      'High/Easy, due',
    ])
  })
})

describe('sections', () => {
  it('puts each task where SPEC-v2.md says', () => {
    expect(sectionOf(task('x', { state: 'overdue' }))).toBe('now')
    expect(sectionOf(task('x', { state: 'due' }))).toBe('now')
    expect(sectionOf(task('x', { state: 'upcoming' }))).toBe('planned')
    expect(sectionOf(task('x', { state: 'waiting' }))).toBe('planned')
    expect(sectionOf(task('x', { state: 'someday' }))).toBe('someday')
    expect(sectionOf(task('x', { kind: 'goal', state: 'info' }))).toBe('goals')
    expect(sectionOf(task('x', { kind: 'goal', state: 'due' }))).toBe('goals') // goals never go to Now
    expect(sectionOf(task('x', { kind: 'checkin', state: 'due' }))).toBe('now') // their check-ins do
    expect(sectionOf(task('x', { state: 'info' }))).toBeNull() // done: not listed
  })

  it('Now is by score; Planned and Someday by date', () => {
    const s = sections([
      task('later', { state: 'upcoming', dueAt: 300 }),
      task('low', { ...p(1, 1), state: 'due' }),
      task('sooner', { state: 'upcoming', dueAt: 100 }),
      task('high', { ...p(4, 1), state: 'due' }),
      task('someday', { state: 'someday' }),
    ])
    expect(s.now.map((t) => t.label)).toEqual(['high', 'low'])
    expect(s.planned.map((t) => t.label)).toEqual(['sooner', 'later'])
    expect(s.someday.map((t) => t.label)).toEqual(['someday'])
  })
})
