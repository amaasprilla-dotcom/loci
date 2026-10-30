// The Sync section of Settings (SPEC-v4-sync.md, "Settings → Sync"): set up sync
// on the first device, join with its key on the others, and see how it's going.

import { h } from '../dom'
import { count } from '../locale'
import { button, openSheet, sheetActions, submitButton } from '../sheet'
import { db } from '../store/db'
import { SyncError, type SyncProblem } from '../sync/client'
import { currentKey, joinSync, onSyncStatus, resetSyncKey, setUpSync, stopSync, syncNow, syncStatus, type SyncStatus } from '../sync/engine'
import { formatKey } from '../sync/rules'
import { formatAgo } from '../time'

// One line on how sync is going, for Settings and the home screen's sync dot.
export function describeSync(s: SyncStatus, now = Date.now()): string {
  if (!s.on) return 'Sync is off.'
  if (s.busy) return 'Syncing…'
  const waiting = s.pending > 0 ? ` ${count(s.pending, 'change', 'changes')} waiting.` : ''
  switch (s.problem) {
    case 'offline':
      return `Offline.${waiting}`
    case 'server':
      return `Can’t reach the sync server; trying again soon.${waiting}`
    case 'wrong-key':
      return 'The sync key was changed on another device. Join again with the new key.'
    case 'not-set-up':
      return 'Sync was reset on the server. Turn it off here, then set it up again.'
    case 'update':
      return `Another device runs a newer Loci. Reload to update and keep syncing.${waiting}`
    case 'unavailable':
      return 'Sync isn’t available at this address. Open Loci at its Cloudflare address.'
  }
  return s.lastSyncAt ? `Synced ${formatAgo(now - s.lastSyncAt)}.` : 'Not synced yet.'
}

const PROBLEM_TEXT: Record<SyncProblem, string> = {
  offline: 'No connection. Try again when you’re online.',
  server: 'The sync server had a problem. Try again in a moment.',
  unavailable: 'Sync isn’t available at this address. Open Loci at its Cloudflare address (….workers.dev) and try there.',
  'wrong-key': 'That key doesn’t match. Check it on the device that has sync on (Settings → Sync → Show sync key).',
  'not-set-up': 'Sync isn’t set up yet. Use Set up sync on your first device.',
  taken: 'Sync is already set up. Use Join with a key instead, with the key from a device that syncs.',
  update: 'Another device runs a newer Loci. Reload this page to update, then try again.',
}

function problemText(err: unknown): string {
  if (err instanceof SyncError) return PROBLEM_TEXT[err.problem]
  console.error(err)
  return 'Something went wrong. Nothing was changed.'
}

// `onJoined` runs after joining (the app should reload what it shows).
export function syncSection(onJoined: () => void): HTMLElement {
  const section = h('section', { class: 'settings-section' })
  let unsubscribe = () => {}
  let attached = false
  let latest: SyncStatus

  function render(s: SyncStatus) {
    latest = s
    // The screen was left: stop listening.
    if (attached && !section.isConnected) return unsubscribe()
    const body: Node[] = [h('h2', {}, 'Sync')]
    if (!s.on) {
      body.push(
        h('p', { class: 'settings-text' }, 'Keep this device in step with your other devices. Changes go through your own Cloudflare account; Loci keeps working offline.'),
        h('div', { class: 'settings-actions' }, button('Set up sync', () => void openSetUpSheet(), 'primary'), button('Join with a key', () => void openJoinSheet(onJoined))),
      )
    } else {
      body.push(h('p', { class: `settings-text${s.problem && s.problem !== 'offline' ? ' sync-problem' : ''}` }, describeSync(s)))
      const actions: Node[] = []
      if (s.problem === 'wrong-key') actions.push(button('Join with the new key', () => void openJoinSheet(onJoined), 'primary'))
      else if (s.problem === 'update') actions.push(button('Reload', () => location.reload(), 'primary'))
      else actions.push(button('Sync now', () => void syncNow({ force: true }), 'primary'))
      actions.push(button('Show sync key', () => void showKey()), button('Stop syncing…', () => void confirmStop()))
      body.push(h('div', { class: 'settings-actions' }, ...actions), h('div', { class: 'settings-actions' }, button('Reset sync key…', () => void confirmReset(), 'danger-text')))
    }
    section.replaceChildren(...body)
  }

  unsubscribe = onSyncStatus(render)
  attached = true
  // "Synced 3 minutes ago" stays true while the screen is open.
  const tick = setInterval(() => (section.isConnected ? render(latest) : clearInterval(tick)), 30_000)
  return section
}

// ---------- Sheets ----------

async function openSetUpSheet(): Promise<void> {
  await openSheet<void>('Set up sync', (api) => {
    const error = h('p', { class: 'sheet-error', role: 'alert' })
    const start = button('Set up sync', () => void run(), 'primary')

    async function run() {
      start.disabled = true
      error.textContent = ''
      try {
        const key = await setUpSync()
        api.show(...keyContent(key, 'Sync is on', () => api.close(null)))
      } catch (err) {
        error.textContent = problemText(err)
        start.disabled = false
      }
    }

    return {
      content: [
        h('h2', {}, 'Set up sync'),
        h('p', { class: 'sheet-text' }, 'Do this on one device. Everything on it is copied to your Cloudflare account, and you get a sync key to enter on your other devices.'),
        error,
        sheetActions(null, button('Cancel', () => api.close(null)), start),
      ],
    }
  })
}

async function openJoinSheet(onJoined: () => void): Promise<void> {
  const hasData = (await db.loci.count()) > 0
  const joined = await openSheet<boolean>('Join with a key', (api) => {
    const input = h('input', {
      class: 'input sync-key-input',
      placeholder: 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX',
      autocomplete: 'off',
      autocapitalize: 'characters',
      spellcheck: false,
      'aria-label': 'Sync key',
    })
    const error = h('p', { class: 'sheet-error', role: 'alert' })

    function askKey() {
      return [
        h('h2', {}, 'Join with a key'),
        h('p', { class: 'sheet-text' }, 'Enter the key from a device that syncs: Settings → Sync → Show sync key.'),
        input,
        error,
        sheetActions(null, button('Cancel', () => api.close(null)), submitButton('Join')),
      ]
    }

    function chooseMode() {
      api.show(
        h('h2', {}, 'This device has its own loci'),
        h(
          'div',
          { class: 'type-options' },
          option('Merge', 'Keep what’s on this device and add it to your synced Loci. Anything on both sides keeps its newer copy.', () => void run('merge')),
          option('Replace this device', 'Throw away what’s on this device and use your synced Loci.', confirmReplace),
        ),
        sheetActions(null, button('Back', () => api.show(...askKey()))),
      )
    }

    function confirmReplace() {
      api.show(
        h('h2', {}, 'Replace everything on this device?'),
        h('p', { class: 'sheet-text' }, 'Everything on this device is deleted and replaced with your synced Loci. This can’t be undone.'),
        sheetActions(null, button('Back', chooseMode), button('Replace', () => void run('replace'), 'danger')),
      )
    }

    async function run(mode: 'merge' | 'replace') {
      api.show(h('h2', {}, 'Joining…'), h('p', { class: 'sheet-text' }, 'Bringing in your synced Loci.'))
      try {
        await joinSync(input.value, mode)
        api.close(true)
      } catch (err) {
        api.show(...askKey())
        error.textContent = problemText(err)
      }
    }

    return {
      content: askKey(),
      focus: input,
      onSubmit: () => {
        error.textContent = ''
        if (input.value.trim() === '') return
        if (hasData) chooseMode()
        else void run('merge')
      },
    }
  })
  if (joined) onJoined()
}

function keyContent(key: string, title: string, done: () => void): Node[] {
  const copy = button('Copy', () => {
    navigator.clipboard
      ?.writeText(formatKey(key))
      .then(() => (copy.textContent = 'Copied'))
      .catch(() => (copy.textContent = 'Select and copy it'))
  })
  return [
    h('h2', {}, title),
    h('p', { class: 'sheet-text' }, 'Enter this key on your other devices (Settings → Sync → Join with a key).'),
    h('p', { class: 'sync-key' }, formatKey(key)),
    h('p', { class: 'sheet-text' }, 'Anyone with it can read and change your Loci, so keep it private.'),
    sheetActions(copy, button('Done', done, 'primary')),
  ]
}

async function showKey(): Promise<void> {
  const key = await currentKey()
  if (!key) return
  await openSheet<void>('Sync key', (api) => ({ content: keyContent(key, 'Your sync key', () => api.close(null)) }))
}

async function confirmStop(): Promise<void> {
  const { pending } = syncStatus()
  await openSheet<void>('Stop syncing', (api) => ({
    content: [
      h('h2', {}, 'Stop syncing on this device?'),
      h(
        'p',
        { class: 'sheet-text' },
        `Your Loci stays on this device; it just stops syncing.${pending > 0 ? ` ${count(pending, 'change', 'changes')} not sent yet won’t be sent.` : ''} You can join again later with the key.`,
      ),
      sheetActions(null, button('Keep syncing', () => api.close(null)), button('Stop', () => void stopSync().then(() => api.close(null)), 'danger')),
    ],
  }))
}

async function confirmReset(): Promise<void> {
  await openSheet<void>('Reset sync key', (api) => {
    const error = h('p', { class: 'sheet-error', role: 'alert' })
    async function run() {
      try {
        const key = await resetSyncKey()
        api.show(...keyContent(key, 'Your new sync key', () => api.close(null)))
      } catch (err) {
        error.textContent = problemText(err)
      }
    }
    return {
      content: [
        h('h2', {}, 'Make a new sync key?'),
        h('p', { class: 'sheet-text' }, 'The old key stops working at once. Every other device has to join again with the new one. Your synced Loci stays as it is.'),
        error,
        sheetActions(null, button('Cancel', () => api.close(null)), button('Make a new key', () => void run(), 'danger')),
      ],
    }
  })
}

function option(title: string, description: string, onclick: () => void): HTMLElement {
  return h('button', { type: 'button', class: 'type-option', onclick }, h('span', {}, h('strong', {}, title), h('span', { class: 'type-desc' }, description)))
}
