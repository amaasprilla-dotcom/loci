// New items per day, per deck or set, when something overrides the element's own
// limit. Test mode paces new material toward an exam here (SPEC-v2.md, "Test mode").

import type { LocusElement } from '../types'
import type { NewLimits } from './plan'

export async function newLimitsFor(_elements: LocusElement[], _now: number): Promise<NewLimits> {
  return new Map()
}
