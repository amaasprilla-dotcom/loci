// The home screen: a top bar (the name and today's date; the sync dot, Settings, and the
// Notes and Tasks buttons; the tag filter), the bubble field on a soft grey canvas, and docked at the
// bottom the Now card and the + button.
// It stays in the page while other screens cover it, so the bubbles keep their
// places (and motion) when you come back.

import { inAndroidApp } from '../android'
import { PALETTE } from '../colors'
import { h } from '../dom'
import { isActive, type Task } from '../elements/registry'
import { arrowUpRightIcon, settingsIcon } from '../icons'
import { createNowCard } from '../now/card'
import { describeSync } from '../settings/sync'
import { createLocus, deleteLocus, findOrCreateTag, listLoci, listTags, moveLocus, updateLocus } from '../store/db'
import { onSyncStatus } from '../sync/engine'
import type { Locus, Tag } from '../types'
import { type LocusDraft, openLocusSheet } from './createLocus'
import { createField, type Field, spiralPoint } from './field'
import { createTagFilter } from './filter'

export interface Home {
  el: HTMLElement
  field: Field
  refresh(): Promise<void>
  // The current tasks and the Now card's candidates (best first): loci with active tasks
  // wear a ring, the one behind the card pulses, and the badge is a dot when anything is due.
  setTasks(tasks: Task[], candidates?: Task[], studyAnywayLocusId?: string | null): void
}

export function createHome(options: { onOpen(locus: Locus): void; onTasks(): void; onNotes(): void; onSettings(): void }): Home {
  const field = createField({
    onTap: options.onOpen,
    onMove: (locus, x, y) => void moveLocus(locus.id, x, y),
    onLongPress: (locus) => void onEdit(locus),
  })
  // The Android app starts with its own empty storage: point at the way to bring Loci in.
  const empty = h('p', { class: 'home-empty' }, 'No loci yet. Tap + to create your first one.', inAndroidApp && ' Already use Loci elsewhere? Settings → Sync → Join with a key brings it here.')
  const filter = createTagFilter(() => applyFilter())

  const nowCard = createNowCard()
  const badge = h('span', { class: 'badge badge-dot', hidden: true })
  const tasksButton = h('button', { type: 'button', class: 'pill-btn', onclick: options.onTasks }, h('span', {}, 'Tasks'), badge, arrowUpRightIcon())
  const notesButton = h('button', { type: 'button', class: 'pill-btn pill-btn-outline', onclick: options.onNotes }, h('span', {}, 'Notes'), arrowUpRightIcon())
  const today = h('p', { class: 'brand-sub' })

  const moreButton = h(
    'button',
    {
      type: 'button',
      class: 'round-btn',
      'aria-label': 'Settings',
      title: 'Settings',
      onclick: options.onSettings,
    },
    settingsIcon(),
  )

  // Shows only when sync wants attention, or a round is slow. Opens Settings.
  const syncDot = h('button', { type: 'button', class: 'round-btn sync-dot', hidden: true, onclick: options.onSettings }, h('span', { class: 'sync-dot-mark' }))
  let busyTimer: ReturnType<typeof setTimeout> | undefined
  onSyncStatus((s) => {
    clearTimeout(busyTimer)
    const state = !s.on ? null : s.problem === 'offline' || s.problem === 'server' ? 'waiting' : s.problem ? 'error' : null
    const label = `Sync: ${describeSync(s)}`
    syncDot.setAttribute('aria-label', label)
    syncDot.title = label
    if (state) {
      syncDot.dataset.state = state
      syncDot.hidden = false
    } else if (s.busy) {
      // Quick rounds come and go without a flash of spinner.
      busyTimer = setTimeout(() => {
        syncDot.dataset.state = 'busy'
        syncDot.hidden = false
      }, 600)
    } else {
      syncDot.hidden = true
    }
  })

  let loci: Locus[] = []
  let tasks: Task[] = []
  let candidates: Task[] = []
  let studyAnywayLocusId: string | null = null

  // The tag filter greys out other loci, and focuses the badge on what's left.
  function applyFilter() {
    const tagId = filter.selected()
    const outside = new Set(tagId ? loci.filter((l) => !l.tagIds.includes(tagId)).map((l) => l.id) : [])
    field.setDimmed(outside)
    const active = tasks.filter(isActive)
    field.setActive(new Set(active.map((t) => t.locusId)))
    // A dot says something is waiting; it never says how much (SPEC-v5-now.md, "Signals").
    const waiting = active.some((t) => !outside.has(t.locusId))
    badge.hidden = !waiting
    tasksButton.setAttribute('aria-label', waiting ? 'Tasks, something due' : 'Tasks, nothing due')
    field.setPulse(candidates[0]?.locusId ?? null)
    nowCard.set(candidates, loci, studyAnywayLocusId)
    // Refreshed with the tasks (every minute), so it turns over at midnight.
    today.textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
  }

  function setTasks(next: Task[], nextCandidates: Task[] = [], nextStudyAnyway: string | null = null) {
    tasks = next
    candidates = nextCandidates
    studyAnywayLocusId = nextStudyAnyway
    applyFilter()
  }

  async function refresh() {
    const tags = await listTags()
    loci = await listLoci()
    field.render(loci)
    filter.render(tags)
    applyFilter()
    empty.hidden = loci.length > 0
  }

  async function resolveTagIds(draft: LocusDraft): Promise<string[]> {
    const created: Tag[] = []
    for (const name of draft.newTags) created.push(await findOrCreateTag(name))
    return [...new Set([...draft.tagIds, ...created.map((t) => t.id)])]
  }

  async function onCreate() {
    const count = loci.length
    const result = await openLocusSheet({ tags: await listTags(), suggestedColor: PALETTE[count % PALETTE.length] })
    if (result?.action !== 'save') return
    const { draft } = result
    const { width, height } = field.el.getBoundingClientRect()
    await createLocus({
      name: draft.name,
      color: draft.color,
      tagIds: await resolveTagIds(draft),
      studyImportance: draft.studyImportance,
      studyDifficulty: draft.studyDifficulty,
      retention: draft.retention,
      ...spiralPoint(count, width, height),
    })
    await refresh()
  }

  async function onEdit(locus: Locus) {
    const result = await openLocusSheet({ locus, tags: await listTags(), suggestedColor: locus.color })
    if (!result) return
    if (result.action === 'delete') {
      await deleteLocus(locus.id)
    } else {
      const { draft } = result
      await updateLocus(locus.id, {
        name: draft.name,
        color: draft.color,
        tagIds: await resolveTagIds(draft),
        studyImportance: draft.studyImportance,
        studyDifficulty: draft.studyDifficulty,
        retention: draft.retention,
      })
    }
    await refresh()
  }

  const el = h(
    'div',
    { class: 'home' },
    h(
      'header',
      { class: 'topbar' },
      h('div', { class: 'topbar-row' }, h('div', { class: 'brand-block' }, h('h1', { class: 'brand' }, 'Loci'), today), h('div', { class: 'topbar-actions' }, syncDot, moreButton, notesButton, tasksButton)),
      filter.el,
    ),
    field.el,
    empty,
    nowCard.el,
    h('button', { class: 'fab', 'aria-label': 'New locus', onclick: onCreate }, '+'),
  )

  return { el, field, refresh, setTasks }
}
