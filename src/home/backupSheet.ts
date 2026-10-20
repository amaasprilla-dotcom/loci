// The Backup sheet (from the ⋯ button on home): export everything to a file,
// or import a file by merging it in or replacing everything.

import { h } from '../dom'
import { button, openSheet, sheetActions } from '../sheet'
import { type Backup, BackupError, backupFileName, describeBackup, exportBackup, importBackup, type ImportSummary, parseBackup } from '../store/backup'
import { db } from '../store/db'
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

function download(backup: Backup) {
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = h('a', { href: url, download: backupFileName(backup.exportedAt) })
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

// Resolves true if data was imported (the app should reload what it shows).
export function openBackupSheet(): Promise<boolean | null> {
  return openSheet<boolean>('Backup', (api) => {
    const lastLine = h('p', { class: 'sheet-note' })
    const error = h('p', { class: 'sheet-error', role: 'alert' })
    const fileInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: () => void readFile() })

    function showLast() {
      const at = lastExport()
      lastLine.textContent = at ? `Last exported ${formatAgo(Date.now() - at)}.` : 'Not exported from this device yet.'
    }

    async function doExport() {
      const backup = await exportBackup()
      download(backup)
      rememberExport(backup.exportedAt)
      showLast()
    }

    async function readFile() {
      const file = fileInput.files?.[0]
      fileInput.value = '' // choosing the same file again still fires change
      if (!file) return
      error.textContent = ''
      try {
        chooseMode(parseBackup(await file.text()))
      } catch (err) {
        error.textContent = err instanceof BackupError ? err.message : 'That file couldn’t be read.'
      }
    }

    function chooseMode(backup: Backup) {
      const from = backup.exportedAt ? ` from ${new Date(backup.exportedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}` : ''
      api.show(
        h('h2', {}, 'Import backup'),
        h('p', { class: 'sheet-text' }, `This backup${from} has ${describeBackup(backup)}.`),
        h(
          'div',
          { class: 'type-options' },
          h(
            'button',
            { type: 'button', class: 'type-option', onclick: () => void run(backup, 'merge') },
            h(
              'span',
              {},
              h('strong', {}, 'Merge'),
              h('span', { class: 'type-desc' }, 'Add what’s new, and keep the newer copy of anything on both. Nothing here is lost.'),
            ),
          ),
          h(
            'button',
            { type: 'button', class: 'type-option', onclick: () => void confirmReplace(backup) },
            h(
              'span',
              {},
              h('strong', {}, 'Replace everything'),
              h('span', { class: 'type-desc' }, 'Delete everything on this device and use the backup instead.'),
            ),
          ),
        ),
        sheetActions(null, button('Cancel', () => api.close(null))),
      )
    }

    async function confirmReplace(backup: Backup) {
      const here = { loci: await db.loci.toArray(), elements: await db.elements.toArray(), cards: await db.cards.toArray() }
      api.show(
        h('h2', {}, 'Replace everything on this device?'),
        h('p', { class: 'sheet-text' }, `This deletes the ${describeBackup(here)} on this device and puts the backup’s ${describeBackup(backup)} in their place. This can’t be undone.`),
        sheetActions(null, button('Keep it', () => chooseMode(backup)), button('Replace', () => void run(backup, 'replace'), 'danger')),
      )
    }

    async function run(backup: Backup, mode: 'merge' | 'replace') {
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

    showLast()
    return {
      content: [
        h('h2', {}, 'Backup'),
        h(
          'p',
          { class: 'sheet-text' },
          'Everything is stored only on this device. Export a backup file now and then; it’s also how you move your loci between phone and computer.',
        ),
        lastLine,
        error,
        fileInput,
        sheetActions(null, button('Import…', () => fileInput.click()), button('Export backup', () => void doExport(), 'primary')),
      ],
    }
  })
}

function describeSummary(s: ImportSummary): string {
  const part = (n: number, one: string, many: string) => (n > 0 ? `${n.toLocaleString()} ${n === 1 ? one : many}` : '')
  const list = (key: 'added' | 'updated') =>
    [part(s.loci[key], 'locus', 'loci'), part(s.elements[key], 'element', 'elements'), part(s.cards[key], 'card', 'cards'), part(s.reviews[key], 'review', 'reviews')]
      .filter(Boolean)
      .join(', ')
  const added = list('added')
  const updated = list('updated')
  if (!added && !updated) return 'Everything in the backup was already here.'
  return [added && `Added ${added}.`, updated && `Updated ${updated}.`].filter(Boolean).join(' ')
}
