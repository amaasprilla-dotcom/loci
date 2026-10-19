// Element types are plug-ins behind one interface (SPEC.md, "Architecture").
// The home screen, the locus view and (later) the Tasks screen only talk to
// this interface; adding a type means writing one module and registering it here.

import type { LocusElement } from '../types'
import { flashcardsType } from './flashcards/type'

export interface Task {
  locusId: string
  elementId: string
  label: string // "12 cards due"
  count?: number
  dueAt: number // for sorting on the Tasks screen
  action(): void // e.g. start the review session
}

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
  renderScreen(el: LocusElement<TData>): Promise<HTMLElement>
  getTasks(el: LocusElement<TData>, now: number): Promise<Task[]>
  // A study session, at #/review/:elementId, for types that have one.
  renderSession?(el: LocusElement<TData>): Promise<HTMLElement>
}

export const registry = new Map<string, ElementType>()
registry.set(flashcardsType.type, flashcardsType)
