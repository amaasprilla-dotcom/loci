// An experimental locus's screen (SPEC-v8-experimental.md): no tiles, decks or study.
// From the top: the weekly review (on review day, or while a change waits), this week's
// targets, and the work blocks. A header button opens the targets and rules, through
// the change rule's gate.

import { RRule } from 'rrule'
import { onChange } from '../changes'
import { textColorOn } from '../colors'
import { h } from '../dom'
import { buzz } from '../feedback'
import { backIcon, settingsIcon } from '../icons'
import { count } from '../locale'
import { focusHash, go } from '../router'
import { button, openSheet, sheetActions, submitButton } from '../sheet'
import { db } from '../store/db'
import { toast } from '../toast'
import type { Locus, Todo } from '../types'
import { dayToggles } from '../wellbeing/parts'
import { studyDayStart } from '../elements/flashcards/srs'
import { blockText } from '../elements/todos/block'
import { blockField } from '../elements/todos/blockField'
import { openTodoSheet } from '../elements/todos/screens'
import { createTodo, listTodos } from '../elements/todos/store'
import { formatDay, makeRepeat, parseClock, whenText } from '../elements/todos/when'
import { applyChange, changeGate, countFor, type DoneAt, daysLeft, heldTo, isReady, lastWeeks, reviewDue, snapshot, type Status, statusOf, type WeeklyData, weekEnd, weekKey, weekStart } from '../elements/weekly/model'
import { atText, dayName, openTargetsSheet, waitLabel } from '../elements/weekly/sheet'
import { changeWeekly, doneSince, experimentParts, loadWeekly, saveWeekly, tap } from '../elements/weekly/store'

const HISTORY_WEEKS = 8
const STATUS_TEXT: Record<Status, string> = { short: '', win: 'Win', good: 'Good week' }

export async function renderExperimentView(locus: Locus, options: { onBack(): void }): Promise<HTMLElement> {
  const tags = (await db.tags.bulkGet(locus.tagIds)).filter((t) => t != null)
  const parts = await experimentParts(locus.id)
  const review = h('div', { class: 'xp-review-slot' })
  const week = h('section', { class: 'task-section xp-week' })
  const blocksSection = h('section', { class: 'task-section xp-blocks' })
  let data: WeeklyData = parts.weekly.data
  let blocks: Todo[] = []

  async function render() {
    const now = Date.now()
    data = await loadWeekly(parts.weekly.id)
    // This week's numbers, written down the first time it's shown.
    if (snapshot(data, weekKey(now))) await saveWeekly(parts.weekly.id, data)
    blocks = (await listTodos(parts.blocks.id)).filter((t) => t.status === 'open')
    const first = new Date(weekStart(now))
    first.setDate(first.getDate() - 7 * (HISTORY_WEEKS - 1))
    const since = first.getTime()
    const done = await doneSince([...new Set([...data.targets.flatMap((t) => t.todoIds), ...blocks.map((b) => b.id)])], since)
    renderReview(now, done)
    renderWeek(now, done)
    renderBlocks(now, done)
  }

  // ---------- The weekly review, and a change waiting or ready ----------

  function renderReview(now: number, done: DoneAt[]) {
    const cards: HTMLElement[] = []
    const p = data.pending
    if (p && isReady(p, now)) {
      cards.push(
        h(
          'div',
          { class: 'xp-card xp-pending' },
          h('h2', { class: 'xp-card-title' }, 'Your change is ready'),
          h('p', { class: 'xp-quote' }, `You wrote: “${p.reason}”`),
          h('p', { class: 'settings-note' }, changeSummary(data, p.targets)),
          h('p', { class: 'settings-note' }, 'Still want it?'),
          h(
            'div',
            { class: 'wb-row' },
            button('Drop it', () => void dropChange()),
            button('Apply', () => void changeWeekly(parts.weekly.id, (d) => Object.assign(d, applyChange(d, p.targets, p.rules, Date.now()))).then(() => toast('Change applied')).then(render), 'primary'),
          ),
        ),
      )
    } else if (p) {
      cards.push(
        h(
          'div',
          { class: 'xp-card xp-pending' },
          h('h2', { class: 'xp-card-title' }, `Change waiting · ready ${atText(p.readyAt, now)}`),
          h('p', { class: 'xp-quote' }, `“${p.reason}”`),
          h('div', { class: 'wb-row' }, button('Drop it', () => void dropChange())),
        ),
      )
    }
    if (reviewDue(data, now)) {
      const key = weekKey(now)
      cards.push(
        h(
          'div',
          { class: 'xp-card xp-review' },
          h('h2', { class: 'xp-card-title' }, 'Weekly review'),
          h(
            'ul',
            { class: 'xp-tally' },
            data.targets.map((t) => {
              const c = countFor(data, t, key, done)
              const s = statusOf(c, heldTo(data, t, key))
              return h('li', { class: `xp-tally-row ${s}` }, h('span', {}, t.name), h('strong', {}, String(c)), h('span', { class: 'xp-tally-status' }, STATUS_TEXT[s] || `min ${heldTo(data, t, key).min}`))
            }),
          ),
          data.reviewSteps.length > 0 &&
            h(
              'ul',
              { class: 'xp-steps' },
              data.reviewSteps.map((s) => h('li', {}, h('label', { class: 'xp-step' }, h('input', { type: 'checkbox' }), h('span', {}, s)))),
            ),
          h(
            'div',
            { class: 'wb-row' },
            button('Change targets…', () => void changeTargets()),
            button('Review done', () => {
              buzz()
              void changeWeekly(parts.weekly.id, (d) => (d.reviewed = [...d.reviewed.filter((w) => w >= lastWeeks(now, HISTORY_WEEKS)[0]), key])).then(render)
            }, 'primary'),
          ),
        ),
      )
    }
    review.replaceChildren(...cards)
  }

  async function dropChange() {
    await changeWeekly(parts.weekly.id, (d) => (d.pending = null))
    toast('Change dropped')
    await render()
  }

  // ---------- This week ----------

  function renderWeek(now: number, done: DoneAt[]) {
    const key = weekKey(now)
    const end = weekEnd(now) - 12 * 3_600_000 // Sunday
    const range = `${new Date(weekStart(now)).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${new Date(end).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
    const left = daysLeft(now)
    const title = h('h2', { class: 'task-section-title' }, 'This week')
    const sub = h('p', { class: 'xp-week-sub' }, `${range} · ${left === 1 ? 'last day' : count(left, 'day', 'days') + ' left'}`)
    if (data.targets.length === 0) {
      week.replaceChildren(
        title,
        h(
          'div',
          { class: 'xp-card xp-empty' },
          h('p', {}, 'No targets yet. Each is a range: a minimum, which counts as a full win, and a good week. They’re counted Monday to Sunday and start again each Monday.'),
          button('Set targets', () => void changeTargets(), 'primary'),
        ),
      )
      return
    }
    const weeks = lastWeeks(now, HISTORY_WEEKS)
    const names = new Map(blocks.map((b) => [b.id, b.title]))
    week.replaceChildren(
      title,
      sub,
      h(
        'div',
        { class: 'xp-targets' },
        data.targets.map((t) => {
          const c = countFor(data, t, key, done)
          const held = heldTo(data, t, key)
          const s = statusOf(c, held)
          const scale = Math.max(held.good + 1, c, 1)
          const pct = (n: number) => `${Math.min(100, (n / scale) * 100)}%`
          const from = t.todoIds.map((id) => names.get(id)).filter(Boolean)
          return h(
            'div',
            { class: `xp-card xp-target ${s}` },
            h('div', { class: 'xp-target-top' }, h('span', { class: 'xp-target-name' }, t.name), STATUS_TEXT[s] ? h('span', { class: `xp-chip ${s}` }, STATUS_TEXT[s]) : null),
            h(
              'div',
              { class: 'xp-target-main' },
              h('button', { type: 'button', class: 'xp-count', 'aria-label': `${t.name}: ${c}. Take one off`, title: 'Take one off', disabled: c === 0, onclick: () => void tap(parts.weekly.id, t.id, -1).then(render) }, String(c)),
              h(
                'div',
                { class: 'xp-bar', role: 'img', 'aria-label': `${c} of ${held.min} to ${held.good}` },
                h('span', { class: 'xp-bar-fill', style: { width: pct(c) } }),
                h('span', { class: 'xp-bar-range', style: { left: pct(held.min), width: `calc(${pct(held.good)} - ${pct(held.min)})` } }),
                h('span', { class: 'xp-tick', style: { left: pct(held.min) } }),
                h('span', { class: 'xp-tick good', style: { left: pct(held.good) } }),
              ),
              h('button', { type: 'button', class: 'xp-plus', 'aria-label': `Add one to ${t.name}`, onclick: () => {
                buzz()
                void tap(parts.weekly.id, t.id, 1).then(render)
              } }, '+1'),
            ),
            h('p', { class: 'xp-target-sub' }, [`Minimum ${held.min} · good ${held.good}`, from.length > 0 && `counted from ${from.join(', ')}`].filter(Boolean).join(' · ')),
            h(
              'div',
              { class: 'xp-history', role: 'img', 'aria-label': `The last ${HISTORY_WEEKS} weeks` },
              weeks.map((w, i) => {
                const wc = countFor(data, t, w, done)
                const ws = statusOf(wc, heldTo(data, t, w))
                const label = `${i === weeks.length - 1 ? 'This week' : `Week of ${w}`}: ${wc}${STATUS_TEXT[ws] ? ` · ${STATUS_TEXT[ws]}` : ''}`
                return h('span', { class: `xp-dot ${ws}${i === weeks.length - 1 ? ' now' : ''}`, title: label })
              }),
            ),
          )
        }),
      ),
    )
  }

  // ---------- Blocks ----------

  function renderBlocks(now: number, done: DoneAt[]) {
    const today = studyDayStart(now)
    const rows = blocks.map((b) => {
      const doneToday = done.some((d) => d.todoId === b.id && d.doneAt >= today)
      const edit = async () => {
        await openTodoSheet(b)
        await render()
      }
      return h(
        'div',
        { class: 'xp-card xp-block' },
        h(
          'button',
          { type: 'button', class: 'xp-block-text', onclick: () => void edit() },
          b.plan?.cue ? h('span', { class: 'xp-block-if' }, `When ${b.plan.cue},`) : null,
          h('strong', {}, b.title),
          h('span', { class: 'xp-block-when' }, [whenText(b.when, now), blockText(b.block)].filter(Boolean).join(' · ')),
        ),
        doneToday ? h('span', { class: 'xp-chip good' }, 'Done today') : h('button', { type: 'button', class: 'btn btn-primary btn-small', onclick: () => go(focusHash(b.id)) }, 'Start'),
      )
    })
    blocksSection.replaceChildren(
      h('h2', { class: 'task-section-title' }, 'Blocks'),
      ...(rows.length
        ? rows
        : [h('p', { class: 'xp-week-sub' }, 'A block is a stretch of work at a set time, like every day after lunch for 90 minutes. Loci reminds you when it’s time and, on the phone, can keep distractions blocked while it runs.')]),
      h('button', { type: 'button', class: 'btn xp-add', onclick: () => void addBlock() }, '+ Add a block'),
    )
  }

  async function addBlock() {
    const made = await openBlockSheet(data)
    if (!made) return
    const todo = await createTodo(parts.blocks.id, made.draft)
    if (made.targetIds.length) {
      await changeWeekly(parts.weekly.id, (d) => {
        for (const t of d.targets) if (made.targetIds.includes(t.id)) t.todoIds = [...new Set([...t.todoIds, todo.id])]
      })
    }
    await render()
  }

  // ---------- Changing targets and rules ----------

  async function changeTargets() {
    const now = Date.now()
    data = await loadWeekly(parts.weekly.id)
    const gate = changeGate(data, now)
    if (gate.kind === 'closed') return toast(`Targets can change on ${dayName(data.reviewDay)}s, from ${formatDay(gate.opens, now)}.`)
    if (gate.kind === 'wait' && data.pending) return toast('A change is already waiting: apply or drop it first.')
    const result = await openTargetsSheet(data, blocks, gate)
    if (!result) return
    if (gate.kind === 'now') {
      await changeWeekly(parts.weekly.id, (d) => Object.assign(d, applyChange(d, result.targets, result.rules, Date.now())))
    } else {
      const askedAt = Date.now()
      await changeWeekly(parts.weekly.id, (d) => (d.pending = { askedAt, readyAt: askedAt + gate.hours * 3_600_000, reason: result.reason ?? '', targets: result.targets, rules: result.rules }))
      toast(`Held for ${waitLabel(gate.hours)}. Loci will ask you again then.`)
    }
    await render()
  }

  // Changes from a sheet, another screen or another device.
  const stopListening = onChange(() => void render())
  window.addEventListener('hashchange', stopListening, { once: true })

  const view = h(
    'div',
    { class: 'locus-view xp-view', style: { '--c': locus.color, '--fg': textColorOn(locus.color) } },
    h(
      'header',
      { class: 'locus-header' },
      h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: options.onBack }, backIcon()),
      h(
        'div',
        { class: 'locus-title' },
        h('span', { class: 'header-kicker' }, 'Experimental'),
        h('h1', {}, locus.name),
        tags.length > 0 && h('div', { class: 'locus-tags' }, tags.map((t) => h('span', { class: 'tag' }, t.name))),
      ),
      h('button', { type: 'button', class: 'icon-btn header-end', 'aria-label': 'Targets and rules', title: 'Targets and rules', onclick: () => void changeTargets() }, settingsIcon()),
    ),
    h('main', { class: 'locus-body' }, review, week, blocksSection),
  )
  await render()
  return view
}

// "Videos 1–2 → 2–3; adds Gym; drops Reading"
function changeSummary(data: WeeklyData, next: WeeklyData['targets']): string {
  const before = new Map(data.targets.map((t) => [t.id, t]))
  const parts: string[] = []
  for (const t of next) {
    const was = before.get(t.id)
    if (!was) parts.push(`adds ${t.name} (${t.min}–${t.good})`)
    else if (was.min !== t.min || was.good !== t.good || was.name !== t.name) parts.push(`${t.name}: ${was.min}–${was.good} → ${t.min}–${t.good}`)
  }
  for (const t of data.targets) if (!next.some((n) => n.id === t.id)) parts.push(`drops ${t.name}`)
  return parts.length ? `The change: ${parts.join('; ')}.` : 'The change is to the rules only.'
}

// A new block: "When [I finish lunch], I will [open this week's video]", at a time on some
// days, for a length, maybe with distractions blocked, maybe counting toward targets.
function openBlockSheet(data: WeeklyData): Promise<{ draft: Parameters<typeof createTodo>[1]; targetIds: string[] } | null> {
  return openSheet('New block', (api) => {
    const cue = h('input', { class: 'input todo-cue', type: 'text', maxlength: 120, placeholder: 'I finish lunch (optional)', 'aria-label': 'When' })
    const title = h('input', { class: 'input todo-action', type: 'text', maxlength: 200, placeholder: 'open this week’s video where I left it', 'aria-label': 'I will', oninput: () => sync() })
    const time = h('input', { class: 'input phone-time', type: 'time', value: '14:00', 'aria-label': 'At' })
    let days = [0, 1, 2, 3, 4, 5, 6]
    const block = blockField({ minutes: 90, noDistractions: false })
    const targetIds = new Set<string>()
    const counts = data.targets.length
      ? h(
          'div',
          { class: 'field-label' },
          'Counts toward',
          h(
            'div',
            { class: 'chips' },
            data.targets.map((t) =>
              h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', onclick: (e: MouseEvent) => {
                if (targetIds.has(t.id)) targetIds.delete(t.id)
                else targetIds.add(t.id)
                ;(e.currentTarget as HTMLElement).setAttribute('aria-pressed', String(targetIds.has(t.id)))
              } }, t.name),
            ),
          ),
        )
      : null
    const error = h('p', { class: 'sheet-error', role: 'alert' })
    const submit = submitButton('Add block')
    const sync = () => (submit.disabled = title.value.trim() === '')
    sync()
    return {
      content: [
        h('h2', {}, 'New block'),
        h('div', { class: 'todo-sentence' }, h('span', { class: 'todo-word' }, 'When'), cue),
        h('div', { class: 'todo-sentence' }, h('span', { class: 'todo-word' }, 'I will'), title),
        h('div', { class: 'field-label' }, 'Reminder at', h('span', { class: 'field-hint' }, 'Loci reminds you then; the block starts when you tap Start.'), time),
        h('div', { class: 'field-label' }, 'Days', dayToggles('Days', days, (d) => (days = d))),
        block.el,
        counts,
        error,
        sheetActions(null, button('Cancel', () => api.close(null)), submit),
      ],
      focus: title,
      onSubmit: () => {
        const at = parseClock(time.value)
        if (!title.value.trim()) return
        if (!at) return void (error.textContent = 'Pick a time for the reminder.')
        if (days.length === 0) return void (error.textContent = 'Pick at least one day.')
        const rule = days.length === 7 ? { freq: RRule.DAILY } : { freq: RRule.WEEKLY, byweekday: days.map((d) => (d + 6) % 7) }
        api.close({
          draft: { title: title.value.trim(), importance: 3, difficulty: 2, when: makeRepeat(rule, Date.now(), at), plan: { cue: cue.value }, block: block.value() },
          targetIds: [...targetIds],
        })
      },
    }
  })
}
