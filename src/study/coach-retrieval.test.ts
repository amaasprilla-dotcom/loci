process.env.TZ = 'Europe/Rome' // fixed, so the daylight-saving test means the same everywhere
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import '../elements/all'
import { practising, recallDue, recordRecall, setRecall } from '../elements/notes/recall'
import { createNote, deleteNote, saveNote } from '../elements/notes/store'
import { createElement, createLocus, db } from '../store/db'
import { allTasks } from '../tasks/tasks'
import { acceptedAnswers, allowedTypos, checkAnswer, normalize, typeable, typedGrade } from './answer'
import { dayStarts, studiedDays, studyTimes } from './days'
import { buildSession, type StudyItem, studyPool, summarize } from './plan'

describe('checking a typed answer', () => {
  it('ignores case, accents, punctuation and spacing', () => {
    expect(normalize('  Él  está, ¡AQUÍ!  ')).toBe('el esta aqui')
    expect(checkAnswer('el esta aqui', 'Él está aquí.')).toBe(true)
    expect(checkAnswer('Paris', 'paris')).toBe(true)
  })

  it('allows more typos the longer the answer', () => {
    expect(allowedTypos(4)).toBe(0)
    expect(allowedTypos(10)).toBe(1)
    expect(allowedTypos(11)).toBe(2)
    expect(checkAnswer('cat', 'car')).toBe(false) // short: exact only
    expect(checkAnswer('photosyntesis', 'photosynthesis')).toBe(true)
    expect(checkAnswer('fotosintesys', 'photosynthesis')).toBe(false)
    expect(checkAnswer('mitocondria', 'mitochondria')).toBe(true)
  })

  it('accepts any one of several answers, but keeps a bare slash', () => {
    expect(acceptedAnswers('big; large / huge')).toEqual(['big large huge', 'big', 'large', 'huge'])
    expect(checkAnswer('large', 'big; large / huge')).toBe(true)
    expect(checkAnswer('km/h', 'km/h')).toBe(true)
    expect(checkAnswer('h', 'km/h')).toBe(false)
  })

  it('rejects an empty answer', () => {
    expect(checkAnswer('   ', 'anything')).toBe(false)
  })

  it('leaves long backs to flip', () => {
    expect(typeable('force')).toBe(true)
    expect(typeable('x'.repeat(81))).toBe(false)
    expect(typeable('…')).toBe(false)
  })

  it('rates wrong as Again, right as Good, and right and quick as Easy', () => {
    expect(typedGrade(false, 1000, [])).toBe(0)
    expect(typedGrade(true, 100, [5000, 5000])).toBe(2) // no median before 3
    expect(typedGrade(true, 2900, [5000, 5000, 5000])).toBe(3)
    expect(typedGrade(true, 20_000, [5000, 5000, 5000])).toBe(2) // slow is still Good
  })
})

describe('the spacing strip', () => {
  const now = new Date(2026, 9, 29, 10).getTime()

  it('has one day per dot, today last, each starting at 04:00', () => {
    const starts = dayStarts(now, 3)
    expect(starts.map((t) => new Date(t).getDate())).toEqual([27, 28, 29])
    expect(new Date(starts[0]).getHours()).toBe(4)
  })

  it('marks the days something was studied', () => {
    const t = (d: number, hour: number) => new Date(2026, 9, d, hour).getTime()
    // 02:00 on the 29th still belongs to the 28th's study day.
    expect(studiedDays([t(27, 12), t(29, 2), t(29, 9), t(1, 1)], now, 3)).toEqual([true, true, true])
    expect(studiedDays([t(27, 12)], now, 3)).toEqual([true, false, false])
    expect(studiedDays([t(29, 3)], now, 3)).toEqual([false, true, false])
  })

  it('keeps whole days across a daylight-saving change', () => {
    // Europe moved its clocks back on 25 Oct 2026; every dot is still one calendar day.
    const starts = dayStarts(now, 7)
    expect(starts.map((t) => new Date(t).getHours())).toEqual(Array(7).fill(4))
  })
})

describe('blank-page recall of notes', () => {
  beforeEach(() => Promise.all(db.tables.map((t) => t.clear())))
  const now = new Date(2026, 9, 29, 10).getTime()

  async function setup() {
    const locus = await createLocus({ name: 'Biology', color: '#000000', x: 0, y: 0 })
    const book = await createElement(locus.id, 'notes', 'Lectures', {})
    const note = await createNote(book.id)
    await saveNote(note.id, { title: 'Cell membranes', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Phospholipid bilayer' }] }] } })
    return { locus, book, note: (await db.notes.get(note.id))! }
  }

  it('joins the locus Study task only once turned on', async () => {
    const { book, note } = await setup()
    expect((await allTasks(now)).filter((t) => t.kind === 'review')).toHaveLength(0)
    await setRecall(note, true, now - 1000)
    const pool = await studyPool([book], now)
    expect(pool.items).toMatchObject([{ kind: 'note', id: note.id, estSeconds: 180 }])
    expect(summarize(pool)).toMatchObject({ cards: 0, problems: 0, notes: 1, seconds: 180 })
    const tasks = (await allTasks(now)).filter((t) => t.kind === 'review')
    expect(tasks.map((t) => t.label)).toEqual(['Study · 1 note'])
  })

  it('needs some text to recall', async () => {
    const { book } = await setup()
    const empty = await createNote(book.id)
    expect(practising(await setRecall(empty, true))).toBe(false)
    expect(await recallDue(book.id, now)).toHaveLength(0)
  })

  it('saves each attempt and the new schedule; off keeps the schedule', async () => {
    const { book, note } = await setup()
    const on = await setRecall(note, true, now - 1000)
    const later = { ...on.recall!.srs, due: now + 3 * 86_400_000, reps: 1, state: 2 as const }
    await recordRecall(on, later, 2, 'bilayer of lipids', 95_000, now)
    expect(await recallDue(book.id, now)).toHaveLength(0)
    expect(await db.recallAttempts.toArray()).toMatchObject([{ noteId: note.id, typed: 'bilayer of lipids', grade: 2, ms: 95_000 }])
    expect(await studyTimes([book], now - 86_400_000)).toEqual([now])

    const off = await setRecall((await db.notes.get(note.id))!, false)
    expect(off.recall).toMatchObject({ on: false, srs: { due: later.due } })
    expect(await recallDue(book.id, now + 4 * 86_400_000)).toHaveLength(0)
  })

  it('deleting the note deletes its recall history', async () => {
    const { note } = await setup()
    const on = await setRecall(note, true)
    await recordRecall(on, on.recall!.srs, 0, '', 1000, now)
    await deleteNote(note.id)
    expect(await db.recallAttempts.count()).toBe(0)
  })

  it('spreads notes between cards like problems, within the time budget', () => {
    const cards: StudyItem[] = Array.from({ length: 10 }, (_, i) => ({ kind: 'card', id: `c${i}`, elementId: 'deck', srs: { due: 0 } as never, isNew: false, estSeconds: 8, recall: 0.5 }))
    const notes: StudyItem[] = Array.from({ length: 2 }, (_, i) => ({ kind: 'note', id: `n${i}`, elementId: 'book', srs: { due: 0 } as never, isNew: false, estSeconds: 180, recall: 0.4 }))
    const session = buildSession([...cards, ...notes], 5 * 60)
    expect(session.reduce((s, i) => s + i.estSeconds, 0)).toBeLessThanOrEqual(300)
    expect(session[0].kind).toBe('card')
    expect(buildSession([...cards, ...notes], null).filter((i) => i.kind === 'note')).toHaveLength(2)
  })
})
