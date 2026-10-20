// Importance and difficulty: four steps each (SPEC-v2.md, "Task model v2").
// A compact segmented picker, used wherever something gets a priority.

import { h } from './dom'
import type { Level } from './types'

// A locus's study task (its due reviews) ranks High importance, Medium difficulty unless changed.
export const DEFAULT_STUDY_IMPORTANCE = 3
export const DEFAULT_STUDY_DIFFICULTY = 2

export const IMPORTANCE_LABELS = ['Low', 'Medium', 'High', 'Critical'] as const
export const DIFFICULTY_LABELS = ['Easy', 'Medium', 'Hard', 'Very hard'] as const

export function levelName(kind: 'importance' | 'difficulty', level: Level): string {
  return (kind === 'importance' ? IMPORTANCE_LABELS : DIFFICULTY_LABELS)[level - 1]
}

export interface LevelPicker {
  el: HTMLElement
  value(): Level
}

export function levelPicker(kind: 'importance' | 'difficulty', initial: Level): LevelPicker {
  let current = initial
  const labels = kind === 'importance' ? IMPORTANCE_LABELS : DIFFICULTY_LABELS
  const buttons = labels.map((label, i) =>
    h(
      'button',
      {
        type: 'button',
        class: 'segment',
        role: 'radio',
        'aria-checked': String(i + 1 === current),
        onclick: () => {
          current = (i + 1) as Level
          buttons.forEach((b, j) => b.setAttribute('aria-checked', String(j + 1 === current)))
        },
      },
      label,
    ),
  )
  const el = h('div', { class: 'segments', role: 'radiogroup', 'aria-label': kind === 'importance' ? 'Importance' : 'Difficulty' }, buttons)
  return { el, value: () => current }
}
