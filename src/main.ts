// App boot and routing. The home screen is always in the page; other screens
// cover it in the screen layer.

import '@fontsource-variable/inter'
import './style.css'
import { h } from './dom'
import { createHome } from './home/view'
import { renderLocusView } from './locus/view'
import { back, currentRoute, go, type Route } from './router'
import { db, requestPersistentStorage } from './store/db'
import { coverFor, fadeIn, fadeOut, growFrom, motionAllowed, shrinkInto } from './transition'

const DEFAULT_THEME_COLOR = '#ffffff'

const root = document.getElementById('app')!
const home = createHome({ onOpen: (locus) => go(`#/locus/${encodeURIComponent(locus.id)}`) })
const screenLayer = h('div', { class: 'screen-layer' })
root.append(home.el, screenLayer)

let shown: Route | null = null

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
    const bubble = from?.name === 'locus' ? home.field.bubble(from.id) : undefined
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

  const locus = await db.loci.get(route.id)
  if (!locus) {
    location.replace('#/') // deleted, or a bad link
    return
  }
  shown = route
  const view = await renderLocusView(locus, { onBack: back })
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
  }
}

// Screens change one at a time, so a quick double back can't tangle two transitions.
let queue = Promise.resolve()
function showCurrent() {
  queue = queue.then(() => show(currentRoute())).catch((err) => console.error(err))
}

window.addEventListener('hashchange', showCurrent)

// Escape goes back on desktop, unless a sheet is open (it closes itself).
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && shown?.name !== 'home' && !document.querySelector('.sheet')) back()
})

requestPersistentStorage().catch(() => {})
home.refresh().then(showCurrent)
