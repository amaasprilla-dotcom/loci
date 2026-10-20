// The goal list, the goal detail screen, and the sheets for goals, contributors
// and check-ins (SPEC-v2.md, "Goals"). Loaded on demand from type.ts.

import { RRule } from 'rrule'
import { attachmentStrip } from '../../attachmentStrip'
import { textColorOn } from '../../colors'
import { h } from '../../dom'
import { backIcon, settingsIcon } from '../../icons'
import { levelPicker } from '../../levels'
import { linkedItemsSection } from '../../linkedItems'
import { formatNumber, parseNumber } from '../../locale'
import { back, elementHash, go, subHash } from '../../router'
import { button, deleteConfirmation, openSheet, type SheetApi, sheetActions, submitButton } from '../../sheet'
import { db } from '../../store/db'
import type { Contributor, Goal, Level, LocusElement, RepeatWhen, Todo } from '../../types'
import { createTodo } from '../todos/store'
import { pickWhen } from '../todos/screens'
import { formatDay, repeatText } from '../todos/when'
import { checkinSchedule } from './defaults'
import { checklistTarget, contributorProgress, currentValue, expectedProgress, type GoalData, goalProgress, hasEnded, paceText, progressSeries, timeLeft, weight } from './progress'
import {
  addContributor,
  type ContributorDraft,
  createGoal,
  deleteGoal,
  dueCheckins,
  isCheckin,
  listGoals,
  loadGoalData,
  removeContributor,
  saveCheckin,
  toggleChecklistItem,
  updateContributor,
  updateGoal,
} from './store'
import { goalSummary } from './type'

const DAY = 86_400_000
const pct = (x: number) => formatNumber(x, { style: 'percent', maximumFractionDigits: 0 })

async function screenShell(el: LocusElement, title: Node, onBack: () => void, ...end: Node[]) {
  const locus = await db.loci.get(el.locusId)
  const color = locus?.color ?? '#0b0f14'
  const main = h('main', { class: 'locus-body' })
  const node = h(
    'div',
    { class: 'deck-screen', style: { '--c': color, '--fg': textColorOn(color) } },
    h(
      'header',
      { class: 'locus-header' },
      h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: onBack }, backIcon()),
      h('div', { class: 'locus-title' }, h('span', { class: 'header-kicker' }, locus?.name ?? ''), title),
      ...end,
    ),
    main,
  )
  return { node, main }
}

function bar(progress: number): HTMLElement {
  return h('span', { class: 'progress' }, h('span', { class: 'progress-fill', style: { width: `${Math.round(progress * 100)}%` } }))
}

// ---------- List ----------

export async function renderGoalList(el: LocusElement): Promise<HTMLElement> {
  const { node, main } = await screenShell(el, h('h1', {}, el.title), () => back(`#/locus/${encodeURIComponent(el.locusId)}`))
  const list = h('div', { class: 'goal-list' })

  async function render() {
    const now = Date.now()
    const goals = await listGoals(el.id)
    const open = goals.filter((g) => g.status === 'open')
    const achieved = goals.filter((g) => g.status === 'achieved')
    const cards = await Promise.all(open.map(async (g) => goalCard(el, g, await loadGoalData(g), now, render)))
    list.replaceChildren(
      ...(open.length === 0 ? [h('p', { class: 'list-empty' }, achieved.length > 0 ? 'No open goals.' : 'No goals yet. Set one with New goal.')] : cards),
      ...(achieved.length > 0
        ? [
            h(
              'details',
              { class: 'task-section muted' },
              h('summary', { class: 'task-section-title' }, `Achieved (${formatNumber(achieved.length)})`),
              h('div', { class: 'task-list' }, achieved.map((g) => h('button', { type: 'button', class: 'task-main', onclick: () => go(subHash(el, 'goal', g.id)) }, h('span', { class: 'task-title' }, `✓ ${g.title}`)))),
            ),
          ]
        : []),
    )
  }

  main.append(h('div', { class: 'deck-toolbar' }, h('p', { class: 'deck-stats' }, 'Each goal has a target; its % comes from what counts toward it.'), button('New goal', () => void newGoal(el).then(render), 'primary')), list)
  await render()
  return node
}

function goalCard(el: LocusElement, g: Goal, data: GoalData, now: number, refresh: () => Promise<void>): HTMLElement {
  const progress = goalProgress(data, now)
  const why = g.why ? h('p', { class: 'goal-why', onclick: (e: Event) => { e.stopPropagation(); (e.currentTarget as HTMLElement).classList.toggle('open') } }, g.why) : null
  return h(
    'div',
    { class: 'goal-card', role: 'button', tabindex: 0, onclick: () => go(subHash(el, 'goal', g.id)), onkeydown: (e: KeyboardEvent) => e.key === 'Enter' && go(subHash(el, 'goal', g.id)) },
    h('div', { class: 'goal-card-head' }, h('h3', {}, g.title), h('span', { class: 'goal-pct' }, pct(progress))),
    bar(progress),
    h('p', { class: 'goal-meta' }, [timeLeft(g, now), paceText(g, progress, now)].filter(Boolean).join(' · ') || 'No deadline'),
    why,
    hasEnded(g, now) && endedActions(g, refresh),
  )
}

// When the deadline has passed: Mark achieved, Extend deadline, Archive.
function endedActions(g: Goal, refresh: () => Promise<void>): HTMLElement {
  const stop = (fn: () => Promise<void>) => async (e: Event) => {
    e.stopPropagation()
    await fn()
    await refresh()
  }
  return h(
    'div',
    { class: 'goal-ended' },
    h('button', { type: 'button', class: 'btn btn-small btn-primary', onclick: stop(() => updateGoal(g.id, { status: 'achieved' })) }, 'Mark achieved'),
    h('button', { type: 'button', class: 'btn btn-small', onclick: stop(async () => { const d = await pickDeadline(g.deadline); if (d) await updateGoal(g.id, { deadline: d }) }) }, 'Extend deadline'),
    h('button', { type: 'button', class: 'btn btn-small', onclick: stop(() => updateGoal(g.id, { status: 'archived' })) }, 'Archive'),
  )
}

// ---------- Detail ----------

export async function renderGoal(el: LocusElement, goalId: string, openCheckin: boolean): Promise<HTMLElement> {
  let goal = await db.goals.get(goalId)
  if (!goal || goal.elementId !== el.id) {
    location.replace(elementHash(el))
    return h('div')
  }
  const owner = { type: 'goal' as const, id: goal.id }
  const titleNode = h('h1', {}, goal.title)
  const { node, main } = await screenShell(
    el,
    titleNode,
    () => back(elementHash(el)),
    h('button', { class: 'icon-btn header-end', 'aria-label': 'Goal settings', onclick: () => void settings() }, settingsIcon()),
  )
  const body = h('div', { class: 'goal-detail' })
  const log = h('div')

  async function render() {
    goal = (await db.goals.get(goalId))!
    titleNode.textContent = goal.title
    const now = Date.now()
    const data = await loadGoalData(goal)
    const progress = goalProgress(data, now)
    const checkins = data.contributors.filter(isCheckin)
    const due = dueCheckins(data.contributors, now)
    body.replaceChildren(
      ...[
        h(
          'section',
          { class: 'goal-summary' },
          h('div', { class: 'goal-card-head' }, h('span', { class: 'goal-big' }, pct(progress)), goal.status === 'achieved' && h('span', { class: 'pill pill-due' }, 'Achieved')),
          bar(progress),
          h('p', { class: 'goal-meta' }, goalSummary(goal, progress, now).split(' · ').slice(1).join(' · ') || 'No deadline'),
          goal.why && h('p', { class: 'goal-why open' }, goal.why),
          hasEnded(goal, now) && endedActions(goal, render),
          goal.status !== 'open' && h('button', { type: 'button', class: 'btn btn-small', onclick: async () => { await updateGoal(goalId, { status: 'open' }); await render() } }, 'Reopen'),
        ),
        chart(data, now),
        checkins.length > 0 &&
          h(
            'div',
            { class: 'goal-checkin-row' },
            button(due.length > 0 ? `Check in now (${formatNumber(due.length)} due)` : 'Check in now', () => void checkIn(data, false).then(render), due.length > 0 ? 'primary' : ''),
          ),
        h(
          'section',
          { class: 'task-section' },
          h('h2', { class: 'task-section-title' }, 'What counts toward it'),
          h('div', { class: 'contributors' }, data.contributors.map((c) => contributorCard(c, data, now))),
          button('Add what counts', () => void addFlow()),
        ),
      ].filter((x): x is HTMLElement => x !== false),
    )
    log.replaceChildren(...[history(data)].filter((x): x is HTMLElement => x !== false))
  }

  function contributorCard(c: Contributor, data: GoalData, now: number): HTMLElement {
    const p = contributorProgress(c, data, now)
    const w = weight(c, data)
    return h(
      'div',
      { class: 'contributor' },
      h('div', { class: 'goal-card-head' }, h('strong', {}, c.title), h('span', { class: 'goal-pct small' }, pct(p))),
      bar(p),
      h('p', { class: 'goal-meta' }, [describeContributor(c, data), `Weight ${formatNumber(w)}${c.weightOverride != null ? '' : ' (auto)'}`].join(' · ')),
      c.kind === 'checklist' &&
        h(
          'div',
          { class: 'checklist' },
          c.items.map((item) =>
            h(
              'label',
              { class: 'checklist-item' },
              h('input', {
                type: 'checkbox',
                ...(item.doneAt && { checked: true }),
                onchange: async () => {
                  await toggleChecklistItem(c.id, item.id)
                  await render()
                },
              }),
              h('span', {}, item.text),
            ),
          ),
        ),
      h('div', { class: 'contributor-actions' }, h('button', { type: 'button', class: 'btn-link', onclick: () => void editFlow(c, data) }, 'Edit')),
    )
  }

  async function addFlow() {
    const draft = await contributorSheet(el, null, null)
    if (draft && draft !== 'remove') {
      await addContributor(goalId, draft)
      await render()
    }
  }

  async function editFlow(c: Contributor, data: GoalData) {
    const result = await contributorSheet(el, c, data)
    if (!result) return
    if (result === 'remove') await removeContributor(c.id)
    else {
      const { todoId: _todoId, ...patch } = result as ContributorDraft & { todoId?: string }
      void _todoId
      await updateContributor(c.id, patch as Partial<Contributor>)
    }
    await render()
  }

  async function checkIn(data: GoalData, onlyDue: boolean) {
    await checkinSheet(goal!, data, onlyDue)
  }

  async function settings() {
    const result = await goalSheet(goal!)
    if (result === 'deleted') back(elementHash(el))
    else if (result) await render()
  }

  // Attachments and links load themselves; they stay put while the rest re-renders.
  const extras = h('section', { class: 'note-extras' }, h('div', { class: 'field-label' }, 'Attachments', attachmentStrip(owner).el), linkedItemsSection(owner, () => {}))
  main.append(h('div', { class: 'goal-detail' }, body, extras, log))
  await render()

  if (openCheckin) {
    // From the check-in task: the form straight away, then back to where you were.
    setTimeout(async () => {
      await checkIn(await loadGoalData(goal!), true)
      back(subHash(el, 'goal', goalId))
    }, 0)
  }
  return node
}

function describeContributor(c: Contributor, data: GoalData): string {
  const value = currentValue(c, data)!
  const unit = (u?: string) => (u ? (u === '%' ? '%' : ` ${u}`) : '')
  switch (c.kind) {
    case 'todoCount': {
      const todo = data.todos.get(c.linkId)
      return `${formatNumber(value)} of ${formatNumber(c.target)} done${todo ? ` · “${todo.title}”` : ''}`
    }
    case 'number':
      return `${formatNumber(value)}${unit(c.unit)} · from ${formatNumber(c.start)} to ${formatNumber(c.target)}${unit(c.unit)} · ${repeatText(c.schedule).toLowerCase()}`
    case 'slider':
      return `${formatNumber(value)}${unit(c.unit)} of ${formatNumber(c.max)}${unit(c.unit)} · target ${formatNumber(c.target)}${unit(c.unit)} · ${repeatText(c.schedule).toLowerCase()}`
    case 'checklist':
      return `${formatNumber(value)} of ${formatNumber(checklistTarget(c))} ticked`
  }
}

// Progress over time, hand-drawn in SVG. The dashed line is a steady pace to the deadline.
function chart(data: GoalData, now: number): HTMLElement | false {
  const series = progressSeries(data, now)
  if (series.length < 2) return false
  const start = data.goal.startAt
  const end = Math.max(now, data.goal.deadline ?? now)
  const W = 300
  const H = 110
  const x = (t: number) => ((t - start) / Math.max(1, end - start)) * W
  const y = (v: number) => H - v * H
  const points = series.map((p) => `${x(p.at).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
  const pace = expectedProgress(data.goal, data.goal.deadline ?? now) != null ? `<line x1="0" y1="${H}" x2="${x(data.goal.deadline!)}" y2="0" class="chart-pace"/>` : ''
  const wrap = h('div', { class: 'goal-chart', role: 'img', 'aria-label': `Progress over time, now ${pct(goalProgress(data, now))}` })
  // Our own numbers only, no user text in this markup.
  wrap.innerHTML = `<svg viewBox="-4 -6 ${W + 8} ${H + 12}" preserveAspectRatio="none"><line x1="0" y1="0" x2="${W}" y2="0" class="chart-grid"/><line x1="0" y1="${H}" x2="${W}" y2="${H}" class="chart-grid"/>${pace}<polyline points="${points}" class="chart-line"/></svg>`
  return wrap
}

function history(data: GoalData): HTMLElement | false {
  const byId = new Map(data.contributors.map((c) => [c.id, c]))
  const entries = [...data.entries].sort((a, b) => b.at - a.at).slice(0, 30)
  if (entries.length === 0) return false
  const now = Date.now()
  return h(
    'details',
    { class: 'task-section' },
    h('summary', { class: 'task-section-title' }, 'Check-in history'),
    h(
      'div',
      { class: 'task-list' },
      entries.map((e) => {
        const c = byId.get(e.contributorId)
        const unit = c && 'unit' in c && c.unit ? (c.unit === '%' ? '%' : ` ${c.unit}`) : ''
        return h('div', { class: 'task-row' }, h('span', { class: 'task-main' }, h('span', { class: 'task-text' }, h('span', { class: 'task-title' }, `${c?.title ?? ''}: ${formatNumber(e.value)}${unit}`), h('span', { class: 'task-details' }, formatDay(e.at, now)))))
      }),
    ),
  )
}

// ---------- New goal ----------

async function newGoal(el: LocusElement): Promise<void> {
  const created = await openSheet<string>('New goal', (api) => {
    const title = h('input', { class: 'input', type: 'text', maxlength: 120, placeholder: 'e.g. Learn violin', 'aria-label': 'Goal' })
    const deadline = dateInput()
    const why = h('textarea', { class: 'input', rows: 2, placeholder: 'Why it matters. Shown on the goal every time.', 'aria-label': 'Why it matters' })
    const error = h('p', { class: 'sheet-error', role: 'alert' })

    const step1 = [
      h('h2', {}, 'New goal'),
      h('label', { class: 'field-label' }, 'Goal', title),
      h('label', { class: 'field-label' }, 'Deadline (optional)', deadline),
      h('label', { class: 'field-label' }, 'Why it matters (optional)', why),
      error,
      sheetActions(null, button('Cancel', () => api.close(null)), button('Next', () => next(), 'primary')),
    ]

    function next() {
      if (!title.value.trim()) {
        error.textContent = 'Name the goal.'
        return
      }
      api.show(
        h('h2', {}, 'What counts toward it?'),
        h('p', { class: 'sheet-text' }, 'Every goal needs at least one thing with an exact target. You can add more on the goal.'),
        kindOptions((kind) => void form(kind)),
        sheetActions(null, button('Back', () => api.show(...step1)), button('Skip: check in weekly', () => void finish([]))),
      )
    }

    async function form(kind: Contributor['kind']) {
      const draft = await contributorDraftView(api, el, kind, null, null, () => next())
      if (draft) await finish([draft])
    }

    async function finish(contributors: ContributorDraft[]) {
      const g = await createGoal(el.id, { title: title.value, why: why.value, deadline: dateValue(deadline) }, contributors)
      api.close(g.id)
    }

    return { content: step1, focus: title }
  })
  if (created) go(subHash(el, 'goal', created))
}

function kindOptions(choose: (kind: Contributor['kind']) => void): HTMLElement {
  const option = (kind: Contributor['kind'], title: string, desc: string) =>
    h('button', { type: 'button', class: 'type-option', onclick: () => choose(kind) }, h('span', {}, h('strong', {}, title), h('span', { class: 'type-desc' }, desc)))
  return h(
    'div',
    { class: 'type-options' },
    option('todoCount', 'Count a to-do', 'How many times a to-do gets done, e.g. 60 violin sessions.'),
    option('number', 'A number to reach', 'Check in on a number, e.g. weight 80 → 75 kg.'),
    option('slider', 'A rating to raise', 'Check in on a 0–10 rating, e.g. confidence 3 → 8.'),
    option('checklist', 'A checklist', 'Milestones to tick, all of them or some.'),
  )
}

// ---------- Contributors ----------

// Add (existing = null) or edit a contributor. Resolves with the draft, 'remove', or null.
function contributorSheet(el: LocusElement, existing: Contributor | null, data: GoalData | null): Promise<ContributorDraft | 'remove' | null> {
  return openSheet<ContributorDraft | 'remove'>(existing ? 'Edit' : 'Add what counts', (api) => {
    if (existing) {
      // The form shows itself, once the sheet is open.
      queueMicrotask(() => void contributorDraftView(api, el, existing.kind, existing, data, null).then((d) => d && api.close(d)))
      return { content: [] }
    }
    return {
      content: [
        h('h2', {}, 'Add what counts'),
        kindOptions(async (kind) => {
          const d = await contributorDraftView(api, el, kind, null, null, null)
          if (d) api.close(d)
        }),
        sheetActions(null, button('Cancel', () => api.close(null))),
      ],
    }
  })
}

type AnySheet = SheetApi<ContributorDraft | 'remove'> | SheetApi<string>

// The form for one contributor kind. Resolves with the draft when saved, or null.
function contributorDraftView(api: AnySheet, el: LocusElement, kind: Contributor['kind'], existing: Contributor | null, data: GoalData | null, onBack: (() => void) | null): Promise<ContributorDraft | null> {
  return new Promise((resolve) => {
    const error = h('p', { class: 'sheet-error', role: 'alert' })
    const title = h('input', { class: 'input', type: 'text', maxlength: 80, 'aria-label': 'Name' })
    title.value = existing?.title ?? ''
    const importance = levelPicker('importance', (existing?.importance ?? 2) as Level)
    const difficulty = levelPicker('difficulty', (existing?.difficulty ?? 2) as Level)
    const weightInput = numberInput(existing?.weightOverride, 'Weight')
    weightInput.placeholder = existing && data ? `auto: ${formatNumber(2 * existing.importance + existing.difficulty)}` : 'auto'
    const priority = h(
      'div',
      { class: 'field-label' },
      'Weight in the goal',
      h('span', { class: 'field-hint' }, 'From importance and difficulty (2 × importance + difficulty), or set a number.'),
      h('div', { class: 'level-row' }, h('span', { class: 'level-name' }, 'Importance'), importance.el),
      h('div', { class: 'level-row' }, h('span', { class: 'level-name' }, 'Difficulty'), difficulty.el),
      h('label', { class: 'level-row' }, h('span', { class: 'level-name' }, 'Weight'), weightInput),
    )
    const common = () => {
      const w = weightInput.value.trim() ? parseNumber(weightInput.value) : null
      return { title: title.value.trim(), importance: importance.value(), difficulty: difficulty.value(), ...(w != null && w > 0 && { weightOverride: w }) }
    }
    const fail = (msg: string) => {
      error.textContent = msg
      return null
    }
    const removeButton = existing && button('Remove', () => (api as SheetApi<ContributorDraft | 'remove'>).close('remove'), 'danger-text')
    const actions = (save: () => ContributorDraft | null | Promise<ContributorDraft | null>) =>
      sheetActions(
        removeButton || null,
        onBack ? button('Back', onBack) : button('Cancel', () => { api.close(null); resolve(null) }),
        button(existing ? 'Save' : 'Add', async () => {
          const d = await save()
          if (d) resolve(d)
        }, 'primary'),
      )

    if (kind === 'todoCount') {
      const c = existing?.kind === 'todoCount' ? existing : null
      const target = numberInput(c?.target, 'How many times')
      let picked: Todo | null = c && data ? (data.todos.get(c.linkId) ?? null) : null
      const chosen = h('p', { class: 'sheet-note' })
      const show = () => (chosen.textContent = picked ? `Counting “${picked.title}”` : 'No to-do chosen yet.')
      show()
      const pickers = c
        ? []
        : [
            h(
              'div',
              { class: 'chips' },
              h('button', { type: 'button', class: 'chip', onclick: async () => { picked = await pickTodo(); show() } }, 'Choose a to-do…'),
              h('button', { type: 'button', class: 'chip', onclick: async () => { picked = await newRepeatingTodo(el); show() } }, 'New repeating to-do…'),
            ),
          ]
      api.show(
        h('h2', {}, existing ? 'Edit: to-do count' : 'Count a to-do'),
        h('div', { class: 'field-label' }, 'To-do', chosen, ...pickers),
        h('label', { class: 'field-label' }, 'Target: times done', target),
        h('label', { class: 'field-label' }, 'Name (optional)', title),
        h('label', { class: 'field-label' }, 'Weight (optional)', weightInput),
        h('span', { class: 'field-hint' }, 'Its importance and difficulty come from the to-do.'),
        error,
        actions(() => {
          const t = parseNumber(target.value)
          if (!picked) return fail('Choose the to-do to count.')
          if (t == null || t < 1) return fail('Set how many times, 1 or more.')
          const w = weightInput.value.trim() ? parseNumber(weightInput.value) : null
          return { kind: 'todoCount', todoId: picked.id, target: Math.round(t), title: title.value.trim() || picked.title, importance: picked.importance, difficulty: picked.difficulty, ...(w != null && w > 0 && { weightOverride: w }) }
        }),
      )
      return
    }

    if (kind === 'checklist') {
      const c = existing?.kind === 'checklist' ? existing : null
      const lines = h('textarea', { class: 'input', rows: 5, placeholder: 'One milestone per line', 'aria-label': 'Milestones' })
      lines.value = c ? c.items.map((i) => i.text).join('\n') : ''
      const target = numberInput(c && c.target !== 'all' ? c.target : undefined, 'How many')
      target.placeholder = 'All'
      api.show(
        h('h2', {}, existing ? 'Edit: checklist' : 'A checklist'),
        h('label', { class: 'field-label' }, 'Name', title),
        h('label', { class: 'field-label' }, 'Milestones', lines),
        h('label', { class: 'field-label' }, 'Target: how many ticked (blank = all)', target),
        priority,
        error,
        actions(() => {
          const texts = lines.value.split('\n').map((s) => s.trim()).filter(Boolean)
          if (!title.value.trim()) return fail('Name the checklist.')
          if (texts.length === 0) return fail('Add at least one milestone.')
          const n = target.value.trim() ? parseNumber(target.value) : null
          if (n != null && (n < 1 || n > texts.length)) return fail(`The target is between 1 and ${texts.length}.`)
          // Keep ticks on milestones that stay.
          const items = texts.map((text) => c?.items.find((i) => i.text === text) ?? { id: crypto.randomUUID(), text })
          return { kind: 'checklist', items, target: n == null ? 'all' : Math.round(n), ...common() }
        }),
      )
      return
    }

    // number or slider: a check-in
    const c = existing && (existing.kind === 'number' || existing.kind === 'slider') ? existing : null
    const isSlider = kind === 'slider'
    const scale100 = c?.kind === 'slider' ? c.max === 100 : false
    let max = isSlider ? (scale100 ? 100 : 10) : 0
    const unit = h('input', { class: 'input', type: 'text', maxlength: 12, placeholder: 'e.g. kg', 'aria-label': 'Unit' })
    unit.value = c?.unit ?? ''
    const start = numberInput(c?.start, 'From')
    const target = numberInput(c?.target, 'To')
    const often = scheduleChooser(c?.schedule ?? null)
    const scale = isSlider
      ? h(
          'div',
          { class: 'segments segments-2', role: 'radiogroup', 'aria-label': 'Scale' },
          ...[10, 100].map((m) =>
            h(
              'button',
              {
                type: 'button',
                class: 'segment',
                role: 'radio',
                'aria-checked': String(m === max),
                onclick: (e: Event) => {
                  max = m
                  ;[...(e.currentTarget as HTMLElement).parentElement!.children].forEach((b, i) => b.setAttribute('aria-checked', String([10, 100][i] === m)))
                },
              },
              m === 10 ? '0–10' : '0–100%',
            ),
          ),
        )
      : null
    api.show(
      h('h2', {}, existing ? `Edit: ${isSlider ? 'rating' : 'number'}` : isSlider ? 'A rating to raise' : 'A number to reach'),
      h('label', { class: 'field-label' }, isSlider ? 'What you rate' : 'What you measure', title),
      isSlider ? h('div', { class: 'field-label' }, 'Scale', scale) : h('label', { class: 'field-label' }, 'Unit (optional)', unit),
      h('div', { class: 'field-row' }, h('label', { class: 'field-label' }, existing ? 'Start' : 'Now', start), h('label', { class: 'field-label' }, 'Target', target)),
      h('div', { class: 'field-label' }, 'Check in', often.el),
      priority,
      error,
      actions(() => {
        const s = parseNumber(start.value)
        const t = parseNumber(target.value)
        if (!title.value.trim()) return fail(isSlider ? 'Say what you rate.' : 'Say what you measure.')
        if (s == null || t == null) return fail('Set where you are now and the exact target.')
        if (s === t) return fail('The target has to differ from where you are now.')
        if (isSlider && [s, t].some((v) => v < 0 || v > max)) return fail(`Ratings run from 0 to ${max}.`)
        const schedule = often.value(c?.schedule ?? null)
        return isSlider
          ? { kind: 'slider', start: s, target: t, max, ...(max === 100 && { unit: '%' }), schedule, ...common() }
          : { kind: 'number', start: s, target: t, ...(unit.value.trim() && { unit: unit.value.trim() }), schedule, ...common() }
      }),
    )
    title.focus()
  })
}

function numberInput(value: number | undefined, label: string): HTMLInputElement {
  const input = h('input', { class: 'input', type: 'text', inputmode: 'decimal', 'aria-label': label, autocomplete: 'off' })
  if (value != null) input.value = formatNumber(value, { useGrouping: false, maximumFractionDigits: 6 })
  return input
}

// How often to check in: daily, weekly, or every N days.
function scheduleChooser(current: RepeatWhen | null): { el: HTMLElement; value(prev: RepeatWhen | null): RepeatWhen } {
  const kinds = ['Daily', 'Weekly', 'Every N days'] as const
  let kind: (typeof kinds)[number] = current?.rrule.includes('FREQ=DAILY') ? (/INTERVAL=(\d+)/.exec(current.rrule)?.[1] && /INTERVAL=(\d+)/.exec(current.rrule)![1] !== '1' ? 'Every N days' : 'Daily') : 'Weekly'
  const n = h('input', { class: 'input every', type: 'number', min: 2, max: 60, 'aria-label': 'Every how many days' })
  n.value = /INTERVAL=(\d+)/.exec(current?.rrule ?? '')?.[1] ?? '3'
  const nRow = h('div', { class: 'every-row' }, h('span', {}, 'Every'), n, h('span', {}, 'days'))
  const segs = kinds.map((k) =>
    h(
      'button',
      {
        type: 'button',
        class: 'segment',
        role: 'radio',
        'aria-checked': String(k === kind),
        onclick: () => {
          kind = k
          segs.forEach((b, i) => b.setAttribute('aria-checked', String(kinds[i] === k)))
          nRow.hidden = kind !== 'Every N days'
        },
      },
      k,
    ),
  )
  nRow.hidden = kind !== 'Every N days'
  return {
    el: h('div', { class: 'schedule' }, h('div', { class: 'segments segments-3', role: 'radiogroup', 'aria-label': 'How often' }, segs), nRow),
    value(prev) {
      const rule =
        kind === 'Daily' ? { freq: RRule.DAILY } : kind === 'Weekly' ? { freq: RRule.WEEKLY } : { freq: RRule.DAILY, interval: Math.max(2, Math.min(60, Number(n.value) || 3)) }
      const fresh = checkinSchedule(rule, Date.now())
      // Same rule as before: keep its timing (and whether it's due).
      return prev && prev.rrule.split('RRULE:')[1] === fresh.rrule.split('RRULE:')[1] ? prev : fresh
    },
  }
}

// An open to-do from anywhere, to count.
function pickTodo(): Promise<Todo | null> {
  return openSheet<Todo>('Choose a to-do', (api) => {
    const search = h('input', { class: 'input', type: 'search', placeholder: 'Search to-dos', 'aria-label': 'Search to-dos', oninput: () => void show() })
    const list = h('div', { class: 'linked-list picker-results' })
    async function show() {
      const q = search.value.trim().toLowerCase()
      const todos = (await db.todos.filter((t) => t.status === 'open' && t.title.toLowerCase().includes(q)).limit(40).toArray()).sort((a, b) => Number(b.when.kind === 'repeat') - Number(a.when.kind === 'repeat'))
      list.replaceChildren(
        ...(todos.length === 0
          ? [h('p', { class: 'field-hint' }, 'No open to-dos match. Make a new repeating one instead.')]
          : todos.map((t) =>
              h('div', { class: 'linked-row' }, h('button', { type: 'button', class: 'linked-main', onclick: () => api.close(t) }, h('span', { class: 'linked-text' }, h('span', { class: 'linked-title' }, t.title), h('span', { class: 'linked-context' }, t.when.kind === 'repeat' ? repeatText(t.when) : '')))),
            )),
      )
    }
    void show()
    return { content: [h('h2', {}, 'Which to-do counts?'), search, list, sheetActions(null, button('Cancel', () => api.close(null)))], focus: search }
  })
}

// A new repeating to-do, made from the goal, in a to-do list of the same locus
// (a "To-dos" list is made if the locus has none).
async function newRepeatingTodo(el: LocusElement): Promise<Todo | null> {
  const name = await openSheet<string>('New repeating to-do', (api) => {
    const input = h('input', { class: 'input', type: 'text', maxlength: 120, placeholder: 'e.g. Violin session', 'aria-label': 'What to do' })
    return {
      content: [h('h2', {}, 'New repeating to-do'), h('label', { class: 'field-label' }, 'What to do', input), sheetActions(null, button('Cancel', () => api.close(null)), submitButton('Next'))],
      onSubmit: () => input.value.trim() && api.close(input.value.trim()),
      focus: input,
    }
  })
  if (!name) return null
  const picked = await pickWhen(null, null)
  if (!picked) return null
  let list = (await db.elements.where('locusId').equals(el.locusId).toArray()).find((e) => e.type === 'todos')
  if (!list) {
    const { createElement } = await import('../../store/db')
    list = await createElement(el.locusId, 'todos', 'To-dos', {})
  }
  return createTodo(list.id, { title: name, importance: 3, difficulty: 2, when: picked.when }, picked.waitsFor)
}

// ---------- Check-in ----------

// One small form per check-in (only the due ones from the task, all of them by hand).
function checkinSheet(goal: Goal, data: GoalData, onlyDue: boolean): Promise<boolean | null> {
  const now = Date.now()
  const list = onlyDue ? dueCheckins(data.contributors, now) : data.contributors.filter(isCheckin)
  const shown = list.length > 0 ? list : data.contributors.filter(isCheckin)
  return openSheet<boolean>('Check in', (api) => {
    const fields = shown.map((c) => {
      const value = currentValue(c, data)!
      if (c.kind === 'slider') {
        const out = h('output', { class: 'range-value' }, formatNumber(value))
        const input = h('input', { type: 'range', min: 0, max: c.max, step: 1, class: 'range', 'aria-label': c.title })
        input.value = String(value)
        input.addEventListener('input', () => (out.textContent = formatNumber(Number(input.value)) + (c.unit === '%' ? '%' : '')))
        out.textContent = formatNumber(value) + (c.unit === '%' ? '%' : '')
        return { c, read: () => Number(input.value), el: h('div', { class: 'field-label' }, h('span', { class: 'range-head' }, c.title, out), input, h('span', { class: 'field-hint' }, `Target ${formatNumber(c.target)}${c.unit === '%' ? '%' : ''}`)) }
      }
      const input = numberInput(value, c.title)
      return { c, read: () => parseNumber(input.value), el: h('label', { class: 'field-label' }, `${c.title}${c.unit ? ` (${c.unit})` : ''}`, input, h('span', { class: 'field-hint' }, `Target ${formatNumber(c.target)}${c.unit ? ` ${c.unit}` : ''}`)) }
    })
    const error = h('p', { class: 'sheet-error', role: 'alert' })
    return {
      content: [h('h2', {}, `Check in: ${goal.title}`), ...fields.map((f) => f.el), error, sheetActions(null, button('Later', () => api.close(null)), submitButton('Save'))],
      onSubmit: async () => {
        const answers = fields.map((f) => ({ contributorId: f.c.id, value: f.read() }))
        if (answers.some((a) => a.value == null || Number.isNaN(a.value))) {
          error.textContent = 'Fill in every number.'
          return
        }
        await saveCheckin(answers as { contributorId: string; value: number }[])
        api.close(true)
      },
    }
  })
}

// ---------- Goal settings ----------

function dateInput(value?: number): HTMLInputElement {
  const input = h('input', { class: 'input', type: 'date', 'aria-label': 'Deadline' })
  if (value != null) {
    const d = new Date(value)
    input.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  return input
}

// A deadline is the end of its day.
function dateValue(input: HTMLInputElement): number | undefined {
  if (!input.value) return undefined
  const [y, m, d] = input.value.split('-').map(Number)
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime()
}

function pickDeadline(current?: number): Promise<number | null> {
  return openSheet<number>('Extend deadline', (api) => {
    const input = dateInput(Math.max(current ?? 0, Date.now()) + 14 * DAY)
    return {
      content: [h('h2', {}, 'New deadline'), input, sheetActions(null, button('Cancel', () => api.close(null)), submitButton('Set'))],
      onSubmit: () => {
        const v = dateValue(input)
        if (v) api.close(v)
      },
    }
  })
}

function goalSheet(goal: Goal): Promise<boolean | 'deleted' | null> {
  return openSheet<boolean | 'deleted'>('Goal', (api) => {
    const title = h('input', { class: 'input', type: 'text', maxlength: 120, 'aria-label': 'Goal' })
    title.value = goal.title
    const deadline = dateInput(goal.deadline)
    const why = h('textarea', { class: 'input', rows: 2, 'aria-label': 'Why it matters' })
    why.value = goal.why ?? ''
    const notify = h('input', { type: 'checkbox', ...(goal.notifyCheckins && { checked: true }) })
    const form = [
      h('h2', {}, 'Goal'),
      h('label', { class: 'field-label' }, 'Goal', title),
      h('label', { class: 'field-label' }, 'Deadline (optional)', deadline),
      h('label', { class: 'field-label' }, 'Why it matters', why),
      h('label', { class: 'checklist-item' }, notify, h('span', {}, 'Remind me of check-ins (once the app can send notifications)')),
      sheetActions(
        button('Delete', () => api.show(...deleteConfirmation(`Delete “${goal.title}”?`, 'Its check-ins and attachments go too; to-dos waiting for it become due.', () => api.show(...form), async () => {
          await deleteGoal(goal.id)
          api.close('deleted')
        })), 'danger-text'),
        button('Cancel', () => api.close(null)),
        submitButton('Save'),
      ),
    ]
    return {
      content: form,
      onSubmit: async () => {
        if (!title.value.trim()) return
        await updateGoal(goal.id, { title: title.value.trim(), why: why.value.trim() || undefined, deadline: dateValue(deadline), notifyCheckins: notify.checked })
        api.close(true)
      },
    }
  })
}
