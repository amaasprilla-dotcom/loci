// The Now card (SPEC-v5-now.md, "Now card"): the one thing to do now, why, and a way
// to start. Sits above the bubbles. Nothing else on it.

import { announceChange } from '../changes'
import { h } from '../dom'
import type { Task } from '../elements/registry'
import { skipTodo } from '../elements/todos/store'
import { focusHash, go, studyHash } from '../router'
import type { Locus } from '../types'
import { logEvent, noteShown } from './events'

export interface NowCard {
  el: HTMLElement
  // `candidates`: the ranked, active tasks (best first). `studyAnywayLocusId`: a bubble with
  // unstarted new cards, offered when nothing is due.
  set(candidates: Task[], loci: Locus[], studyAnywayLocusId: string | null): void
}

const SHOWN_ALTERNATIVES = 2

const shown = (...nodes: (Node | false | null | undefined | '')[]): Node[] => nodes.filter((n): n is Node => !!n)

export function createNowCard(): NowCard {
  const el = h('section', { class: 'now-card', 'aria-label': 'Now', hidden: true })
  let candidates: Task[] = []
  let loci: Locus[] = []
  let studyAnywayLocusId: string | null = null
  let expanded = false
  let topKey: string | undefined

  const title = (t: Task) => (t.kind === 'review' ? `Study · ${loci.find((l) => l.id === t.locusId)?.name ?? ''}` : t.label)
  const primaryLabel = (t: Task) => (t.kind === 'checkin' ? 'Check in' : 'Start')

  // Any Start: logged, then opened. A study session or the focus timer runs from here.
  function start(t: Task, rank: number) {
    void logEvent('start', t, { rank })
    if (t.kind === 'review') go(studyHash(t.locusId, 'start'))
    else if (t.kind === 'todo') go(focusHash(t.itemId!))
    else t.open()
  }

  async function resolve(t: Task, outcome: 'done' | 'skip') {
    await logEvent(outcome, t)
    if (outcome === 'done') await t.complete?.()
    else await skipTodo(t.itemId!)
    announceChange() // the refresh puts the next candidate in this place
  }

  function somethingElse() {
    const [top, ...rest] = candidates
    if (!expanded && rest.length > 0) {
      expanded = true
      void logEvent('alt_shown', top, { meta: { ids: rest.slice(0, SHOWN_ALTERNATIVES).map((t) => t.rank!.key) } })
      render()
    } else {
      go('#/tasks')
    }
  }

  function pick(alt: Task, rank: number) {
    void logEvent('pass', candidates[0], { meta: { picked: alt.rank!.key } })
    start(alt, rank)
  }

  function render() {
    el.hidden = loci.length === 0
    const top = candidates[0]
    if (!top) {
      el.style.removeProperty('--c')
      el.replaceChildren(...shown(h('p', { class: 'now-title' }, 'Nothing due.'), studyAnywayLocusId && h('button', { type: 'button', class: 'btn', onclick: () => go(studyHash(studyAnywayLocusId!, 'anyway')) }, 'Study anyway')))
      return
    }
    const color = loci.find((l) => l.id === top.locusId)?.color
    if (color) el.style.setProperty('--c', color)
    const repeat = top.rank?.type === 'repeat'
    el.replaceChildren(
      ...shown(
        h('p', { class: 'now-title' }, title(top)),
        h('p', { class: 'now-why' }, top.rank?.why ?? ''),
        h(
          'div',
          { class: 'now-actions' },
          h('button', { type: 'button', class: 'btn btn-primary', onclick: () => start(top, 1) }, primaryLabel(top)),
          top.kind === 'todo' && h('button', { type: 'button', class: 'btn', onclick: () => void resolve(top, 'done') }, 'Done'),
          repeat && h('button', { type: 'button', class: 'btn', onclick: () => void resolve(top, 'skip') }, 'Skip'),
        ),
        h('button', { type: 'button', class: 'btn-link now-more', 'aria-expanded': String(expanded), onclick: somethingElse }, 'Something else'),
        expanded &&
          h(
            'ul',
            { class: 'now-alternatives' },
            candidates.slice(1, 1 + SHOWN_ALTERNATIVES).map((alt, i) =>
              h(
                'li',
                {},
                h('button', { type: 'button', class: 'now-alt', onclick: () => pick(alt, i + 2) }, h('span', { class: 'now-alt-title' }, title(alt)), h('span', { class: 'now-alt-why' }, alt.rank?.why ?? '')),
              ),
            ),
          ),
      ),
    )
  }

  return {
    el,
    set(next, nextLoci, nextStudyAnywayLocusId) {
      candidates = next
      loci = nextLoci
      studyAnywayLocusId = nextStudyAnywayLocusId
      const key = next[0]?.rank?.key
      // A new top card starts closed, and counts as shown.
      if (key !== topKey) {
        topKey = key
        expanded = false
        if (next[0]) void noteShown(next[0])
      }
      render()
    },
  }
}
