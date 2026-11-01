// The attachment strip (SPEC-v2.md, "Attachments (shared)"): the links and files on
// a note, to-do or goal. Tap opens one; long-press (or right-click) renames or
// removes it. Files over 25 MB ask first, since they fill the device's storage.

import { inAndroidApp, openOnPhone } from './android'
import { h } from './dom'
import { count, formatBytes } from './locale'
import { onLongPress } from './press'
import { button, deleteConfirmation, openSheet, sheetActions, submitButton } from './sheet'
import {
  addFileAttachment,
  addLinkAttachment,
  deleteAttachment,
  getBlob,
  LARGE_FILE_BYTES,
  linkLabel,
  listAttachments,
  normalizeUrl,
  type Owner,
  renameAttachment,
} from './store/attachments'
import { onRemoteChanges, syncStatus } from './sync/engine'
import { onFileArrived } from './sync/files'
import { toast } from './toast'
import type { Attachment, AttachmentKind } from './types'

const KIND_ICONS: Record<AttachmentKind, string> = {
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M20.5 16l-5-5-8 8.5"/>',
  audio: '<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2.5"/><path d="M16 10.5l5-3v9l-5-3"/>',
  pdf: '<path d="M7 3.5h7l4.5 4.5v12.5h-11.5z"/><path d="M14 3.5V8h4.5M9.5 13h5M9.5 16.5h5"/>',
  file: '<path d="M7 3.5h7l4.5 4.5v12.5h-11.5z"/><path d="M14 3.5V8h4.5"/>',
}

function kindIcon(kind: AttachmentKind): HTMLElement {
  const span = h('span', { class: 'attachment-icon' })
  // Our own constant markup, never user text.
  span.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${KIND_ICONS[kind]}</svg>`
  return span
}

// The warning before adding large files (here and in the note editor).
export function largeFilesText(files: { name: string; size: number }[]): string {
  const list = files.map((f) => `${f.name} (${formatBytes(f.size)})`).join(', ')
  return syncStatus().on
    ? `${list}. Large files fill up this device’s storage, are copied to every device you sync, and make backups big. Add anyway?`
    : `${list}. Large files fill up this device’s storage, and backups get big. Add anyway?`
}

export interface AttachmentStrip {
  el: HTMLElement
  refresh(): Promise<void> // after attachments were added elsewhere (e.g. dropped into a note)
}

export function attachmentStrip(owner: Owner): AttachmentStrip {
  const list = h('div', { class: 'attachment-list' })
  const fileInput = h('input', { type: 'file', multiple: true, hidden: true, onchange: () => void addFiles() })
  let urls: string[] = [] // object URLs for thumbnails, released on every redraw
  // Files whose bytes are still coming from another device: drawn again when they arrive.
  const downloading = new Set<string>()
  const stopListening = onFileArrived((blobId) => {
    if (!list.isConnected) return stopListening()
    if (downloading.has(blobId)) void render()
  })
  // Attachments added or removed on another device show here even while the
  // owner is open in an editor (which isn't redrawn as a whole).
  const stopRemote = onRemoteChanges((records) => {
    if (!list.isConnected) return stopRemote()
    if (records.some((r) => r.table === 'attachments')) void render()
  })

  async function render() {
    urls.forEach((u) => URL.revokeObjectURL(u))
    urls = []
    const items = (await listAttachments(owner)).filter((a) => !a.inline)
    downloading.clear()
    list.replaceChildren(...(await Promise.all(items.map(chip))))
    list.hidden = items.length === 0
  }

  async function chip(a: Attachment): Promise<HTMLElement> {
    let thumb: HTMLElement = kindIcon(a.kind)
    const blob = a.blobId ? await getBlob(a.blobId) : null
    if (a.blobId && !blob) downloading.add(a.blobId)
    if (a.kind === 'image' && blob) {
      const url = URL.createObjectURL(blob)
      urls.push(url)
      thumb = h('img', { class: 'attachment-thumb', src: url, alt: '' })
    }
    const label = a.kind === 'link' ? linkLabel(a) : a.name
    // A titled link shows its domain underneath; an untitled one already shows the
    // domain as its name, so underneath goes the rest of the address.
    const detail = a.kind === 'link' ? (a.name ? hostOf(a.url) : pathOf(a.url)) : a.blobId && !blob ? 'Downloading…' : a.size != null ? formatBytes(a.size) : ''
    const node = h(
      'button',
      { type: 'button', class: 'attachment', title: label, onclick: () => void open(a) },
      thumb,
      h('span', { class: 'attachment-text' }, h('span', { class: 'attachment-name' }, label), detail && h('span', { class: 'attachment-detail' }, detail)),
    )
    onLongPress(node, () => void edit(a))
    return node
  }

  async function open(a: Attachment) {
    if (a.kind === 'link' && a.url) {
      window.open(a.url, '_blank', 'noopener,noreferrer')
      return
    }
    const blob = a.blobId ? await getBlob(a.blobId) : null
    if (!blob) {
      toast('Still downloading from another device')
      return
    }
    // In the Android app, files open in another app (a PDF viewer, Photos).
    if (inAndroidApp) {
      if (!(await openOnPhone(blob, a.name))) toast('No app on this phone opens that file')
      return
    }
    const url = URL.createObjectURL(blob)
    // Images, PDFs, audio and video open in a tab; other files are saved.
    const link = h('a', { href: url, target: '_blank', rel: 'noopener', ...(a.kind === 'file' && { download: a.name }) })
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  async function edit(a: Attachment) {
    const changed = await openSheet<boolean>(a.kind === 'link' ? 'Edit link' : 'Edit file', (api) => {
      const name = h('input', { class: 'input', type: 'text', maxlength: 200, 'aria-label': 'Name', placeholder: a.kind === 'link' ? linkLabel({ name: '', url: a.url }) : '' })
      name.value = a.name
      const form = [
        h('h2', {}, a.kind === 'link' ? 'Edit link' : 'Edit file'),
        a.url ? h('p', { class: 'sheet-text attachment-url' }, a.url) : null,
        h('label', { class: 'field-label' }, a.kind === 'link' ? 'Title' : 'Name', name),
        sheetActions(
          button('Remove', () => api.show(...deleteConfirmation(`Remove “${linkLabel(a)}”?`, '', () => api.show(...form), async () => {
            await deleteAttachment(a.id)
            api.close(true)
          })), 'danger-text'),
          button('Cancel', () => api.close(null)),
          submitButton('Save'),
        ),
      ]
      return {
        content: form,
        onSubmit: async () => {
          await renameAttachment(a.id, name.value)
          api.close(true)
        },
      }
    })
    if (changed) await render()
  }

  async function addLink() {
    const added = await openSheet<boolean>('Add link', (api) => {
      const url = h('input', { class: 'input', type: 'text', inputmode: 'url', autocapitalize: 'off', spellcheck: 'false', placeholder: 'example.com/page', 'aria-label': 'Address', autocomplete: 'off' })
      const title = h('input', { class: 'input', type: 'text', maxlength: 200, placeholder: 'Optional', 'aria-label': 'Title' })
      const error = h('p', { class: 'sheet-error', role: 'alert' })
      return {
        content: [
          h('h2', {}, 'Add link'),
          h('label', { class: 'field-label' }, 'Address', url),
          h('label', { class: 'field-label' }, 'Title', title),
          error,
          sheetActions(null, button('Cancel', () => api.close(null)), submitButton('Add')),
        ],
        onSubmit: async () => {
          if (!normalizeUrl(url.value)) {
            error.textContent = 'That doesn’t look like a web address.'
            return
          }
          await addLinkAttachment(owner, url.value, title.value)
          api.close(true)
        },
        focus: url,
      }
    })
    if (added) await render()
  }

  async function addFiles() {
    const files = [...(fileInput.files ?? [])]
    fileInput.value = ''
    const large = files.filter((f) => f.size > LARGE_FILE_BYTES)
    if (large.length > 0) {
      const ok = await openSheet<boolean>('Large file', (api) => ({
        content: [
          h('h2', {}, large.length === 1 ? 'This file is large' : `${count(large.length, 'file is', 'files are')} large`),
          h('p', { class: 'sheet-text' }, largeFilesText(large)),
          sheetActions(null, button('Cancel', () => api.close(false)), button('Add anyway', () => api.close(true), 'primary')),
        ],
      }))
      if (!ok) return
    }
    for (const f of files) await addFileAttachment(owner, f)
    await render()
  }

  void render()
  const el = h(
    'div',
    { class: 'attachments' },
    list,
    fileInput,
    h(
      'div',
      { class: 'attachment-actions' },
      h('button', { type: 'button', class: 'btn btn-small', onclick: () => void addLink() }, 'Add link'),
      h('button', { type: 'button', class: 'btn btn-small', onclick: () => fileInput.click() }, 'Add file'),
    ),
  )
  return { el, refresh: render }
}

function pathOf(url?: string): string {
  try {
    const u = new URL(url ?? '')
    const rest = `${u.pathname}${u.search}`
    return rest === '/' ? '' : rest
  } catch {
    return ''
  }
}

function hostOf(url?: string): string {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '') : ''
  } catch {
    return ''
  }
}
