// A to-do's work block (SPEC-v8-experimental.md, "Work blocks"), in words. Kept apart from
// the field that edits it, so reminders can use it without pulling in the Wellbeing screen.

import { inAndroidApp } from '../../android'
import type { Todo } from '../../types'

export type Block = NonNullable<Todo['block']>

export const BLOCK_LENGTHS = [25, 45, 60, 90, 120]

// "90 min block · distractions blocked"
export function blockText(block: Block | undefined): string {
  if (!block) return ''
  return [`${block.minutes} min block`, block.noDistractions && inAndroidApp && 'distractions blocked'].filter(Boolean).join(' · ')
}
