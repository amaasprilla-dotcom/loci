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
import { db, getElement, requestPersistentStorage } from './store/db'
import { allTasks } from './tasks/tasks'
import { createTasksScreen } from './tasks/view'
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

async function show(route: Route): Promise<void> {
  const from = shown

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
    // After an import, start the app over so every screen shows the imported data.
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

  if (route.name === 'element') {
    const el = await getElement(route.elementId)
    const type = el && registry.get(el.type)
    const locus = await db.loci.get(route.locusId)
    if (!el || !type || !locus || el.locusId !== locus.id) {
      location.replace(parentOf(route)) // deleted, or a bad link
      return
    }
    shown = route
    const view = await type.renderScreen(el)
    setHomeVisible(false)
    setThemeColor(locus.color)
    screenLayer.replaceChildren(view)
    if (motionAllowed()) await fadeIn(view)
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
  screenLayer.replaceChildren(view)
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
    .catch((err) => console.error(err))
}

// While the app is open, refresh every minute; when it comes back to the front, at once.
setInterval(() => {
  if (document.visibilityState === 'visible') void refreshTasks()
}, REFRESH_MS)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void refreshTasks()
})

window.addEventListener('hashchange', showCurrent)

// Escape goes back on desktop, unless a sheet is open (it closes itself).
document.addEventListener('keydown', (e) => {
  // The review screen handles its own keys, Escape included.
  if (e.key === 'Escape' && shown && shown.name !== 'home' && shown.name !== 'review' && !document.querySelector('.sheet')) back(parentOf(shown))
})

requestPersistentStorage().catch(() => {})
// The number format must be known before anything with numbers is drawn.
loadLocaleSettings()
  .catch((err) => console.error(err))
  .then(() => home.refresh())
  .then(showCurrent)
