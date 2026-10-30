// The Backup section of Settings: export everything to one .zip file, or import
// one (or an older .json) by merging it in or replacing everything. With sync on,
// an import is synced like any other change.

import { h } from '../dom'
import { count } from '../locale'
import { button, openSheet, sheetActions } from '../sheet'
import { type Backup, BackupError, backupFileName, backupToZip, describeBackup, exportBackup, importBackup, type ImportSummary, readBackupFile } from '../store/backup'
import { db } from '../store/db'
import { syncStatus } from '../sync/engine'
import { formatAgo } from '../time'

const LAST_EXPORT_KEY = 'loci.lastExport'

function lastExport(): number | null {
  try {
    const v = Number(localStorage.getItem(LAST_EXPORT_KEY))
    return v > 0 ? v : null
  } catch {
    return null
  }
}

function rememberExport(at: number) {
  try {
    localStorage.setItem(LAST_EXPORT_KEY, String(at))
  } catch {
    // Not remembered; the export itself still happened.
  }
}

function download(file: Blob, name: string) {
  const url = URL.createObjectURL(file)
  const a = h('a', { href: url, download: name })
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

// `onImported` runs after data was imported (the app should reload what it shows).
export function backupSection(onImported: () => void): HTMLElement {
  const lastLine = h('p', { class: 'settings-note' })
  const error = h('p', { class: 'sheet-error', role: 'alert' })
  const fileInput = h('input', { type: 'file', accept: '.zip,.json,application/zip,application/json', hidden: true, onchange: () => void readFile() })
  const exportButton = button('Export backup', () => void doExport(), 'primary')

  function showLast() {
    const at = lastExport()
    lastLine.textContent = at ? `Last exported ${formatAgo(Date.now() - at)}.` : 'Not exported from this device yet.'
  }

  async function doExport() {
    exportButton.disabled = true
    try {
      const backup = await exportBackup()
      download(await backupToZip(backup), backupFileName(backup.exportedAt))
      rememberExport(backup.exportedAt)
      showLast()
    } finally {
      exportButton.disabled = false
    }
  }

  async function readFile() {
    const file = fileInput.files?.[0]
    fileInput.value = '' // choosing the same file again still fires change
    if (!file) return
    error.textContent = ''
    let backup: Backup
    try {
      backup = await readBackupFile(file)
    } catch (err) {
      error.textContent = err instanceof BackupError ? err.message : 'That file couldn’t be read.'
      return
    }
    if (await openImportSheet(backup)) onImported()
  }

  showLast()
  return h(
    'section',
    { class: 'settings-section' },
    h('h2', {}, 'Backup'),
    h(
      'p',
      { class: 'settings-text' },
      syncStatus().on
        ? 'Sync keeps your devices and your Cloudflare account in step. A backup file is a copy that’s yours alone, outside both: export one now and then. Attached files are included.'
        : 'Everything is stored only on this device. Export a backup file now and then; it’s also how you move your loci between phone and computer without sync. Attached files are included.',
    ),
    lastLine,
    error,
    fileInput,
    h('div', { class: 'settings-actions' }, exportButton, button('Import…', () => fileInput.click())),
  )
}

// Merge or replace, then a summary. Resolves true if anything was imported.
function openImportSheet(backup: Backup): Promise<boolean | null> {
  return openSheet<boolean>('Import backup', (api) => {
    // With sync on, an import reaches every synced device (SPEC-v4-sync.md, "Backups still work").
    const synced = syncStatus().on

    function chooseMode() {
      const from = backup.exportedAt ? ` from ${new Date(backup.exportedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}` : ''
      return [
        h('h2', {}, 'Import backup'),
        h('p', { class: 'sheet-text' }, `This backup${from} has ${describeBackup(backup)}.`),
        h(
          'div',
          { class: 'type-options' },
          option('Merge', `Add what’s new, and keep the newer copy of anything on both. Nothing here is lost.${synced ? ' Your synced devices get the result too.' : ''}`, () => void run('merge')),
          option('Replace everything', synced ? 'Delete everything on this device and every synced device, and use the backup instead.' : 'Delete everything on this device and use the backup instead.', () => void confirmReplace()),
        ),
        sheetActions(null, button('Cancel', () => api.close(null))),
      ]
    }

    async function confirmReplace() {
      const here = { loci: await db.loci.toArray(), elements: await db.elements.toArray(), cards: await db.cards.toArray(), blobs: await db.blobs.toCollection().primaryKeys() }
      api.show(
        h('h2', {}, synced ? 'Replace everything on every device?' : 'Replace everything on this device?'),
        h(
          'p',
          { class: 'sheet-text' },
          `This deletes the ${describeBackup(here)} on this device${synced ? ' and your other synced devices' : ''} and puts the backup’s ${describeBackup(backup)} in their place. This can’t be undone.`,
        ),
        sheetActions(null, button('Keep it', () => api.show(...chooseMode())), button('Replace', () => void run('replace'), 'danger')),
      )
    }

    async function run(mode: 'merge' | 'replace') {
      let summary: ImportSummary
      try {
        summary = await importBackup(backup, mode)
      } catch (err) {
        console.error(err)
        api.show(h('h2', {}, 'Import failed'), h('p', { class: 'sheet-text' }, 'Nothing was changed.'), sheetActions(null, button('Close', () => api.close(null))))
        return
      }
      api.show(
        h('h2', {}, mode === 'merge' ? 'Backup merged' : 'Backup restored'),
        h('p', { class: 'sheet-text' }, describeSummary(summary)),
        sheetActions(null, button('Done', () => api.close(true), 'primary')),
      )
    }

    return { content: chooseMode() }
  })
}

function option(title: string, description: string, onclick: () => void): HTMLElement {
  return h('button', { type: 'button', class: 'type-option', onclick }, h('span', {}, h('strong', {}, title), h('span', { class: 'type-desc' }, description)))
}

function describeSummary(s: ImportSummary): string {
  const part = (n: number, one: string, many: string) => (n > 0 ? count(n, one, many) : '')
  const list = (key: 'added' | 'updated') =>
    [
      part(s.loci[key], 'locus', 'loci'),
      part(s.elements[key], 'element', 'elements'),
      part(s.cards[key], 'card', 'cards'),
      part(s.reviews[key], 'review', 'reviews'),
      part(s.attachments[key], 'attachment', 'attachments'),
    ]
      .filter(Boolean)
      .join(', ')
  const added = list('added')
  const updated = list('updated')
  if (!added && !updated) return 'Everything in the backup was already here.'
  return [added && `Added ${added}.`, updated && `Updated ${updated}.`].filter(Boolean).join(' ')
}
