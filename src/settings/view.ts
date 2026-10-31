// The Settings screen (⋯ on home): number format, study tasks, sync, storage, stats, backup.
// Study settings (priority, desired retention) live with each locus, in its sheet.

import { h } from '../dom'
import { backIcon } from '../icons'
import { count, deviceLocale, formatBytes, formatNumber, getNumberFormat, type NumberFormatPref, setNumberFormat } from '../locale'
import { back } from '../router'
import { blobBytes } from '../store/attachments'
import { setSplitStudyTasks, splitStudyTasks } from '../study/tasks'
import { backupSection } from './backup'
import { statsSection } from './stats'
import { syncSection } from './sync'

// `onImported` runs after a backup was imported or this device joined sync: the
// app should reload what it shows.
export async function renderSettingsScreen(onImported: () => void): Promise<HTMLElement> {
  return h(
    'div',
    { class: 'settings-screen' },
    h('header', { class: 'locus-header' }, h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: () => back() }, backIcon()), h('div', { class: 'locus-title' }, h('span', { class: 'header-kicker' }, 'Loci'), h('h1', {}, 'Settings'))),
    h('main', { class: 'locus-body' }, numbersSection(), await studySection(), syncSection(onImported), await storageSection(), await statsSection(), backupSection(onImported)),
  )
}

function numbersSection(): HTMLElement {
  const example = h('p', { class: 'settings-note' })
  const deviceExample = new Intl.NumberFormat(deviceLocale()).format(1234.5)
  const options: { value: NumberFormatPref; label: string }[] = [
    { value: 'auto', label: `Auto (${deviceExample})` },
    { value: 'dot', label: '1,234.5' },
    { value: 'comma', label: '1.234,5' },
  ]

  function showExample() {
    example.textContent = `Numbers look like ${formatNumber(1234.5)} and ${formatNumber(0.75, { style: 'percent' })}.`
  }

  const buttons = options.map((o) =>
    h(
      'button',
      {
        type: 'button',
        class: 'segment',
        role: 'radio',
        'aria-checked': String(getNumberFormat() === o.value),
        onclick: async () => {
          await setNumberFormat(o.value)
          buttons.forEach((b, i) => b.setAttribute('aria-checked', String(options[i].value === o.value)))
          showExample()
        },
      },
      o.label,
    ),
  )
  showExample()
  return h(
    'section',
    { class: 'settings-section' },
    h('h2', {}, 'Number format'),
    h('p', { class: 'settings-text' }, 'How numbers are shown and typed everywhere in Loci. Auto follows this device. Dates follow the device too.'),
    h('div', { class: 'segments segments-3', role: 'radiogroup', 'aria-label': 'Number format' }, buttons),
    example,
  )
}

async function studySection(): Promise<HTMLElement> {
  let split = await splitStudyTasks()
  const options = [
    { value: false, label: 'One per locus' },
    { value: true, label: 'One per deck or set' },
  ]
  const buttons = options.map((o) =>
    h(
      'button',
      {
        type: 'button',
        class: 'segment',
        role: 'radio',
        'aria-checked': String(split === o.value),
        onclick: async () => {
          split = o.value
          await setSplitStudyTasks(split)
          buttons.forEach((b, i) => b.setAttribute('aria-checked', String(options[i].value === split)))
        },
      },
      o.label,
    ),
  )
  return h(
    'section',
    { class: 'settings-section' },
    h('h2', {}, 'Study tasks'),
    h('p', { class: 'settings-text' }, 'Due cards and problems show in Tasks as one Study task per locus, mixing them in one session. Or as one task per deck and problem set.'),
    h('div', { class: 'segments segments-2', role: 'radiogroup', 'aria-label': 'Study tasks' }, buttons),
  )
}

async function storageSection(): Promise<HTMLElement> {
  const estimate = await navigator.storage?.estimate?.().catch(() => undefined)
  const persisted = await navigator.storage?.persisted?.().catch(() => false)
  const files = await blobBytes()
  const status = h('p', { class: 'settings-note' })
  const persistButton = h(
    'button',
    {
      type: 'button',
      class: 'btn btn-small',
      onclick: async () => {
        const granted = await navigator.storage?.persist?.().catch(() => false)
        showPersisted(Boolean(granted))
      },
    },
    'Ask to keep it',
  )

  function showPersisted(on: boolean) {
    status.textContent = on
      ? 'This browser keeps Loci’s data even when the device runs low on space.'
      : 'The browser may clear Loci’s data if the device runs very low on space. Installing the app, or asking below, usually prevents that; backups are the sure way.'
    persistButton.hidden = on
  }
  showPersisted(Boolean(persisted))

  return h(
    'section',
    { class: 'settings-section' },
    h('h2', {}, 'Storage'),
    h(
      'p',
      { class: 'settings-text' },
      estimate?.usage != null
        ? `Loci uses ${formatBytes(estimate.usage)}${estimate.quota ? ` of the ${formatBytes(estimate.quota)} this browser allows` : ''}.`
        : 'This browser doesn’t say how much space Loci uses.',
      files.count > 0 ? ` Attached files: ${count(files.count, 'file', 'files')}, ${formatBytes(files.bytes)}.` : '',
    ),
    status,
    persistButton,
  )
}
