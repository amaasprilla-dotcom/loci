// The study screen: a locus's Study button (cards, problems and notes to recall
// together, length in minutes), or one deck's, set's or notebook's own Study button (until done). Missed
// problems return later in the session with new numbers; cards on a short
// learning step return when it's up.

import { textColorOn } from '../colors'
import { h } from '../dom'
import { DEFAULT_RETENTION } from '../elements/flashcards/srs'
import { closeIcon } from '../icons'
import { formatNumber } from '../locale'
import { back } from '../router'
import { db } from '../store/db'
import { formatIn } from '../time'
import type { FlashcardsData } from '../elements/flashcards/store'
import type { Card, Note, ProblemTemplate } from '../types'
import { typeable } from './answer'
import { buildSession, isStudyable, type StudyItem, studyPool } from './plan'
import { type Showing, showCard, showNote, showProblem, showTypedCard } from './reviewable'
import { studyAdjustments } from './limits'
import { minutesText, studyCounts } from './text'

const COMES_BACK_WITHIN = 60 * 60_000 // a card due again within the hour returns in this session
export const LENGTHS: (number | null)[] = [5, 10, 15, 25, null] // minutes; null = until done
const LENGTH_KEY = 'loci.studyMinutes'

function savedLength(): number | null {
  try {
    const v = localStorage.getItem(LENGTH_KEY)
    if (v === 'all') return null
    const n = Number(v)
    return LENGTHS.includes(n) ? n : 15
  } catch {
    return 15
  }
}

export interface StudyOptions {
  locusId: string
  elementIds?: string[] // just these (a deck's own Study button)
  backHash: string
  title: string
  chooseLength: boolean
}

export async function renderStudyScreen(opts: StudyOptions): Promise<HTMLElement> {
  const locus = await db.loci.get(opts.locusId)
  const retention = locus?.retention ?? DEFAULT_RETENTION
  const color = locus?.color ?? '#0b0f14'
  const now0 = Date.now()
  const elements = (await db.elements.where('locusId').equals(opts.locusId).toArray()).filter(
    (e) => isStudyable(e) && (!opts.elementIds || opts.elementIds.includes(e.id)),
  )
  const pool = await studyPool(elements, now0, await studyAdjustments(elements, now0))
  const titles = new Map(elements.map((e) => [e.id, e.title]))

  let leaving = false
  const leave = () => {
    if (leaving) return
    leaving = true
    detachKeys()
    back(opts.backHash)
  }

  const leftCount = h('span', { class: 'review-count' })
  const progress = h('div', { class: 'review-progress-fill' })
  const kicker = h('span', { class: 'review-kicker' })
  const stage = h('main', { class: 'review-main' })
  const footer = h('footer', { class: 'review-footer' })

  let queue: StudyItem[] = []
  const waiting: { item: StudyItem; showAt: number }[] = []
  let current: StudyItem | null = null
  let showing: Showing | null = null
  let done = 0
  const seenKinds = { card: new Set<string>(), template: new Set<string>(), note: new Set<string>() }
  const kindCounts = (items: StudyItem[]) => studyCounts(...(['card', 'template', 'note'] as const).map((k) => items.filter((i) => i.kind === k).length) as [number, number, number])
  let studyMs = 0
  let finished = false

  const left = () => queue.length + waiting.length + (current ? 1 : 0)
  function updateProgress() {
    const remaining = left()
    leftCount.textContent = remaining > 0 ? `${formatNumber(remaining)} left` : ''
    progress.style.width = `${done + remaining === 0 ? 100 : Math.min(100, (done / (done + remaining)) * 100)}%`
  }

  // ----- Before starting: how long -----
  function startPanel() {
    let minutes = savedLength()
    const all = buildSession(pool.items, null)
    const summary = h('p', { class: 'study-summary' })
    const show = () => {
      const picked = buildSession(pool.items, minutes == null ? null : minutes * 60)
      const secs = picked.reduce((s, i) => s + i.estSeconds, 0)
      summary.textContent =
        picked.length === 0
          ? 'Nothing fits in that time. Choose a longer session.'
          : `${kindCounts(picked)} · ${minutesText(secs)}${picked.length < all.length ? ` (of ${formatNumber(all.length)})` : ''}`
      start.disabled = picked.length === 0
    }
    const segs = LENGTHS.map((m) =>
      h(
        'button',
        {
          type: 'button',
          class: 'segment',
          role: 'radio',
          'aria-checked': String(m === minutes),
          onclick: () => {
            minutes = m
            segs.forEach((b, i) => b.setAttribute('aria-checked', String(LENGTHS[i] === m)))
            try {
              localStorage.setItem(LENGTH_KEY, m == null ? 'all' : String(m))
            } catch {
              // remembering the length is only a convenience
            }
            show()
          },
        },
        m == null ? 'Until done' : `${m} min`,
      ),
    )
    const start = h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: () => begin(minutes == null ? null : minutes * 60) }, 'Start')
    stage.replaceChildren(
      h(
        'div',
        { class: 'study-start' },
        h('h2', {}, 'Study'),
        h('p', { class: 'study-due' }, `Ready to study: ${kindCounts(all)}.`),
        h('div', { class: 'field-label' }, 'How long?', h('div', { class: 'segments segments-5', role: 'radiogroup', 'aria-label': 'Session length' }, segs)),
        summary,
      ),
    )
    footer.replaceChildren(start)
    show()
    start.focus()
  }

  function begin(budget: number | null) {
    queue = buildSession(pool.items, budget)
    next()
  }

  // ----- The session -----
  // Next: a returning item whose time is up, else the queue, else the soonest
  // returning item; but never the item just shown, while anything else is left.
  let lastId: string | null = null
  function pickNext(): StudyItem | null {
    const now = Date.now()
    waiting.sort((a, b) => a.showAt - b.showAt)
    const order: ['waiting' | 'queue', number][] = [
      ...waiting.flatMap((w, i): ['waiting', number][] => (w.showAt <= now ? [['waiting', i]] : [])),
      ...queue.map((_, i): ['queue', number] => ['queue', i]),
      ...waiting.flatMap((w, i): ['waiting', number][] => (w.showAt > now ? [['waiting', i]] : [])),
    ]
    const itemAt = ([from, i]: ['waiting' | 'queue', number]) => (from === 'waiting' ? waiting[i].item : queue[i])
    const choice = order.find((o) => itemAt(o).id !== lastId) ?? order[0]
    if (!choice) return null
    const [from, i] = choice
    return from === 'waiting' ? waiting.splice(i, 1)[0].item : queue.splice(i, 1)[0]
  }

  function next() {
    current = pickNext()
    if (!current) return void finish()
    lastId = current.id
    updateProgress()
    // Which deck or set this is from, in a locus session (a deck's own session is titled with it).
    kicker.textContent = opts.elementIds ? '' : (titles.get(current.elementId) ?? '')
    const item = current
    const s = { stage, footer, retention }
    const savedCard = (after: Card) => pool.cards.set(after.id, after)
    if (item.kind === 'card') {
      const card = pool.cards.get(item.id)!
      const typed = (pool.elements.get(item.elementId)?.data as FlashcardsData | undefined)?.answerMode === 'type' && typeable(card.back)
      showing = typed ? showTypedCard(card, s, savedCard) : showCard(card, s, savedCard)
    } else if (item.kind === 'template') {
      showing = showProblem(pool.templates.get(item.id)!, s, (after: ProblemTemplate) => pool.templates.set(after.id, after))
    } else {
      showing = showNote(pool.notes.get(item.id)!, s, (after: Note) => pool.notes.set(after.id, after))
    }
    void showing!.done.then((o) => {
      done++
      seenKinds[item.kind].add(item.id)
      studyMs += o.ms
      const now2 = Date.now()
      const updated = { ...item, srs: o.srs, isNew: false }
      if (item.kind === 'card' && o.srs.due - now2 < COMES_BACK_WITHIN) waiting.push({ item: updated, showAt: o.srs.due })
      // A missed problem comes back later with new numbers, a couple of items on, and
      // never straight after itself (unless it's all that's left: then it waits for next time).
      if (item.kind === 'template' && o.grade === 0 && queue.length + waiting.length > 0) queue.splice(Math.min(2, queue.length), 0, updated)
      current = null
      showing = null
      next()
    })
  }

  async function finish() {
    finished = true
    current = null
    updateProgress()
    kicker.textContent = ''
    const now = Date.now()
    const ids = elements.map((e) => e.id)
    const dues = [
      ...(await db.cards.where('elementId').anyOf(ids).toArray()).map((c) => c.srs),
      ...(await db.problemTemplates.where('elementId').anyOf(ids).toArray()).map((t) => t.srs),
      ...(await db.notes.where('elementId').anyOf(ids).toArray()).filter((n) => n.recall?.on).map((n) => n.recall!.srs),
    ]
      .filter((s) => s.state !== 0 && s.due > now)
      .map((s) => s.due)
    const nextDue = dues.length ? Math.min(...dues) : null
    const what = studyCounts(seenKinds.card.size, seenKinds.template.size, seenKinds.note.size)
    stage.replaceChildren(
      h(
        'div',
        { class: 'review-done' },
        done > 0 ? [h('h2', {}, 'Session complete'), h('p', {}, `You studied ${what} in ${formatDuration(studyMs)}.`)] : h('h2', {}, 'Nothing to study right now'),
        nextDue != null && h('p', { class: 'review-next' }, `Next review ${formatIn(nextDue - now)}.`),
      ),
    )
    footer.replaceChildren(h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: leave }, 'Done'))
  }

  function onKey(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector('.sheet')) return
    const target = e.target as HTMLElement | null
    // Writing a recall: keys are text. Escape only leaves the box, so a slip can't lose it.
    if (target?.tagName === 'TEXTAREA') {
      if (e.key === 'Escape') target.blur()
      return
    }
    if (e.key === 'Escape' || (finished && e.key === 'Enter')) {
      e.preventDefault()
      leave()
      return
    }
    if (target?.tagName === 'INPUT' && e.key !== 'Enter') return // typing an answer
    if (showing?.onKey(e)) e.preventDefault()
  }
  document.addEventListener('keydown', onKey)
  const detachKeys = () => document.removeEventListener('keydown', onKey)
  window.addEventListener('hashchange', detachKeys, { once: true })

  const screen = h(
    'div',
    { class: 'review-screen', style: { '--c': color, '--fg': textColorOn(color) } },
    h(
      'header',
      { class: 'review-bar' },
      h('button', { class: 'icon-btn', 'aria-label': 'End session', onclick: leave }, closeIcon()),
      h('span', { class: 'review-title' }, h('span', {}, opts.title), kicker),
      leftCount,
    ),
    h('div', { class: 'review-progress' }, progress),
    stage,
    footer,
  )
  if (pool.items.length === 0) void finish()
  else if (opts.chooseLength) startPanel()
  else begin(null)
  return screen
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return 'under a minute'
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

