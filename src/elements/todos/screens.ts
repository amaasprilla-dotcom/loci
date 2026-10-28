// The to-do list screen (SPEC-v2.md, "To-dos"): a sentence-builder to add to-dos
// ("[When] · [action]"), the list in Now / Planned / Someday / Done, and the
// sheets to pick a when and to edit a to-do.

import { type Options, RRule } from 'rrule'
import { attachmentStrip } from '../../attachmentStrip'
import { textColorOn } from '../../colors'
import { h } from '../../dom'
import { backIcon } from '../../icons'
import { levelPicker } from '../../levels'
import { linkedItemsSection } from '../../linkedItems'
import { count, firstDayOfWeek, formatNumber } from '../../locale'
import { back, elementHash } from '../../router'
import { button, deleteConfirmation, openSheet, type SheetApi, sheetActions, submitButton } from '../../sheet'
import { deleteAttachmentsOf, db } from '../../store/db'
import { sections } from '../../tasks/tasks'
import { taskRow } from '../../tasks/view'
import type { Level, LocusElement, Todo, When } from '../../types'
import { openGoals } from '../goals/type'
import { archiveTodo, completeTodo, countDependents, createTodo, deleteTodo, goalsCountingTodo, itHappened, listTodos, reopenTodo, skipTodo, type TodoDraft, updateTodo, type WaitsFor, waitsForOf } from './store'
import { todoTask } from './type'
import { rememberTime, timeField } from './timeField'
import { dayStartOf, formatDay, makeRepeat, parseTyped, repeatText, whenText } from './when'

const DAY = 86_400_000
const DEFAULT_IMPORTANCE: Level = 2
const DEFAULT_DIFFICULTY: Level = 2

export async function renderTodoList(el: LocusElement, openId?: string): Promise<HTMLElement> {
  const locus = await db.loci.get(el.locusId)
  const color = locus?.color ?? '#0b0f14'
  const lists = h('div', { class: 'todo-sections' })

  async function render() {
    const now = Date.now()
    const todos = await listTodos(el.id)
    const open = todos.filter((t) => t.status === 'open')
    const titles = new Map<string, string>()
    for (const t of open) {
      const other = await waitsForTitle(await waitsForOf(t.id))
      if (other) titles.set(t.id, other)
    }
    // Here, tapping a to-do opens its sheet in place (no new address to go back through).
    const s = sections(
      open.map((t) => ({
        ...todoTask(el, t, now, titles.get(t.id)),
        open: async () => {
          await openTodoSheet(t)
          await render()
        },
      })),
    )
    const row = (t: (typeof s.now)[number]) =>
      taskRow(t, locus!, el.title, async () => {
        await t.complete?.()
        await render()
      }, { showLocus: false, onSecondary: render })
    const done = todos.filter((t) => t.status === 'done').sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0)).slice(0, 30)

    lists.replaceChildren(
      ...[
        section('Now', s.now.length > 0 ? s.now.map(row) : [h('p', { class: 'list-empty' }, open.length === 0 ? 'Nothing to do yet. Add a plan above.' : 'Nothing due now.')]),
        s.planned.length > 0 && section('Planned', s.planned.map(row), 'muted'),
        s.someday.length > 0 && collapsible(`Someday (${formatNumber(s.someday.length)})`, s.someday.map(row)),
        done.length > 0 &&
          collapsible(
            `Done (${formatNumber(done.length)})`,
            done.map((t) =>
              h(
                'div',
                { class: 'task-row done-row' },
                h('span', { class: 'task-main' }, h('span', { class: 'task-text' }, h('span', { class: 'task-title' }, t.title), h('span', { class: 'task-details' }, t.doneAt ? `Done ${inSentence(formatDay(t.doneAt, now))}` : 'Done'))),
                h('button', { type: 'button', class: 'btn btn-small task-secondary', onclick: async () => { await reopenTodo(t.id); await render() } }, 'Undo'),
              ),
            ),
          ),
      ].filter((x): x is HTMLElement => x !== false),
    )
  }

  const addForm = createAddForm(el, render)
  const screen = h(
    'div',
    { class: 'deck-screen', style: { '--c': color, '--fg': textColorOn(color) } },
    h(
      'header',
      { class: 'locus-header' },
      h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: () => back(`#/locus/${encodeURIComponent(el.locusId)}`) }, backIcon()),
      h('div', { class: 'locus-title' }, h('span', { class: 'header-kicker' }, locus?.name ?? ''), h('h1', {}, el.title)),
    ),
    h('main', { class: 'locus-body' }, addForm, lists),
  )
  await render()

  if (openId) {
    // Opened at #/…/todo/<id> (from the Tasks screen, a locus, or a link): show that
    // to-do's sheet over its list; closing it goes back to where you came from.
    const todo = await db.todos.get(openId)
    if (todo && todo.elementId === el.id) {
      setTimeout(async () => {
        await openTodoSheet(todo)
        back(elementHash(el))
      }, 0)
    }
  }
  return screen
}

// "Today" reads "today" mid-sentence; weekday and month names keep their capitals.
function inSentence(day: string): string {
  return ['Today', 'Tomorrow', 'Yesterday'].includes(day) ? day.toLowerCase() : day
}

function section(title: string, rows: HTMLElement[], extra = ''): HTMLElement {
  return h('section', { class: `task-section ${extra}` }, h('h2', { class: 'task-section-title' }, title), h('div', { class: 'task-list' }, rows))
}

function collapsible(title: string, rows: HTMLElement[]): HTMLElement {
  return h('details', { class: 'task-section muted' }, h('summary', { class: 'task-section-title' }, title), h('div', { class: 'task-list' }, rows))
}

// ---------- Adding: "[When] · [action]" ----------

function createAddForm(el: LocusElement, onAdded: () => Promise<void>): HTMLElement {
  let pendingId = crypto.randomUUID() // attachments added before the to-do exists hang on this id
  let chosen: { when: When; waitsFor: WaitsFor } | null = null // picked in the When picker
  let parsedTitle: string | null = null // the action text without the typed when

  const whenChip = h('button', { type: 'button', class: 'when-chip empty', onclick: () => void choose() }, 'When?')
  const action = h('input', {
    class: 'input todo-action',
    type: 'text',
    placeholder: 'e.g. Breakfast daily 8am',
    'aria-label': 'What to do',
    maxlength: 200,
    oninput: () => sync(),
    onkeydown: (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        void add()
      }
    },
  })
  const addButton = button('Add', () => void add(), 'primary')
  const importance = levelPicker('importance', DEFAULT_IMPORTANCE)
  const difficulty = levelPicker('difficulty', DEFAULT_DIFFICULTY)
  const why = h('textarea', { class: 'input', rows: 2, placeholder: 'Why it matters (optional)', 'aria-label': 'Why it matters' })
  let strip = attachmentStrip({ type: 'todo', id: pendingId })
  const more = h('div', { class: 'todo-more', hidden: true }, h('label', { class: 'field-label' }, 'Why', why), h('div', { class: 'field-label' }, 'Attachments', strip.el))
  const nudge = h('div', { class: 'someday-nudge', hidden: true })

  // The when the form would use: picked, else read from the text.
  function current(): { when: When; waitsFor: WaitsFor; fromText: boolean } | null {
    if (chosen) return { ...chosen, fromText: false }
    const parsed = parseTyped(action.value, Date.now())
    parsedTitle = parsed.when ? parsed.title : null
    return parsed.when ? { when: parsed.when, waitsFor: null, fromText: true } : null
  }

  async function sync() {
    const c = current()
    const now = Date.now()
    if (c) {
      const other = c.waitsFor?.type === 'todo' ? (await db.todos.get(c.waitsFor.id))?.title : undefined
      whenChip.textContent = whenText(c.when, now, other) + (c.fromText ? ' ✎' : '')
      whenChip.classList.remove('empty')
      whenChip.title = c.fromText ? 'Read from what you typed. Tap to change.' : ''
    } else {
      whenChip.textContent = 'When?'
      whenChip.classList.add('empty')
    }
    showNudge(c?.when.kind === 'someday')
  }

  function showNudge(show: boolean) {
    nudge.hidden = !show
    if (!show) return
    nudge.replaceChildren(
      h('span', {}, 'To-dos with a when get done far more often. Add one?'),
      ...quickPicks(Date.now()).map((q) =>
        h('button', { type: 'button', class: 'chip', onclick: () => { chosen = { when: q.when, waitsFor: null }; void sync() } }, q.label),
      ),
    )
  }

  async function choose() {
    const c = current()
    const picked = await pickWhen(c?.when ?? null, null)
    if (!picked) return
    chosen = picked
    await sync()
  }

  async function add() {
    const text = action.value.trim()
    if (!text) {
      action.focus()
      return
    }
    let c = current()
    if (!c) {
      // The when is required: ask for one.
      const picked = await pickWhen(null, null)
      if (!picked) return
      c = { ...picked, fromText: false }
    }
    const title = c.fromText && parsedTitle ? parsedTitle : text
    const draft: TodoDraft = { title: title || text, why: why.value, importance: importance.value(), difficulty: difficulty.value(), when: c.when }
    await createTodo(el.id, draft, c.waitsFor, pendingId)
    // Reset for the next one.
    pendingId = crypto.randomUUID()
    const fresh = attachmentStrip({ type: 'todo', id: pendingId })
    strip.el.replaceWith(fresh.el)
    strip = fresh
    chosen = null
    action.value = ''
    why.value = ''
    await sync()
    await onAdded()
    action.focus()
  }

  // Attachments added to a to-do that was never created would linger: drop them on leaving.
  window.addEventListener(
    'hashchange',
    async () => {
      if (!(await db.todos.get(pendingId))) await db.transaction('rw', db.attachments, db.blobs, () => deleteAttachmentsOf([{ type: 'todo', id: pendingId }]))
    },
    { once: true },
  )

  void sync()
  return h(
    'section',
    { class: 'todo-add' },
    h('div', { class: 'todo-sentence' }, whenChip, h('span', { class: 'todo-dot', 'aria-hidden': 'true' }, '·'), action, addButton),
    nudge,
    h(
      'div',
      { class: 'todo-levels' },
      h('div', { class: 'level-row' }, h('span', { class: 'level-name' }, 'Importance'), importance.el),
      h('div', { class: 'level-row' }, h('span', { class: 'level-name' }, 'Difficulty'), difficulty.el),
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'btn-link',
        'aria-expanded': 'false',
        onclick: (e: Event) => {
          more.hidden = !more.hidden
          ;(e.currentTarget as HTMLElement).setAttribute('aria-expanded', String(!more.hidden))
          ;(e.currentTarget as HTMLElement).textContent = more.hidden ? 'More' : 'Less'
        },
      },
      'More',
    ),
    more,
  )
}

// ---------- The When picker ----------

interface QuickPick {
  label: string
  when: When
}

// Tonight, Tomorrow morning, This weekend, Next week (SPEC-v2.md, "Entry").
export function quickPicks(now: number): QuickPick[] {
  const at = (days: number, hours: number) => {
    const d = new Date(now)
    d.setDate(d.getDate() + days)
    d.setHours(hours, 0, 0, 0)
    return d.getTime()
  }
  const weekday = new Date(now).getDay() // 0 = Sunday
  const toSaturday = weekday === 6 || weekday === 0 ? 0 : 6 - weekday
  const first = firstDayOfWeek() % 7 // 0 = Sunday … 6 = Saturday
  const toNextWeek = ((first - weekday + 7) % 7) || 7
  return [
    { label: 'Tonight', when: { kind: 'at', at: at(0, 20), hasTime: true } },
    { label: 'Tomorrow morning', when: { kind: 'at', at: at(1, 9), hasTime: true } },
    { label: 'This weekend', when: { kind: 'at', at: dayStartOf(at(toSaturday, 12)), hasTime: false } },
    { label: 'Next week', when: { kind: 'at', at: dayStartOf(at(toNextWeek, 12)), hasTime: false } },
  ]
}

// `self`: the to-do being edited, which can't wait on itself.
export function pickWhen(current: When | null, self: string | null): Promise<{ when: When; waitsFor: WaitsFor } | null> {
  return openSheet<{ when: When; waitsFor: WaitsFor }>('When', (api) => {
    const done = (when: When, waitsFor: WaitsFor = null) => api.close({ when, waitsFor })
    const option = (label: string, onclick: () => void, extra = '') => h('button', { type: 'button', class: `when-option ${extra}`, onclick }, label)

    function main(): HTMLElement[] {
      const now = Date.now()
      return [
        h('h2', {}, 'When will you do it?'),
        h(
          'div',
          { class: 'chips' },
          quickPicks(now).map((q) => h('button', { type: 'button', class: 'chip', onclick: () => done(q.when) }, q.label)),
          h('button', { type: 'button', class: 'chip', onclick: () => api.show(...repeatView(current, done, () => api.show(...main()), 'daily')) }, 'Every day'),
        ),
        h(
          'div',
          { class: 'when-options' },
          option('Pick a date and time…', () => api.show(...dateView(current, done, () => api.show(...main())))),
          option('Repeat…', () => api.show(...repeatView(current, done, () => api.show(...main())))),
          option('After another to-do…', () => void afterView(api, self, done, () => api.show(...main()))),
          option('When a goal reaches…', () => void goalView(api, current, done, () => api.show(...main()))),
          option('When something happens…', () => api.show(...conditionView(current, done, () => api.show(...main())))),
          option('Someday', () => done({ kind: 'someday' }), 'someday'),
        ),
        sheetActions(null, button('Cancel', () => api.close(null))),
      ]
    }
    return { content: main() }
  })
}

type Done = (when: When, waitsFor?: WaitsFor) => void

function dateView(current: When | null, done: Done, backToMain: () => void): HTMLElement[] {
  const base = current?.kind === 'at' ? new Date(current.at) : new Date(Date.now() + DAY)
  const pad = (n: number) => String(n).padStart(2, '0')
  const date = h('input', { class: 'input', type: 'date', 'aria-label': 'Date' })
  date.value = `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}`
  const error = h('p', { class: 'sheet-error', role: 'alert' })
  const set = () => {
    const t = time.read()
    if (!date.value) {
      error.textContent = 'Pick a date.'
      return
    }
    if (t === null) {
      error.textContent = 'That doesn’t look like a time. Try 7:30am or 19:30.'
      return
    }
    const [y, m, d] = date.value.split('-').map(Number)
    if (t) {
      const [hh, mm] = t.split(':').map(Number)
      rememberTime(t)
      done({ kind: 'at', at: new Date(y, m - 1, d, hh, mm).getTime(), hasTime: true })
    } else done({ kind: 'at', at: dayStartOf(new Date(y, m - 1, d, 12).getTime()), hasTime: false })
  }
  const time = timeField(current?.kind === 'at' && current.hasTime ? `${pad(base.getHours())}:${pad(base.getMinutes())}` : undefined, () => (error.textContent = ''), set)
  return [
    h('h2', {}, 'Pick a date'),
    h('label', { class: 'field-label' }, 'Date', date),
    time.el,
    error,
    sheetActions(null, button('Back', backToMain), button('Set', set, 'primary')),
  ]
}

const WEEKDAYS = [RRule.SU, RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR, RRule.SA]

type Freq = 'daily' | 'weekly' | 'monthly'

// What the Repeat view starts from: the repeat being edited, else every day (what most
// repeating to-dos are), with today's weekday and date ready if switched to weekly or monthly.
function repeatStart(current: When | null): { freq: Freq; interval: number; days: number[]; monthDay: number } {
  const today = new Date()
  const start = { freq: 'daily' as Freq, interval: 1, days: [today.getDay()], monthDay: today.getDate() }
  if (current?.kind !== 'repeat') return start
  try {
    const o = RRule.fromString(current.rrule).origOptions
    const freq = o.freq === RRule.DAILY ? 'daily' : o.freq === RRule.WEEKLY ? 'weekly' : o.freq === RRule.MONTHLY ? 'monthly' : null
    if (!freq) return start
    // rrule counts Monday as 0; here Sunday is 0.
    const days = ([] as unknown[]).concat(o.byweekday ?? []).map((d) => (((typeof d === 'number' ? d : (d as { weekday: number }).weekday) + 1) % 7))
    const monthDay = ([] as number[]).concat(o.bymonthday ?? [])[0]
    return { freq, interval: o.interval ?? 1, days: days.length > 0 ? days : start.days, monthDay: monthDay ?? start.monthDay }
  } catch {
    return start
  }
}

function repeatView(current: When | null, done: Done, backToMain: () => void, preset?: Freq): HTMLElement[] {
  const start = repeatStart(current)
  let freq: Freq = preset ?? start.freq
  const days = new Set<number>(start.days) // 0 = Sunday
  const every = h('input', { class: 'input every', type: 'number', min: 1, max: 99, step: 1, 'aria-label': 'Every', oninput: () => preview() })
  every.value = String(preset ? 1 : start.interval)
  const unit = h('span', { class: 'every-unit' })
  const monthDay = h('input', { class: 'input every', type: 'number', min: 1, max: 31, step: 1, 'aria-label': 'Day of the month', oninput: () => preview() })
  monthDay.value = String(start.monthDay)
  const summary = h('p', { class: 'sheet-note' })
  const error = h('p', { class: 'sheet-error', role: 'alert' })
  const set = () => {
    const t = time.read()
    if (t === null) {
      error.textContent = 'That doesn’t look like a time. Try 7:30am or 19:30.'
      return
    }
    rememberTime(t)
    done(makeRepeat(options(), Date.now(), t))
  }
  const time = timeField(current?.kind === 'repeat' ? current.time : undefined, () => preview(), set)

  // Weekday chips, starting on this locale's first day of the week.
  const first = firstDayOfWeek() % 7
  const order = Array.from({ length: 7 }, (_, i) => (first + i) % 7)
  const dayChips = order.map((d) =>
    h(
      'button',
      {
        type: 'button',
        class: 'chip',
        'aria-pressed': String(days.has(d)),
        onclick: (e: Event) => {
          if (days.has(d) && days.size > 1) days.delete(d)
          else days.add(d)
          ;(e.currentTarget as HTMLElement).setAttribute('aria-pressed', String(days.has(d)))
          preview()
        },
      },
      new Date(2026, 0, 4 + d).toLocaleDateString(undefined, { weekday: 'short' }), // 4 Jan 2026 was a Sunday
    ),
  )
  const weekRow = h('div', { class: 'chips' }, dayChips)
  const monthRow = h('label', { class: 'field-label' }, 'On day', monthDay)
  const freqButtons = (['daily', 'weekly', 'monthly'] as const).map((f) =>
    h(
      'button',
      {
        type: 'button',
        class: 'segment',
        role: 'radio',
        'aria-checked': String(f === freq),
        onclick: () => {
          freq = f
          freqButtons.forEach((b, i) => b.setAttribute('aria-checked', String(['daily', 'weekly', 'monthly'][i] === f)))
          preview()
        },
      },
      f === 'daily' ? 'Daily' : f === 'weekly' ? 'Weekly' : 'Monthly',
    ),
  )

  function options(): Partial<Options> {
    const interval = Math.max(1, Math.min(99, Number(every.value) || 1))
    if (freq === 'daily') return { freq: RRule.DAILY, interval }
    if (freq === 'weekly') return { freq: RRule.WEEKLY, interval, byweekday: [...days].sort().map((d) => WEEKDAYS[d]) }
    return { freq: RRule.MONTHLY, interval, bymonthday: [Math.max(1, Math.min(31, Number(monthDay.value) || 1))] }
  }

  function preview() {
    const n = Number(every.value) || 1
    unit.textContent = freq === 'daily' ? (n === 1 ? 'day' : 'days') : freq === 'weekly' ? (n === 1 ? 'week' : 'weeks') : n === 1 ? 'month' : 'months'
    weekRow.hidden = freq !== 'weekly'
    monthRow.hidden = freq !== 'monthly'
    error.textContent = ''
    const when = makeRepeat(options(), Date.now(), time.read() ?? undefined)
    summary.textContent = `${repeatText(when)} · first ${inSentence(formatDay(when.next, Date.now()))}`
  }
  preview()

  return [
    h('h2', {}, 'Repeat'),
    h('div', { class: 'segments segments-3', role: 'radiogroup', 'aria-label': 'How often' }, freqButtons),
    h('div', { class: 'every-row' }, h('span', {}, 'Every'), every, unit),
    weekRow,
    monthRow,
    time.el,
    summary,
    error,
    sheetActions(null, button('Back', backToMain), button('Set', set, 'primary')),
  ]
}

async function afterView(api: SheetApi<{ when: When; waitsFor: WaitsFor }>, self: string | null, done: Done, backToMain: () => void) {
  const [todos, elements, loci] = await Promise.all([db.todos.filter((t) => t.status === 'open').toArray(), db.elements.toArray(), db.loci.toArray()])
  const listName = new Map(elements.map((e) => [e.id, `${loci.find((l) => l.id === e.locusId)?.name ?? ''} › ${e.title}`]))
  // Not itself, and not one that already waits on it (that would wait forever).
  const waitingOnSelf = new Set<string>()
  if (self) for (const l of await db.links.where('[from.type+from.id]').equals(['todo', self]).filter((l) => l.kind === 'after').toArray()) waitingOnSelf.add(l.to.id)
  const candidates = todos.filter((t) => t.id !== self && !waitingOnSelf.has(t.id))
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search to-dos', 'aria-label': 'Search to-dos', oninput: () => show() })
  const list = h('div', { class: 'linked-list picker-results' })

  function show() {
    const q = search.value.trim().toLowerCase()
    const found = candidates.filter((t) => t.title.toLowerCase().includes(q)).slice(0, 40)
    list.replaceChildren(
      ...(found.length === 0
        ? [h('p', { class: 'field-hint' }, candidates.length === 0 ? 'There are no other open to-dos yet.' : 'Nothing matches.')]
        : found.map((t) =>
            h(
              'div',
              { class: 'linked-row' },
              h(
                'button',
                { type: 'button', class: 'linked-main', onclick: () => done({ kind: 'after' }, { type: 'todo', id: t.id }) },
                h('span', { class: 'linked-text' }, h('span', { class: 'linked-title' }, t.title), h('span', { class: 'linked-context' }, listName.get(t.elementId) ?? '')),
              ),
            ),
          )),
    )
  }
  show()
  api.show(h('h2', {}, 'After which to-do?'), h('p', { class: 'sheet-text' }, 'This one waits, and becomes due the moment that one is done.'), search, list, sheetActions(null, button('Back', backToMain)))
  search.focus()
}

// Wait for an open goal to reach a percentage.
async function goalView(api: SheetApi<{ when: When; waitsFor: WaitsFor }>, current: When | null, done: Done, backToMain: () => void) {
  const goals = await openGoals()
  const percent = h('input', { class: 'input every', type: 'number', min: 1, max: 100, step: 1, 'aria-label': 'Percent' })
  percent.value = String(current?.kind === 'goal' ? current.percent : 50)
  const error = h('p', { class: 'sheet-error', role: 'alert' })
  const pick = (goalId: string) => {
    const p = Math.round(Number(percent.value))
    if (!(p >= 1 && p <= 100)) {
      error.textContent = 'Pick a percentage from 1 to 100.'
      return
    }
    done({ kind: 'goal', percent: p }, { type: 'goal', id: goalId })
  }
  api.show(
    h('h2', {}, 'When a goal reaches…'),
    h('p', { class: 'sheet-text' }, 'This one waits, and becomes due the moment the goal gets there.'),
    h('label', { class: 'every-row' }, h('span', {}, 'Reaches'), percent, h('span', {}, '%')),
    error,
    h(
      'div',
      { class: 'linked-list picker-results' },
      goals.length === 0
        ? h('p', { class: 'field-hint' }, 'There are no open goals yet. Add a Goals element to a locus first.')
        : goals.map(({ goal, list }) =>
            h(
              'div',
              { class: 'linked-row' },
              h('button', { type: 'button', class: 'linked-main', onclick: () => pick(goal.id) }, h('span', { class: 'linked-text' }, h('span', { class: 'linked-title' }, goal.title), h('span', { class: 'linked-context' }, list.title))),
            ),
          ),
    ),
    sheetActions(null, button('Back', backToMain)),
  )
  percent.focus()
}

// The title of what an after/goal when waits for.
async function waitsForTitle(w: WaitsFor): Promise<string | undefined> {
  if (w?.type === 'todo') return (await db.todos.get(w.id))?.title
  if (w?.type === 'goal') return (await db.goals.get(w.id))?.title
  return undefined
}

function conditionView(current: When | null, done: Done, backToMain: () => void): HTMLElement[] {
  const input = h('input', { class: 'input', type: 'text', maxlength: 120, placeholder: 'e.g. the package arrives', 'aria-label': 'When' })
  if (current?.kind === 'when') input.value = current.condition
  const error = h('p', { class: 'sheet-error', role: 'alert' })
  return [
    h('h2', {}, 'When something happens'),
    h('p', { class: 'sheet-text' }, 'It waits in Planned with an “It happened” button. Tap that when it does, and the to-do is due.'),
    h('label', { class: 'field-label' }, 'When…', input),
    error,
    sheetActions(
      null,
      button('Back', backToMain),
      button(
        'Set',
        () => {
          const condition = input.value.trim().replace(/^when\s+/i, '')
          if (!condition) {
            error.textContent = 'Say what you’re waiting for.'
            return
          }
          done({ kind: 'when', condition })
        },
        'primary',
      ),
    ),
  ]
}

// ---------- Editing ----------

export async function openTodoSheet(todo: Todo): Promise<void> {
  let when = todo.when
  let waitsFor = await waitsForOf(todo.id)

  await openSheet<boolean>('To-do', (api) => {
    const owner = { type: 'todo' as const, id: todo.id }
    const chip = h('button', { type: 'button', class: 'when-chip', onclick: () => void change() })
    const title = h('input', { class: 'input', type: 'text', maxlength: 200, 'aria-label': 'What to do' })
    title.value = todo.title
    const why = h('textarea', { class: 'input', rows: 2, placeholder: 'Why it matters (optional)', 'aria-label': 'Why it matters' })
    why.value = todo.why ?? ''
    const importance = levelPicker('importance', todo.importance)
    const difficulty = levelPicker('difficulty', todo.difficulty)

    async function showWhen() {
      const other = await waitsForTitle(waitsFor)
      chip.textContent = whenText(when, Date.now(), other)
    }
    async function change() {
      const picked = await pickWhen(when, todo.id)
      if (!picked) return
      when = picked.when
      waitsFor = picked.waitsFor
      await showWhen()
    }
    void showWhen()

    const draft = (): TodoDraft => ({ title: title.value.trim() || todo.title, why: why.value, importance: importance.value(), difficulty: difficulty.value(), when })
    const save = async () => {
      // Keep what it waits for when the when wasn't changed to something else.
      await updateTodo(todo.id, draft(), when.kind === 'after' || when.kind === 'goal' ? waitsFor : null)
    }

    const isOpen = todo.status === 'open'
    const form = [
      h('h2', {}, 'To-do'),
      h('div', { class: 'field-label' }, 'When', chip),
      h('label', { class: 'field-label' }, 'What', title),
      h('label', { class: 'field-label' }, 'Why', why),
      h(
        'div',
        { class: 'field-label' },
        'Priority',
        h('div', { class: 'level-row' }, h('span', { class: 'level-name' }, 'Importance'), importance.el),
        h('div', { class: 'level-row' }, h('span', { class: 'level-name' }, 'Difficulty'), difficulty.el),
      ),
      h('div', { class: 'field-label' }, 'Attachments', attachmentStrip(owner).el),
      linkedItemsSection(owner, () => api.close(null)),
      h(
        'div',
        { class: 'todo-actions' },
        isOpen && todo.when.kind === 'when' && !todo.when.firedAt && button('It happened', async () => { await save(); await itHappened(todo.id); api.close(true) }),
        isOpen && todo.when.kind === 'repeat' && button('Skip this time', async () => { await save(); await skipTodo(todo.id); api.close(true) }),
        isOpen && todo.when.kind !== 'repeat' && button('Archive', async () => { await save(); await archiveTodo(todo.id); api.close(true) }),
        isOpen ? button('Done', async () => { await save(); await completeTodo(todo.id); api.close(true) }) : button('Reopen', async () => { await reopenTodo(todo.id); api.close(true) }),
      ),
      sheetActions(button('Delete', () => void askDelete(), 'danger-text'), button('Cancel', () => api.close(null)), submitButton('Save')),
    ]

    async function askDelete() {
      const waiting = await countDependents(todo.id)
      const goals = await goalsCountingTodo(todo.id)
      api.show(
        ...deleteConfirmation(
          `Delete “${todo.title}”?`,
          [
            waiting > 0 && `${count(waiting, 'to-do waits', 'to-dos wait')} for it; they become due now.`,
            goals.length > 0 && `It stops counting toward ${goals.map((g) => `“${g.title}”`).join(', ')}.`,
          ]
            .filter(Boolean)
            .join(' '),
          () => api.show(...form),
          async () => {
            await deleteTodo(todo.id)
            api.close(true)
          },
        ),
      )
    }

    return {
      content: form,
      onSubmit: async () => {
        await save()
        api.close(true)
      },
    }
  })
}
