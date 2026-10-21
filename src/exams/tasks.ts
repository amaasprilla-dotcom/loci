// Exams on the Tasks screen and in their locus: under "Goals and exams", with a
// countdown and readiness, never red. Their study load comes through the
// locus's Study task (SPEC-v2.md, "Test mode", Display).

import type { Task } from '../elements/registry'
import { count, formatNumber } from '../locale'
import { db } from '../store/db'
import { countdown, examProgress, settle } from './exams'

export async function examTasks(now: number): Promise<Task[]> {
  const tasks: Task[] = []
  for (const exam of await db.exams.toArray()) {
    if (!(await settle(exam, now))) continue
    const p = await examProgress(exam, now)
    tasks.push({
      locusId: exam.locusId,
      elementId: '',
      itemId: exam.id,
      kind: 'exam',
      state: 'info',
      label: exam.title,
      sublabel: [
        countdown(exam, now),
        p.readiness != null && `${formatNumber(p.readiness, { style: 'percent', maximumFractionDigits: 0 })} ready`,
        p.pacePerDay > 0 && `${count(p.pacePerDay, 'new item', 'new items')} a day`,
      ]
        .filter(Boolean)
        .join(' · '),
      importance: 3,
      difficulty: 2,
      dueAt: exam.date,
      progress: p.readiness ?? 0,
      open: () => void import('./sheet').then((m) => m.openExamSheet(exam.locusId, exam.id)),
    })
  }
  return tasks
}
