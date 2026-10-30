// Blank-page recall (SPEC-v3-coach.md, "Blank-page recall"): a note can be
// practised by writing down everything you remember of it, then comparing. Each
// such note carries an FSRS card and joins its locus's Study sessions.

import { db } from '../../store/db'
import type { Grade, Note, RecallAttempt, Srs } from '../../types'
import { newSrs } from '../flashcards/srs'

export const MAX_RECALL_MS = 15 * 60_000 // a session left open doesn't count as recall time

export const practising = (n: Note): boolean => n.recall?.on === true && n.plainText.trim() !== ''

// Turns recall practice on or off. Off keeps the schedule, so turning it on again picks up where it was.
export async function setRecall(note: Note, on: boolean, now = Date.now()): Promise<Note> {
  const recall = { on, srs: note.recall?.srs ?? newSrs(now) }
  await db.notes.update(note.id, { recall, updatedAt: now })
  return { ...note, recall, updatedAt: now }
}

// The notebook's notes being practised, due now or never yet recalled.
export async function recallDue(elementId: string, now: number): Promise<Note[]> {
  const notes = await db.notes.where('elementId').equals(elementId).toArray()
  return notes.filter((n) => practising(n) && n.recall!.srs.due <= now).sort((a, b) => a.recall!.srs.due - b.recall!.srs.due)
}

// Saves an attempt and the note's new schedule together.
export async function recordRecall(note: Note, srs: Srs, grade: Grade, typed: string, ms: number, now: number): Promise<Note> {
  const after: Note = { ...note, recall: { on: true, srs } }
  const attempt: RecallAttempt = { id: crypto.randomUUID(), noteId: note.id, at: now, typed, grade, ms: Math.min(ms, MAX_RECALL_MS), updatedAt: now }
  await db.transaction('rw', db.notes, db.recallAttempts, async () => {
    // Only the schedule changes: the note's text and updatedAt are the editor's.
    await db.notes.update(note.id, { recall: after.recall })
    await db.recallAttempts.add(attempt)
  })
  return after
}
