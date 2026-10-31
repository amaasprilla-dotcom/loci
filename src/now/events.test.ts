process.env.TZ = 'Europe/Rome'

import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Task } from '../elements/registry'
import { db } from '../store/db'
import { eventsCsv, KEEP_DAYS, logEvent, noteShown, passedOver, pruneEvents, resetShown, startRate } from './events'
import type { Ranked } from './priority'

const MIN = 60_000
const DAY = 86_400_000
const NOW = new Date(2026, 9, 21, 10).getTime()

const rank = (key: string): Ranked => ({ key, type: 'todo', priority: 8, terms: { I: 2, U: 0.5, B: 0, N: 0, S: 0 }, why: '4 days late' })
const task = (key: string): Task => ({ locusId: 'bubble', elementId: 'e', itemId: key.split(':')[1], kind: 'todo', state: 'overdue', label: key, importance: 2, difficulty: 2, open: () => {}, rank: rank(key) })

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  resetShown()
})

describe('logEvent', () => {
  it('writes one row carrying the score and its terms', async () => {
    await logEvent('start', task('todo:a'), { rank: 2, now: NOW })
    const rows = await db.events.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ ts: NOW, type: 'start', key: 'todo:a', itemId: 'a', bubbleId: 'bubble', candidateType: 'todo', rank: 2, score: 8, terms: { I: 2, U: 0.5, B: 0, N: 0, S: 0 } })
  })

  it('pass, start and done each write one event', async () => {
    const t = task('todo:a')
    await logEvent('pass', t, { meta: { picked: 'todo:b' }, now: NOW })
    await logEvent('start', t, { now: NOW + 1 })
    await logEvent('done', t, { now: NOW + 2 })
    const rows = await db.events.orderBy('ts').toArray()
    expect(rows.map((r) => r.type)).toEqual(['pass', 'start', 'done'])
    expect(rows[0].meta).toEqual({ picked: 'todo:b' })
  })

  it('does nothing for a task that was not ranked', async () => {
    await logEvent('start', { ...task('todo:a'), rank: undefined }, { now: NOW })
    expect(await db.events.count()).toBe(0)
  })
})

describe('noteShown', () => {
  it('logs card_shown once per candidate per app open', async () => {
    await noteShown(task('todo:a'), NOW)
    await noteShown(task('todo:a'), NOW + MIN)
    await noteShown(task('todo:b'), NOW + 2 * MIN)
    expect((await db.events.toArray()).map((e) => [e.type, e.key])).toEqual([
      ['card_shown', 'todo:a'],
      ['card_shown', 'todo:b'],
    ])
    resetShown() // the app was left and came back
    await noteShown(task('todo:a'), NOW + 3 * MIN)
    expect(await db.events.count()).toBe(3)
  })
})

describe('pruneEvents', () => {
  it('drops rows older than 180 days and keeps the rest', async () => {
    await logEvent('start', task('todo:old'), { now: NOW - (KEEP_DAYS + 1) * DAY })
    await logEvent('start', task('todo:edge'), { now: NOW - (KEEP_DAYS - 1) * DAY })
    await pruneEvents(NOW)
    expect((await db.events.toArray()).map((e) => e.key)).toEqual(['todo:edge'])
  })
})

describe('passedOver', () => {
  it('lists the keys passed over within the window', async () => {
    await logEvent('pass', task('todo:a'), { now: NOW - 3 * 60 * MIN })
    await logEvent('pass', task('todo:b'), { now: NOW - 25 * 60 * MIN })
    await logEvent('start', task('todo:c'), { now: NOW - MIN })
    expect([...(await passedOver(NOW, DAY))]).toEqual(['todo:a'])
  })
})

describe('startRate', () => {
  it('counts cards started within 10 minutes of being shown, over all shown', async () => {
    await logEvent('card_shown', task('todo:a'), { now: NOW })
    await logEvent('start', task('todo:a'), { now: NOW + 9 * MIN }) // in time
    await logEvent('card_shown', task('todo:b'), { now: NOW })
    await logEvent('start', task('todo:b'), { now: NOW + 11 * MIN }) // too late
    await logEvent('card_shown', task('todo:c'), { now: NOW }) // never started
    await logEvent('start', task('todo:d'), { now: NOW + MIN }) // started, but never shown on the card
    expect(await startRate(NOW + DAY)).toEqual({ started: 1, shown: 3 })
  })

  it('only looks at the last 7 days', async () => {
    await logEvent('card_shown', task('todo:a'), { now: NOW - 8 * DAY })
    expect(await startRate(NOW)).toEqual({ started: 0, shown: 0 })
  })
})

describe('eventsCsv', () => {
  it('has a header and one line per event, quoting what needs it', async () => {
    await logEvent('alt_shown', task('todo:a'), { meta: { ids: ['todo:b', 'todo:c'] }, now: NOW })
    const lines = (await eventsCsv()).trim().split('\n')
    expect(lines[0]).toBe('time,type,key,candidate,rank,score,I,U,B,N,S,meta')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('alt_shown,todo:a,todo,1,8.000,2,0.500,0.000,0.000,0')
    expect(lines[1]).toContain('"{""ids"":[""todo:b"",""todo:c""]}"')
  })
})
