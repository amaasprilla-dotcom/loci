import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import '../elements/all'
import { DAY, dueAfterDays, newSrs, recall, review } from '../elements/flashcards/srs'
import { addCards, DEFAULT_FLASHCARDS_DATA, listCards } from '../elements/flashcards/store'
import { exportBackup, importBackup } from '../store/backup'
import { createElement, createLocus, db, deleteElement, deleteLocus } from '../store/db'
import { nextState } from '../study/schedule'
import { studyPool } from '../study/plan'
import { allTasks, sectionOf } from '../tasks/tasks'
import type { Srs } from '../types'
import { capForExam, daysLeft, examAdjustments, examDate, examProgress, inFinalPass, isUpcoming, pace, saveExam, scopeOf } from './exams'

const now = new Date(2026, 9, 21, 10).getTime() // Wednesday 21 Oct 2026, 10:00
const inDays = (n: number) => examDate(new Date(now + n * DAY))

// A card reviewed well a few times: long intervals ahead.
function strongCard(): Srs {
  let s = newSrs(now - 60 * DAY)
  for (const at of [-60, -59, -55, -45, -20]) s = review(s, 2, now + at * DAY)
  return s
}

describe('the rules on one item', () => {
  it('caps the next review so recall on exam day stays at target', () => {
    const exam = { date: inDays(10), targetRecall: 0.97 }
    // Just reviewed, stable for about 20 days: by exam day recall has dropped under 97%.
    const after: Srs = { due: dueAfterDays(now, 20), stability: 20, difficulty: 5, elapsed_days: 0, scheduled_days: 20, learning_steps: 0, reps: 4, lapses: 0, state: 2, last_review: now }
    expect(recall(after, exam.date)).toBeLessThan(0.97)
    expect(after.due).toBeGreaterThan(exam.date) // FSRS alone would skip the exam
    const capped = capForExam(after, exam, now)
    expect(capped.due).toBeLessThan(exam.date)
    expect(capped.due).toBeGreaterThanOrEqual(dueAfterDays(now, 1)) // at least tomorrow
    expect(recall(capped, capped.due)).toBeGreaterThanOrEqual(0.97) // still at target on the day it's due
    // …and it's the last such day: one day later, recall would be under target (or it's exam day).
    const dayAfter = capped.due + DAY
    expect(dayAfter >= exam.date || recall(capped, dayAfter) < 0.97).toBe(true)
  })

  it('leaves alone what is reviewed again before the final days, or already strong enough', () => {
    const exam = { date: inDays(60), targetRecall: 0.9 }
    const soon = { ...review(newSrs(now), 2, now) } // due within days
    expect(capForExam(soon, exam, now)).toEqual(soon)
    const lowTarget = { date: inDays(10), targetRecall: 0.5 }
    const after = review(strongCard(), 2, now)
    expect(capForExam(after, lowTarget, now)).toEqual(after)
  })

  it('in the last 2 days, anything under target on exam day is due', () => {
    const s = strongCard()
    expect(inFinalPass(s, { date: inDays(2), targetRecall: 0.99 }, now)).toBe(true)
    expect(inFinalPass(s, { date: inDays(3), targetRecall: 0.99 }, now)).toBe(false) // not the final days yet
    expect(inFinalPass(s, { date: inDays(2), targetRecall: 0.1 }, now)).toBe(false) // strong enough
    expect(inFinalPass(newSrs(now), { date: inDays(1), targetRecall: 0.99 }, now)).toBe(false) // never seen: that's pacing
  })

  it('paces new material to be seen before the final days', () => {
    expect(pace(30, 12)).toBe(3) // 30 ÷ (12 − 2)
    expect(pace(31, 12)).toBe(4)
    expect(pace(5, 2)).toBe(5) // no days left: all now
    expect(pace(0, 10)).toBe(0)
  })
})

describe('an exam in a locus', () => {
  beforeEach(() => Promise.all(db.tables.map((t) => t.clear())))

  async function setup(examInDays = 12) {
    const locus = await createLocus({ name: 'Spanish', color: '#000000', x: 0, y: 0 })
    const verbs = await createElement(locus.id, 'flashcards', 'Verbs', { ...DEFAULT_FLASHCARDS_DATA, newPerDay: 1 })
    const nouns = await createElement(locus.id, 'flashcards', 'Nouns', { ...DEFAULT_FLASHCARDS_DATA })
    await addCards(verbs.id, Array.from({ length: 30 }, (_, i) => ({ front: `v${i}`, back: `${i}` })))
    await addCards(nouns.id, [{ front: 'casa', back: 'house' }])
    const [n] = await listCards(nouns.id)
    await db.cards.put({ ...n, srs: strongCard() })
    const exam = await saveExam(locus.id, { title: 'Final', date: inDays(examInDays), targetRecall: 0.9, scope: null })
    return { locus, verbs, nouns, exam }
  }

  it('covers everything in the locus by default, or what is linked', async () => {
    const { locus, verbs, exam } = await setup()
    expect((await scopeOf(exam)).map((e) => e.title).sort()).toEqual(['Nouns', 'Verbs'])
    const narrowed = await saveExam(locus.id, { title: 'Final', date: exam.date, targetRecall: 0.9, scope: [verbs.id] }, exam.id)
    expect((await scopeOf(narrowed)).map((e) => e.title)).toEqual(['Verbs'])
    // Deleting the deck takes the scope link with it, back to "everything".
    await deleteElement(verbs.id)
    expect((await scopeOf(narrowed)).map((e) => e.title)).toEqual(['Nouns'])
  })

  it('reports readiness, unseen items and the pace for them', async () => {
    const { exam } = await setup(12)
    const p = await examProgress(exam, now)
    expect(p.unseen).toBe(30)
    expect(p.suggestedPace).toBe(3)
    const strong = recall(strongCard(), exam.date)
    expect(p.readiness).toBeCloseTo(strong / 31, 6) // unseen count as 0
  })

  it('raises a deck’s new-per-day to the exam’s pace, and the user can lower it', async () => {
    const { locus, verbs, exam } = await setup(12)
    expect((await examAdjustments([verbs], now)).newLimits.get(verbs.id)).toBe(3)
    expect((await studyPool([verbs], now, await examAdjustments([verbs], now))).items).toHaveLength(3)
    await saveExam(locus.id, { title: 'Final', date: exam.date, targetRecall: 0.9, newPerDay: 2, scope: null }, exam.id)
    expect((await examAdjustments([verbs], now)).newLimits.get(verbs.id)).toBe(2)
  })

  it('in the final days, brings in reviews that are not due but under target', async () => {
    const { nouns } = await setup(2)
    const adj = await examAdjustments([nouns], now)
    expect(adj.finalPass.get(nouns.id)).toBeDefined()
    const [card] = await listCards(nouns.id)
    expect(card.srs.due).toBeGreaterThan(now)
    const withTarget = { ...adj, finalPass: new Map([[nouns.id, { date: inDays(2), targetRecall: 0.999 }]]) }
    expect((await studyPool([nouns], now, withTarget)).items.map((i) => i.id)).toEqual([card.id])
  })

  it('caps reviews of items in scope, whatever reviews them', async () => {
    const { nouns, locus } = await setup(10)
    await saveExam(locus.id, { title: 'Final', date: inDays(10), targetRecall: 0.999, scope: null }, (await db.exams.toArray())[0].id)
    const [card] = await listCards(nouns.id)
    const capped = await nextState({ type: 'card', id: card.id, elementId: nouns.id }, card.srs, 2, now, 0.9)
    expect(capped.due).toBeLessThan(inDays(10))
  })

  it('shows under Goals and exams, then is done once its day has passed', async () => {
    const { exam } = await setup(3)
    const task = (await allTasks(now)).find((t) => t.kind === 'exam')!
    expect(sectionOf(task)).toBe('goals')
    expect(task).toMatchObject({ label: 'Final', state: 'info' })
    expect(task.sublabel).toMatch(/^In 3 days · \d+% ready · 30 new items a day$/) // 30 unseen, final days next
    expect(daysLeft(exam, now)).toBe(3)

    const after = examDate(new Date(now + 4 * DAY))
    expect(isUpcoming(exam, inDays(3) + 14 * 3600_000)).toBe(true) // the evening of the day: still on
    expect((await allTasks(after)).some((t) => t.kind === 'exam')).toBe(false)
    expect((await db.exams.get(exam.id))!.status).toBe('done')
    // Caps lift: nothing is adjusted any more.
    const nouns = (await db.elements.toArray()).find((e) => e.title === 'Nouns')!
    expect((await examAdjustments([nouns], after)).finalPass.size).toBe(0)
  })

  it('goes with its locus, and survives a backup', async () => {
    const { locus, exam } = await setup()
    const backup = await exportBackup()
    expect(backup.exams).toHaveLength(1)
    await deleteLocus(locus.id)
    expect(await db.exams.count()).toBe(0)
    expect(await db.links.count()).toBe(0)
    await importBackup(backup, 'replace')
    expect(await db.exams.get(exam.id)).toMatchObject({ title: 'Final' })
  })
})
