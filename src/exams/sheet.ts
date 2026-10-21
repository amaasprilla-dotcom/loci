// Adding or editing an exam: its date, the recall it aims for, what it covers,
// and (once there) how ready you are and how fast new material comes.

import { announceChange } from '../changes'
import { h } from '../dom'
import { count, formatNumber, parseNumber } from '../locale'
import { button, deleteConfirmation, openSheet, sheetActions, submitButton } from '../sheet'
import { db } from '../store/db'
import { countdown, DEFAULT_TARGET, deleteExam, examDate, examProgress, hasExplicitScope, saveExam, scopeOf, STUDIED_TYPES } from './exams'

const TARGETS = [0.8, 0.85, 0.9, 0.95]

function dateValue(input: HTMLInputElement): number | null {
  if (!input.value) return null
  const [y, m, d] = input.value.split('-').map(Number)
  return examDate(new Date(y, m - 1, d))
}

// Resolves true if anything changed.
export async function openExamSheet(locusId: string, examId: string | null): Promise<boolean> {
  const exam = examId ? await db.exams.get(examId) : undefined
  const now = Date.now()
  const elements = (await db.elements.where('locusId').equals(locusId).toArray()).filter((e) => STUDIED_TYPES.includes(e.type)).sort((a, b) => a.order - b.order)
  const explicit = exam ? await hasExplicitScope(exam) : false
  const inScope = new Set((exam ? await scopeOf(exam) : elements).map((e) => e.id))
  const progress = exam ? await examProgress(exam, now) : null
  const color = (await db.loci.get(locusId))?.color ?? '#0b0f14'

  const result = await openSheet<boolean>(exam ? 'Exam' : 'New exam', (api) => {
    const title = h('input', { class: 'input', type: 'text', maxlength: 80, placeholder: 'e.g. Physics midterm', 'aria-label': 'Exam' })
    title.value = exam?.title ?? ''
    const date = h('input', { class: 'input', type: 'date', 'aria-label': 'Date' })
    if (exam) {
      const d = new Date(exam.date)
      date.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }
    let target = exam?.targetRecall ?? DEFAULT_TARGET
    const targets = TARGETS.map((t) =>
      h(
        'button',
        {
          type: 'button',
          class: 'segment',
          role: 'radio',
          'aria-checked': String(Math.abs(t - target) < 1e-9),
          onclick: () => {
            target = t
            targets.forEach((b, i) => b.setAttribute('aria-checked', String(TARGETS[i] === t)))
          },
        },
        formatNumber(t, { style: 'percent' }),
      ),
    )

    // What it covers: everything in the locus, or some decks and sets.
    const everything = h('input', { type: 'checkbox', ...(!explicit && { checked: true }) })
    const boxes = elements.map((el) => {
      const box = h('input', { type: 'checkbox', value: el.id, ...(inScope.has(el.id) && { checked: true }) })
      return { el, box, row: h('label', { class: 'checklist-item' }, box, h('span', {}, el.title)) }
    })
    const syncScope = () => {
      for (const b of boxes) {
        b.box.disabled = everything.checked
        if (everything.checked) b.box.checked = true
      }
    }
    everything.addEventListener('change', syncScope)
    syncScope()

    const pace = h('input', { class: 'input every', type: 'number', min: 0, step: 1, inputmode: 'numeric', 'aria-label': 'New items a day' })
    if (exam?.newPerDay != null && progress && exam.newPerDay < progress.suggestedPace) pace.value = String(exam.newPerDay)
    if (progress) pace.placeholder = String(progress.suggestedPace)

    const error = h('p', { class: 'sheet-error', role: 'alert' })
    const form = [
      h('h2', {}, exam ? exam.title : 'New exam'),
      progress &&
        h(
          'div',
          { class: 'exam-progress', style: { '--c': color } },
          h('div', { class: 'goal-card-head' }, h('span', { class: 'goal-big' }, progress.readiness == null ? '–' : formatNumber(progress.readiness, { style: 'percent', maximumFractionDigits: 0 })), h('span', { class: 'goal-meta' }, countdown(exam!, now))),
          h('span', { class: 'progress' }, h('span', { class: 'progress-fill', style: { width: `${Math.round((progress.readiness ?? 0) * 100)}%` } })),
          h('p', { class: 'goal-meta' }, 'Ready: the recall predicted for exam day, across everything it covers (unseen items count as 0).'),
        ),
      h('label', { class: 'field-label' }, 'Exam', title),
      h('label', { class: 'field-label' }, 'Date', date),
      h('div', { class: 'field-label' }, 'Aim for', h('div', { class: 'segments', role: 'radiogroup', 'aria-label': 'Target recall' }, targets), h('span', { class: 'field-hint' }, 'The chance of remembering each item on the day. Reviews are brought forward to keep it there.')),
      h(
        'div',
        { class: 'field-label' },
        'Covers',
        elements.length === 0
          ? h('span', { class: 'field-hint' }, 'Add a flashcard deck or a problem set to this locus to study for it.')
          : h('div', { class: 'checklist' }, h('label', { class: 'checklist-item' }, everything, h('span', {}, 'Everything in this locus')), ...boxes.map((b) => b.row)),
      ),
      progress &&
        progress.unseen > 0 &&
        h(
          'div',
          { class: 'field-label' },
          'New material',
          h('span', { class: 'field-hint' }, `${count(progress.unseen, 'item hasn’t', 'items haven’t')} been studied yet. To see them all before the last two days: ${count(progress.suggestedPace, 'new item', 'new items')} a day. You can lower it.`),
          h('div', { class: 'every-row' }, pace, h('span', {}, 'a day')),
        ),
      error,
      sheetActions(
        !!exam &&
          button(
            'Delete',
            () =>
              api.show(
                ...deleteConfirmation(`Delete “${exam.title}”?`, 'Your cards and problems stay; they just stop working toward it.', () => api.show(...form), async () => {
                  await deleteExam(exam.id)
                  api.close(true)
                }),
              ),
            'danger-text',
          ),
        button('Cancel', () => api.close(null)),
        submitButton(exam ? 'Save' : 'Add exam'),
      ),
    ].filter((x): x is HTMLElement => x != null && x !== false)

    return {
      content: form,
      focus: exam ? undefined : title,
      onSubmit: async () => {
        const at = dateValue(date)
        if (!title.value.trim()) return void (error.textContent = 'Name the exam.')
        if (at == null) return void (error.textContent = 'Pick its date.')
        const scope = everything.checked ? null : boxes.filter((b) => b.box.checked).map((b) => b.el.id)
        if (scope && scope.length === 0) return void (error.textContent = 'Choose what it covers.')
        const lowered = pace.value.trim() ? parseNumber(pace.value) : null
        await saveExam(locusId, { title: title.value, date: at, targetRecall: target, ...(lowered != null && lowered >= 0 && { newPerDay: Math.round(lowered) }), scope }, exam?.id)
        api.close(true)
      },
    }
  })
  if (result) announceChange()
  return Boolean(result)
}
