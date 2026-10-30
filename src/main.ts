// App boot and routing. The home screen is always in the page; other screens
// cover it in the screen layer.

import '@fontsource-variable/inter'
import './style.css'
import './elements/all'
import { h } from './dom'
import { registry, type Task } from './elements/registry'
import { createHome } from './home/view'
import { loadLocaleSettings } from './locale'
import { renderSettingsScreen } from './settings/view'
import { renderLocusView } from './locus/view'
import { back, currentRoute, go, parentOf, type Route } from './router'
import { onChange } from './changes'
import { tellEditors, isEditing } from './sync/editing'
import { loadSync, onRemoteChanges, startAutoSync } from './sync/engine'
import { toast } from './toast'
import { db, getElement, requestPersistentStorage } from './store/db'
import { allTasks } from './tasks/tasks'
import { createTasksScreen } from './tasks/view'
import { isStaleCodeError, reloadForStaleCode, watchForStaleCode } from './staleCode'
import { coverFor, fadeIn, fadeOut, growFrom, motionAllowed, shrinkInto } from './transition'

const DEFAULT_THEME_COLOR = '#ffffff'
const REFRESH_MS = 60_000 // cards fall due as time passes

const root = document.getElementById('app')!
const home = createHome({
  onOpen: (locus) => go(`#/locus/${encodeURIComponent(locus.id)}`),
  onTasks: () => go('#/tasks'),
  onSettings: () => go('#/settings'),
})
// Ticking a task off changes what's due: refresh everything that shows tasks.
const tasksScreen = createTasksScreen(() => void refreshTasks())
const screenLayer = h('div', { class: 'screen-layer' })
root.append(home.el, screenLayer)

let shown: Route | null = null

// Tasks are worked out fresh each time (SPEC.md: "derived state, never stored")
// and shared: the same list drives the pulsing bubbles, the badge and the Tasks screen.
let tasks: Task[] = []
async function refreshTasks(): Promise<void> {
  tasks = await allTasks(Date.now())
  home.setTasks(tasks)
  if (shown?.name === 'tasks') await tasksScreen.update(tasks)
}

function setHomeVisible(visible: boolean) {
  home.el.style.visibility = visible ? '' : 'hidden'
  home.el.inert = !visible
  if (visible) home.field.resume()
  else home.field.pause()
}

// Tints the Android status bar (and installed-app title bar) to match the screen.
function setThemeColor(color: string) {
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color)
}

// `quiet`: redrawing the screen already showing (changes from another device):
// no transition, and the scroll position stays.
async function show(route: Route, quiet = false): Promise<void> {
  const from = shown
  const scrollTop = quiet ? ((screenLayer.firstElementChild as HTMLElement | null)?.scrollTop ?? 0) : 0
  const place = (view: HTMLElement) => {
    screenLayer.replaceChildren(view)
    if (quiet) view.scrollTop = scrollTop
  }

  if (route.name === 'home') {
    shown = route
    await home.refresh()
    const view = screenLayer.firstElementChild as HTMLElement | null
    // Coming back from a locus (or one of its elements): shrink into its bubble.
    const fromLocusId = from?.name === 'locus' ? from.id : from?.name === 'element' ? from.locusId : undefined
    const bubble = fromLocusId ? home.field.bubble(fromLocusId) : undefined
    if (view && bubble && motionAllowed()) {
      home.field.pause() // hold the bubble still while we shrink into it
      home.el.style.visibility = ''
      const cover = coverFor(bubble, view.style.getPropertyValue('--c'))
      setThemeColor(DEFAULT_THEME_COLOR)
      await fadeOut(view)
      screenLayer.replaceChildren()
      await shrinkInto(bubble, cover)
    } else {
      screenLayer.replaceChildren()
    }
    setThemeColor(DEFAULT_THEME_COLOR)
    setHomeVisible(true)
    return
  }

  if (route.name === 'settings') {
    shown = route
    // After an import or joining sync, start the app over so every screen shows the new data.
    const view = await renderSettingsScreen(() => {
      location.replace('#/')
      location.reload()
    })
    setHomeVisible(false)
    setThemeColor(DEFAULT_THEME_COLOR)
    screenLayer.replaceChildren(view)
    if (motionAllowed()) await fadeIn(view)
    return
  }

  if (route.name === 'tasks') {
    shown = route
    await refreshTasks()
    setHomeVisible(false)
    setThemeColor(DEFAULT_THEME_COLOR)
    screenLayer.replaceChildren(tasksScreen.el)
    if (motionAllowed()) await fadeIn(tasksScreen.el)
    return
  }

  if (route.name === 'review') {
    const el = await getElement(route.elementId)
    const type = el && registry.get(el.type)
    const locus = el && (await db.loci.get(el.locusId))
    if (!el || !type?.renderSession || !locus) {
      location.replace('#/')
      return
    }
    shown = route
    const view = await type.renderSession(el)
    setHomeVisible(false)
    setThemeColor(locus.color)
    screenLayer.replaceChildren(view)
    if (motionAllowed()) await fadeIn(view)
    return
  }

  if (route.name === 'study') {
    const locus = await db.loci.get(route.locusId)
    if (!locus) {
      location.replace('#/')
      return
    }
    shown = route
    const { renderStudyScreen } = await import('./study/screen')
    const view = await renderStudyScreen({ locusId: locus.id, backHash: `#/locus/${encodeURIComponent(locus.id)}`, title: locus.name, chooseLength: true })
    setHomeVisible(false)
    setThemeColor(locus.color)
    screenLayer.replaceChildren(view)
    if (motionAllowed()) await fadeIn(view)
    return
  }

  if (route.name === 'element') {
    const el = await getElement(route.elementId)
    const type = el && registry.get(el.type)
    const locus = await db.loci.get(route.locusId)
    if (!el || !type || !locus || el.locusId !== locus.id) {
      location.replace(parentOf(route)) // deleted, or a bad link
      return
    }
    shown = route
    const view = await type.renderScreen(el, route.sub)
    setHomeVisible(false)
    setThemeColor(locus.color)
    place(view)
    if (motionAllowed() && !quiet) await fadeIn(view)
    return
  }

  const locus = await db.loci.get(route.id)
  if (!locus) {
    location.replace('#/') // deleted, or a bad link
    return
  }
  shown = route
  const view = await renderLocusView(locus, { onBack: () => back() })
  const bubble = from?.name === 'home' ? home.field.bubble(locus.id) : undefined
  let cover: HTMLElement | null = null
  if (bubble && motionAllowed()) {
    home.field.pause()
    cover = await growFrom(bubble, locus.color)
  }
  setHomeVisible(false)
  setThemeColor(locus.color)
  place(view)
  if (cover) {
    await fadeIn(view)
    cover.remove()
  } else if (from?.name === 'element' && motionAllowed()) {
    await fadeIn(view)
  }
}

// Screens change one at a time, so a quick double back can't tangle two transitions.
// Tasks are refreshed after every change of screen, which covers returning home
// and finishing a review.
let queue = Promise.resolve()
function showCurrent() {
  queue = queue
    .then(() => show(currentRoute()))
    .then(refreshTasks)
    .catch((err) => {
      if (isStaleCodeError(err) && reloadForStaleCode()) return
      console.error(err)
    })
}

// While the app is open, refresh every minute; when it comes back to the front, at once.
setInterval(() => {
  if (document.visibilityState === 'visible') void refreshTasks()
}, REFRESH_MS)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void refreshTasks()
})

window.addEventListener('hashchange', showCurrent)
watchForStaleCode()
// An edit in a sheet over any screen (e.g. an exam): the badge and Tasks catch up.
onChange(() => void refreshTasks())

// ---------- Changes from other devices (SPEC-v4-sync.md, "Everywhere else") ----------

// Text typed on this screen and not saved or cleared yet (e.g. a to-do being written):
// a redraw would lose it.
const typedIn = new Set<HTMLInputElement | HTMLTextAreaElement>()
screenLayer.addEventListener('input', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) typedIn.add(e.target)
})

// Redrawing now would get in the user's way: something is being edited, a sheet is
// open, or there's unsaved typing.
function busy(): boolean {
  if (isEditing() || document.querySelector('.sheet')) return true
  const active = document.activeElement
  if (active instanceof HTMLElement && screenLayer.contains(active) && active.matches('input, textarea, select, [contenteditable], math-field')) return true
  for (const field of typedIn) {
    if (!field.isConnected) typedIn.delete(field)
    else if (field.value !== '') return true
  }
  return false
}

let waitingToRedraw: ReturnType<typeof setInterval> | undefined
function redrawWhenFree() {
  clearInterval(waitingToRedraw)
  if (!busy()) {
    queue = queue.then(redrawCurrent).catch((err) => console.error(err))
    return
  }
  waitingToRedraw = setInterval(() => {
    if (busy()) return
    clearInterval(waitingToRedraw)
    redrawWhenFree()
  }, 1000)
}

// The locus and element screens show synced data. Study sessions keep their own
// state, and Tasks and home refresh themselves.
async function redrawCurrent() {
  const route = currentRoute()
  if (!shown || shown.name !== route.name || (route.name !== 'locus' && route.name !== 'element')) return
  const locusId = route.name === 'locus' ? route.id : route.locusId
  const gone = !(await db.loci.get(locusId)) || (route.name === 'element' && !(await getElement(route.elementId)))
  if (gone) toast('Deleted on another device')
  await show(route, true) // a deleted screen sends itself back one level
}

onRemoteChanges((records) => {
  tellEditors(records)
  void home.refresh()
  void refreshTasks()
  redrawWhenFree()
})

// Escape goes back on desktop, unless a sheet is open (it closes itself).
document.addEventListener('keydown', (e) => {
  // Study screens handle their own keys, Escape included.
  if (e.key === 'Escape' && shown && shown.name !== 'home' && shown.name !== 'review' && shown.name !== 'study' && !document.querySelector('.sheet')) back(parentOf(shown))
})

requestPersistentStorage().catch(() => {})
// The number format must be known before anything with numbers is drawn.
// Sync must know whether it's on before anything is written, so every change is recorded.
Promise.all([loadLocaleSettings(), loadSync()])
  .catch((err) => console.error(err))
  .then(() => home.refresh())
  .then(showCurrent)
  .then(startAutoSync)
