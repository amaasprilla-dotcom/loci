// Element types are plug-ins behind one interface (SPEC.md, "Architecture").
// The home screen, the locus view and the Tasks screen only talk to
// this interface; adding a type means writing one module and registering it in all.ts.
// (This file imports no element type itself, so element modules can use it freely.)

import type { Level, LocusElement } from '../types'

// Task model v2 (SPEC-v2.md, "Task model v2"): what an element asks of you.
// Screens split active from inactive by `state` without knowing element internals.
export interface Task {
  locusId: string
  elementId: string
  itemId?: string // the to-do / goal / template inside the element
  kind: 'review' | 'todo' | 'checkin' | 'goal' | 'exam'
  state: 'overdue' | 'due' | 'upcoming' | 'waiting' | 'someday' | 'info'
  label: string // "Gather receipts", "14 cards due"
  sublabel?: string // "Sunday 10:00", "23 days left"
  importance: Level
  difficulty: Level
  dueAt?: number
  progress?: number // goals, 0..1
  open(): void // tap
  complete?(): Promise<void> // tick, where it makes sense
  secondary?: { label: string; run(): Promise<void> } // e.g. "It happened" on a waiting to-do
  study?: { cards: number; problems: number; seconds: number } // a Study task: what's due, and about how long
}

// Active tasks are the ones that need doing now: they pulse the bubble and fill "Now".
export const isActive = (t: Task): boolean => t.state === 'overdue' || t.state === 'due'

export interface ElementType<TData = unknown> {
  type: string // "flashcards"
  label: string // shown in the + menu
  noun: string // one of them, for "New flashcard deck"
  description: string // one line under the label in the + menu
  icon: string // inline SVG markup, drawn in currentColor
  createDefault(): TData
  // The tile inside the locus view.
  renderCard(el: LocusElement<TData>, now: number): Promise<HTMLElement>
  // The element's own full screen, at #/locus/:locusId/el/:elementId.
  // (The spec's open(el) is just navigating there; see elementHash in router.ts.)
  // `sub` is the rest of the address, for screens inside the element (e.g. ['note', id]).
  renderScreen(el: LocusElement<TData>, sub: string[]): Promise<HTMLElement>
  getTasks(el: LocusElement<TData>, now: number): Promise<Task[]>
  // When work next falls due (after `now`), for "Nothing due. Next: … in 3h."
  nextDueAt?(el: LocusElement<TData>, now: number): Promise<number | null>
  // A study session, at #/review/:elementId, for types that have one.
  renderSession?(el: LocusElement<TData>): Promise<HTMLElement>
}

export const registry = new Map<string, ElementType>()
