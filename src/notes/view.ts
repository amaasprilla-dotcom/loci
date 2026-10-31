// The Notes screen: every note in one place, for quick writing and brainstorming.
// Misc (loose notes, in no locus) comes first, then each locus, folded open or
// shut, with the notes of its notebooks. Drag a note onto a locus to file it
// there, or onto Misc to take it out. Long-press (or right-click) a note for its menu.
//
// Dragging: a mouse drags as soon as it moves; touch holds still 500ms first, so
// a swipe still scrolls. Holding over a folded locus opens it.

import { h } from '../dom'
import { LOOSE, createNote, deleteNote, moveNote, noteHash, notebookFor, noteTitle, searchNotes } from '../elements/notes/store'
import { backIcon, chevronIcon, noteIcon, plusIcon } from '../icons'
import { count, formatNumber } from '../locale'
import { back, go } from '../router'
import { button, confirmDelete, openSheet, sheetActions } from '../sheet'
import { db, listLoci } from '../store/db'
import { formatAgo } from '../time'
import { toast } from '../toast'
import type { Locus, LocusElement, Note } from '../types'

export interface NotesScreen {
  el: HTMLElement
  // Called whenever the screen is shown, and on changes from other devices.
  update(): Promise<void>
}

const OPEN_KEY = 'loci.notesOpen' // the loci folded open, remembered on this device
const LONG_PRESS_MS = 500
const MOVE_THRESHOLD = 8 // px before a press counts as movement
const OPEN_ON_HOVER_MS = 600
const EDGE = 64 // px from the top or bottom where a drag scrolls the screen
const WEEK = 7 * 86_400_000

// Where a note can be dropped: 'loose', 'locus:<id>' or 'book:<id>'.
type Target = string

interface Press {
  noteId: string
  row: HTMLElement
  pointerId: number
  pointerType: string
  startX: number
  startY: number
  x: number
  y: number
  timer: number
  armed: boolean // held long enough: moving drags, letting go opens the menu
  dragging: boolean
  ghost?: HTMLElement
  over?: HTMLElement
  hoverTimer?: number
}

function when(at: number, now: number): string {
  return now - at < WEEK ? formatAgo(now - at) : new Date(at).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

function loadOpen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

function saveOpen(open: Set<string>) {
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify([...open]))
  } catch {
    // Storage blocked: the folds are forgotten next visit, nothing more.
  }
}

export function createNotesScreen(): NotesScreen {
  const opened = loadOpen()
  const stats = h('p', { class: 'deck-stats' })
  const search = h('input', {
    class: 'input search',
    type: 'search',
    placeholder: 'Search notes',
    'aria-label': 'Search notes',
    oninput: () => render(),
  })
  const tree = h('div', { class: 'nt-tree' })

  let loci: Locus[] = []
  let books: LocusElement[] = [] // notebooks, in their locus's order
  let notes: Note[] = []
  let press: Press | null = null
  let stale = false // data changed during a drag: redraw once it ends
  let swallowClick = false // the click after a drag or a long-press isn't a tap

  async function update() {
    if (press?.dragging) {
      stale = true
      return
    }
    const [l, elements, n] = await Promise.all([listLoci(), db.elements.toArray(), db.notes.toArray()])
    loci = l
    books = elements.filter((e) => e.type === 'notes').sort((a, b) => a.order - b.order)
    // Pinned notes first, then the most recently edited, as in a notebook.
    notes = n.sort((a, b) => b.pinned - a.pinned || b.updatedAt - a.updatedAt)
    render()
  }

  // ---------- Drawing ----------

  function render() {
    const now = Date.now()
    const bookIds = new Set(books.map((b) => b.id))
    // A note whose notebook is gone (mid-sync) shows nowhere until it settles.
    const known = notes.filter((n) => n.elementId === LOOSE || bookIds.has(n.elementId))
    stats.textContent = count(known.length, 'note', 'notes')
    const query = search.value.trim()
    const shown = searchNotes(known, query)
    const byBook = new Map<string, Note[]>()
    for (const n of shown) byBook.set(n.elementId, [...(byBook.get(n.elementId) ?? []), n])
    const bookById = new Map(books.map((b) => [b.id, b]))

    const row = (n: Note) => {
      // The note being dragged keeps its row, so the touch driving the drag isn't lost.
      if (press?.noteId === n.id) return press.row
      const book = bookById.get(n.elementId)
      return h(
        'button',
        { type: 'button', class: 'nt-note', 'data-note': n.id, onclick: () => go(noteHash(n, book)) },
        noteIcon(),
        h('span', { class: 'nt-note-title' }, n.pinned ? '📌 ' : '', noteTitle(n)),
        h('span', { class: 'nt-when' }, when(n.updatedAt, now)),
      )
    }
    const empty = (text: string) => h('p', { class: 'nt-empty' }, text)

    // ----- Misc -----
    const loose = byBook.get(LOOSE) ?? []
    const misc = h(
      'section',
      { class: 'task-section nt-section', 'data-drop': 'loose' },
      h(
        'div',
        { class: 'nt-section-head' },
        h('h2', { class: 'task-section-title' }, 'Misc'),
        h('button', { type: 'button', class: 'nt-add', 'aria-label': 'New note in Misc', title: 'New note', onclick: () => void newNote(null) }, plusIcon()),
      ),
      h(
        'div',
        { class: 'nt-panel' },
        loose.length > 0 ? loose.map(row) : empty(query ? 'No notes match.' : 'Quick notes that belong nowhere yet. Drag one onto a locus to file it there.'),
      ),
    )

    // ----- Loci -----
    const groups = loci.flatMap((locus) => {
      const own = books.filter((b) => b.locusId === locus.id)
      const total = own.reduce((sum, b) => sum + (byBook.get(b.id)?.length ?? 0), 0)
      if (query && total === 0) return []
      const open = Boolean(query) || opened.has(locus.id)
      const toggle = () => {
        if (opened.has(locus.id)) opened.delete(locus.id)
        else opened.add(locus.id)
        saveOpen(opened)
        render()
      }
      let body: HTMLElement | null = null
      if (open) {
        body = h(
          'div',
          { class: 'nt-body' },
          own.length > 1
            ? own.map((b) => {
                const list = byBook.get(b.id) ?? []
                if (query && list.length === 0) return null
                return h('div', { class: 'nt-book', 'data-drop': `book:${b.id}` }, h('div', { class: 'nt-book-title' }, b.title), list.length > 0 ? list.map(row) : empty('No notes'))
              })
            : total > 0
              ? (byBook.get(own[0].id) ?? []).map(row)
              : empty('No notes'),
        )
      }
      return [
        h(
          'div',
          { class: 'nt-group', 'data-drop': `locus:${locus.id}`, style: { '--c': locus.color } },
          h(
            'div',
            { class: 'nt-head' },
            h(
              'button',
              { type: 'button', class: 'nt-toggle', 'aria-expanded': String(open), 'data-locus': locus.id, onclick: toggle },
              chevronIcon(),
              h('span', { class: 'dot' }),
              h('span', { class: 'nt-name' }, locus.name),
              h('span', { class: 'nt-count' }, total > 0 ? formatNumber(total) : ''),
            ),
            h('button', { type: 'button', class: 'nt-add', 'aria-label': `New note in ${locus.name}`, title: 'New note', onclick: () => void newNote(locus) }, plusIcon()),
          ),
          body,
        ),
      ]
    })
    const lociSection = h(
      'section',
      { class: 'task-section nt-section' },
      h('div', { class: 'nt-section-head' }, h('h2', { class: 'task-section-title' }, 'Loci')),
      h('div', { class: 'nt-panel' }, groups.length > 0 ? groups : empty(query ? 'No notes match.' : 'No loci yet. Make one on the home screen.')),
    )

    tree.replaceChildren(misc, lociSection)
  }

  // ---------- Notes ----------

  // A new note in Misc (locus null), or in the locus's notebook (made if it has none).
  async function newNote(locus: Locus | null) {
    const book = locus ? await notebookFor(locus.id) : undefined
    const note = await createNote(book?.id ?? LOOSE)
    go(noteHash(note, book))
  }

  function placeName(target: Target): string {
    if (target === 'loose') return 'Misc'
    const [kind, id] = target.split(':')
    if (kind === 'locus') return loci.find((l) => l.id === id)?.name ?? ''
    const book = books.find((b) => b.id === id)
    const locus = book && loci.find((l) => l.id === book.locusId)
    return [locus?.name, book?.title].filter(Boolean).join(' › ')
  }

  async function moveTo(noteId: string, target: Target) {
    const note = notes.find((n) => n.id === noteId)
    if (!note) return
    const [kind, id] = target.split(':')
    let elementId = LOOSE
    if (kind === 'book') elementId = id
    else if (kind === 'locus') {
      // Already in this locus (any of its notebooks): nothing to do.
      const here = books.find((b) => b.id === note.elementId)
      if (here?.locusId === id) return
      elementId = (await notebookFor(id)).id
    }
    if (elementId === note.elementId) return
    await moveNote(noteId, elementId)
    // Open where it went, so it can be seen there.
    const locusId = kind === 'locus' ? id : books.find((b) => b.id === elementId)?.locusId
    if (locusId) {
      opened.add(locusId)
      saveOpen(opened)
    }
    toast(`Moved to ${placeName(target)}`)
    await update()
    tree.querySelector<HTMLElement>(`[data-note="${noteId}"]`)?.classList.add('nt-moved')
  }

  async function noteMenu(noteId: string) {
    const note = notes.find((n) => n.id === noteId)
    if (!note) return
    const choice = await openSheet<'move' | 'delete'>('Note', (api) => ({
      content: [
        h('h2', {}, noteTitle(note)),
        h(
          'div',
          { class: 'type-options' },
          h('button', { type: 'button', class: 'type-option', onclick: () => api.close('move') }, h('span', {}, h('strong', {}, 'Move to…'), h('span', { class: 'type-desc' }, 'Misc, or a locus. Dragging the note works too.'))),
        ),
        sheetActions(button('Delete', () => api.close('delete'), 'danger-text'), button('Cancel', () => api.close(null))),
      ],
    }))
    if (choice === 'move') {
      const target = await chooseTarget(note)
      if (target) await moveTo(note.id, target)
    }
    if (choice === 'delete' && (await confirmDelete(`Delete “${noteTitle(note)}”?`, 'Its attachments go too.'))) {
      await deleteNote(note.id)
      await update()
    }
  }

  // Misc, or a locus; a locus with several notebooks lists each.
  function chooseTarget(note: Note): Promise<Target | null> {
    const option = (target: Target, label: string, color: string | null, current: boolean) =>
      h(
        'button',
        { type: 'button', class: 'type-option move-option', disabled: current, style: color ? { '--c': color } : {}, onclick: () => api?.close(target) },
        color ? h('span', { class: 'dot' }) : noteIcon(),
        h('span', {}, h('strong', {}, label), current && h('span', { class: 'type-desc' }, 'It’s here now')),
      )
    let api: { close(value: Target | null): void } | undefined
    const options = [option('loose', 'Misc', null, note.elementId === LOOSE)]
    for (const locus of loci) {
      const own = books.filter((b) => b.locusId === locus.id)
      if (own.length > 1) for (const b of own) options.push(option(`book:${b.id}`, `${locus.name} › ${b.title}`, locus.color, note.elementId === b.id))
      else options.push(option(`locus:${locus.id}`, locus.name, locus.color, own[0]?.id === note.elementId))
    }
    return openSheet<Target>('Move to', (a) => {
      api = a
      return { content: [h('h2', {}, 'Move to'), h('div', { class: 'type-options' }, options), sheetActions(null, button('Cancel', () => a.close(null)))] }
    })
  }

  // ---------- Dragging ----------

  function targetAt(x: number, y: number): HTMLElement | null {
    return (document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop]') as HTMLElement | null) ?? null
  }

  function setOver(p: Press, over: HTMLElement | null) {
    if (p.over === over) return
    p.over?.classList.remove('nt-over')
    clearTimeout(p.hoverTimer)
    p.over = over ?? undefined
    if (!over) return
    over.classList.add('nt-over')
    // Held over a folded locus: open it, so a notebook inside can be picked.
    const target = over.dataset.drop!
    if (target.startsWith('locus:') && !opened.has(target.slice(6))) {
      p.hoverTimer = window.setTimeout(() => {
        opened.add(target.slice(6))
        saveOpen(opened)
        render()
        p.over = undefined
        setOver(p, targetAt(p.x, p.y))
      }, OPEN_ON_HOVER_MS)
    }
  }

  function startDrag(p: Press) {
    clearTimeout(p.timer)
    p.dragging = true
    p.row.classList.remove('nt-armed')
    p.row.classList.add('nt-dragging')
    const title = p.row.querySelector('.nt-note-title')?.textContent ?? ''
    p.ghost = h('div', { class: 'nt-ghost' }, noteIcon(), h('span', {}, title))
    document.body.append(p.ghost)
    requestAnimationFrame(scrollLoop)
  }

  function follow(p: Press) {
    p.ghost!.style.transform = `translate(${p.x + 12}px, ${p.y + 12}px)`
    setOver(p, targetAt(p.x, p.y))
  }

  // Near the top or bottom edge, the screen scrolls under the dragged note.
  function scrollLoop() {
    const p = press
    if (!p?.dragging) return
    const box = el.getBoundingClientRect()
    const speed = p.y < box.top + EDGE ? -(box.top + EDGE - p.y) / 4 : p.y > box.bottom - EDGE ? (p.y - (box.bottom - EDGE)) / 4 : 0
    if (speed) {
      el.scrollTop += speed
      setOver(p, targetAt(p.x, p.y))
    }
    requestAnimationFrame(scrollLoop)
  }

  function onMove(e: PointerEvent) {
    const p = press
    if (!p || e.pointerId !== p.pointerId) return
    p.x = e.clientX
    p.y = e.clientY
    if (!p.dragging) {
      if (Math.hypot(p.x - p.startX, p.y - p.startY) <= MOVE_THRESHOLD) return
      if (p.pointerType !== 'mouse' && !p.armed) {
        // A swipe before the long-press: the page is scrolling, not a drag.
        finish(null)
        return
      }
      startDrag(p)
    }
    follow(p)
  }

  // Once a note is armed or dragging, a touch must not scroll the page.
  function onTouchMove(e: TouchEvent) {
    if (press && (press.armed || press.dragging)) e.preventDefault()
  }

  function finish(e: PointerEvent | null) {
    const p = press
    if (!p) return
    press = null
    clearTimeout(p.timer)
    clearTimeout(p.hoverTimer)
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
    document.removeEventListener('touchmove', onTouchMove)
    p.row.classList.remove('nt-armed', 'nt-dragging')
    p.over?.classList.remove('nt-over')
    p.ghost?.remove()
    if (p.dragging) {
      swallowClick = true
      const target = e?.type === 'pointerup' ? p.over?.dataset.drop : undefined
      if (target) void moveTo(p.noteId, target)
      else if (stale) void update()
      else render() // the dragged row goes back to being drawn like the others
      stale = false
    } else if (p.armed && e?.type === 'pointerup') {
      swallowClick = true
      void noteMenu(p.noteId)
    }
  }
  const onUp = (e: PointerEvent) => press?.pointerId === e.pointerId && finish(e)
  const onCancel = (e: PointerEvent) => press?.pointerId === e.pointerId && finish(null)

  tree.addEventListener('pointerdown', (e) => {
    swallowClick = false
    const row = (e.target as HTMLElement).closest<HTMLElement>('.nt-note')
    if (!row || press || e.button !== 0) return
    press = {
      noteId: row.dataset.note!,
      row,
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      armed: false,
      dragging: false,
      timer: window.setTimeout(() => {
        if (!press || press.dragging) return
        press.armed = true
        row.classList.add('nt-armed')
        navigator.vibrate?.(15)
      }, LONG_PRESS_MS),
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    document.addEventListener('touchmove', onTouchMove, { passive: false })
  })

  tree.addEventListener(
    'click',
    (e) => {
      if (!swallowClick) return
      swallowClick = false
      e.preventDefault()
      e.stopImmediatePropagation()
    },
    true,
  )

  tree.addEventListener('contextmenu', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.nt-note')
    if (!row) return
    e.preventDefault()
    // Touch long-press is handled by the timer; this is a mouse right-click.
    if (!press) void noteMenu(row.dataset.note!)
  })

  const el = h(
    'div',
    { class: 'notes-screen' },
    h(
      'header',
      { class: 'locus-header' },
      h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: () => back() }, backIcon()),
      h('div', { class: 'locus-title' }, h('span', { class: 'header-kicker' }, 'Every locus'), h('h1', {}, 'Notes')),
    ),
    h(
      'main',
      { class: 'locus-body' },
      h('div', { class: 'deck-toolbar' }, stats, h('div', { class: 'deck-actions' }, button('New note', () => void newNote(null), 'primary'))),
      search,
      tree,
    ),
  )

  return { el, update }
}
