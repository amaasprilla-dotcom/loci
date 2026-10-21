// Study tasks (SPEC-v2.md, "Study sessions"): one per locus, "Study · 14 cards,
// 6 problems · ~12 min", unless the setting splits it into one per deck or set.

import type { Task } from '../elements/registry'
import { studyDayStart } from '../elements/flashcards/srs'
import { DEFAULT_STUDY_DIFFICULTY, DEFAULT_STUDY_IMPORTANCE } from '../levels'
import { go, reviewHash, studyHash } from '../router'
import { db } from '../store/db'
import type { LocusElement } from '../types'
import { studyAdjustments } from './limits'
import { studyPool, summarize } from './plan'
import { minutesText, studyCounts } from './text'

export const STUDY_TASKS_KEY = 'studyTasks' // 'locus' (default) or 'element'

export async function splitStudyTasks(): Promise<boolean> {
  return (await db.settings.get(STUDY_TASKS_KEY))?.value === 'element'
}

export async function setSplitStudyTasks(split: boolean): Promise<void> {
  await db.settings.put({ key: STUDY_TASKS_KEY, value: split ? 'element' : 'locus', updatedAt: Date.now() })
}

const overdueSince = (at: number) => `Waiting since ${new Date(at).toLocaleDateString(undefined, { weekday: 'long' })}`

// A deck's or set's own study task: what's due in it now. Overdue once a review
// has waited past a 04:00 rollover.
export async function elementStudyTask(el: LocusElement, now: number): Promise<Task[]> {
  const s = summarize(await studyPool([el], now, await studyAdjustments([el], now)))
  if (s.cards + s.problems === 0) return []
  const locus = await db.loci.get(el.locusId)
  const overdue = s.oldestDue != null && s.oldestDue < studyDayStart(now)
  return [
    {
      locusId: el.locusId,
      elementId: el.id,
      kind: 'review',
      state: overdue ? 'overdue' : 'due',
      label: `${studyCounts(s.cards, s.problems)} due`,
      sublabel: [overdue && overdueSince(s.oldestDue!), minutesText(s.seconds)].filter(Boolean).join(' · '),
      importance: locus?.studyImportance ?? DEFAULT_STUDY_IMPORTANCE,
      difficulty: locus?.studyDifficulty ?? DEFAULT_STUDY_DIFFICULTY,
      dueAt: s.oldestDue ?? now,
      open: () => go(reviewHash(el)),
      study: { cards: s.cards, problems: s.problems, seconds: s.seconds },
    },
  ]
}

// The decks' and sets' study tasks of each locus as one: "Study · 14 cards, 6 problems".
export function mergeStudyTasks(tasks: Task[]): Task[] {
  const byLocus = new Map<string, Task[]>()
  const rest: Task[] = []
  for (const t of tasks) {
    if (t.kind === 'review' && t.study) byLocus.set(t.locusId, [...(byLocus.get(t.locusId) ?? []), t])
    else rest.push(t)
  }
  for (const [locusId, list] of byLocus) {
    const cards = list.reduce((n, t) => n + t.study!.cards, 0)
    const problems = list.reduce((n, t) => n + t.study!.problems, 0)
    const seconds = list.reduce((n, t) => n + t.study!.seconds, 0)
    const overdue = list.filter((t) => t.state === 'overdue')
    const dueAt = Math.min(...list.map((t) => t.dueAt ?? Infinity))
    rest.push({
      locusId,
      elementId: '',
      kind: 'review',
      state: overdue.length ? 'overdue' : 'due',
      label: `Study · ${studyCounts(cards, problems)}`,
      sublabel: [overdue.length > 0 && overdueSince(dueAt), minutesText(seconds)].filter(Boolean).join(' · '),
      importance: list[0].importance,
      difficulty: list[0].difficulty,
      dueAt,
      open: () => go(studyHash(locusId)),
      study: { cards, problems, seconds },
    })
  }
  return rest
}
