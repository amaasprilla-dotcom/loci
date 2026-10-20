// The notebook screen (list, search, new note) and the note editor
// (SPEC-v2.md, "Notes"). Loaded on demand from type.ts.

import 'katex/dist/katex.min.css'
import { Editor } from '@tiptap/core'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Mathematics } from '@tiptap/extension-mathematics'
import { Placeholder } from '@tiptap/extensions'
import StarterKit from '@tiptap/starter-kit'
import { attachmentStrip, type AttachmentStrip } from '../../attachmentStrip'
import { textColorOn } from '../../colors'
import { h } from '../../dom'
import { backIcon, checklistIcon, imageIcon, moreIcon } from '../../icons'
import { linkedItemsSection } from '../../linkedItems'
import { count, formatBytes } from '../../locale'
import { onLongPress } from '../../press'
import { back, elementHash, go, subHash } from '../../router'
import { button, confirmDelete, openSheet, sheetActions } from '../../sheet'
import { addFileAttachment, kindOf, LARGE_FILE_BYTES, linkLabel, normalizeUrl } from '../../store/attachments'
import { db } from '../../store/db'
import { formatAgo } from '../../time'
import type { LocusElement, Note } from '../../types'
import { editMath } from './mathSheet'
import { NoteImage } from './noteImage'
import { createNote, deleteNote, firstLine, listNotes, noteTitle, removeUnusedInlineImages, saveNote, searchNotes, setPinned } from './store'

const AUTOSAVE_MS = 500
const WEEK = 7 * 86_400_000

function when(at: number, now: number): string {
  return now - at < WEEK ? formatAgo(now - at) : new Date(at).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

async function header(el: LocusElement, title: Node, onBack: () => void, ...end: Node[]) {
  const locus = await db.loci.get(el.locusId)
  const color = locus?.color ?? '#0b0f14'
  return {
    color,
    node: h(
      'header',
      { class: 'locus-header', style: { '--c': color, '--fg': textColorOn(color) } },
      h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: onBack }, backIcon()),
      h('div', { class: 'locus-title' }, h('span', { class: 'header-kicker' }, locus?.name ?? ''), title),
      ...end,
    ),
  }
}

// ---------- Notebook ----------

export async function renderNotebook(el: LocusElement): Promise<HTMLElement> {
  const list = h('div', { class: 'card-list note-list' })
  const stats = h('p', { class: 'deck-stats' })
  const search = h('input', {
    class: 'input search',
    type: 'search',
    placeholder: 'Search notes',
    'aria-label': 'Search notes',
    oninput: () => void render(),
  })
  let notes: Note[] = []

  async function reload() {
    notes = await listNotes(el.id)
    await render()
  }

  async function render() {
    const now = Date.now()
    stats.textContent = count(notes.length, 'note', 'notes')
    const shown = searchNotes(notes, search.value)
    if (notes.length === 0) list.replaceChildren(h('p', { class: 'list-empty' }, 'No notes yet. Start one with New note.'))
    else if (shown.length === 0) list.replaceChildren(h('p', { class: 'list-empty' }, 'No notes match.'))
    else list.replaceChildren(...shown.map((n) => noteRow(n, now)))
  }

  function noteRow(n: Note, now: number): HTMLElement {
    const row = h(
      'button',
      { type: 'button', class: 'card-row note-row', onclick: () => go(subHash(el, 'note', n.id)) },
      h(
        'span',
        { class: 'card-text' },
        h('span', { class: 'card-front' }, n.pinned ? h('span', { class: 'pin-mark', 'aria-label': 'Pinned' }, '📌 ') : null, noteTitle(n)),
        h('span', { class: 'card-back' }, firstLine(n) || ' '),
      ),
      h('span', { class: 'card-due' }, when(n.updatedAt, now)),
    )
    onLongPress(row, () => void noteMenu(n))
    return row
  }

  async function noteMenu(n: Note) {
    const choice = await openSheet<'pin' | 'delete'>('Note', (api) => ({
      content: [
        h('h2', {}, noteTitle(n)),
        sheetActions(
          button('Delete', () => api.close('delete'), 'danger-text'),
          button('Cancel', () => api.close(null)),
          button(n.pinned ? 'Unpin' : 'Pin to top', () => api.close('pin'), 'primary'),
        ),
      ],
    }))
    if (choice === 'pin') await setPinned(n.id, !n.pinned)
    if (choice === 'delete' && (await confirmDelete(`Delete “${noteTitle(n)}”?`, 'Its attachments go too.'))) await deleteNote(n.id)
    if (choice) await reload()
  }

  async function newNote() {
    const note = await createNote(el.id)
    go(subHash(el, 'note', note.id))
  }

  const top = await header(el, h('h1', {}, el.title), () => back(`#/locus/${encodeURIComponent(el.locusId)}`))
  const screen = h(
    'div',
    { class: 'deck-screen', style: { '--c': top.color, '--fg': textColorOn(top.color) } },
    top.node,
    h(
      'main',
      { class: 'locus-body' },
      h('div', { class: 'deck-toolbar' }, stats, h('div', { class: 'deck-actions' }, button('New note', () => void newNote(), 'primary'))),
      search,
      list,
    ),
  )
  await reload()
  return screen
}

// ---------- Note editor ----------

export async function renderNoteEditor(el: LocusElement, noteId: string): Promise<HTMLElement> {
  const note = await db.notes.get(noteId)
  if (!note || note.elementId !== el.id) {
    location.replace(elementHash(el)) // deleted, or a bad link
    return h('div')
  }
  const owner = { type: 'note' as const, id: note.id }
  const status = h('span', { class: 'save-status', 'aria-live': 'polite' })
  let pinned = Boolean(note.pinned)

  // ----- Saving: 500 ms after the last change, and whenever the note is left -----
  let timer = 0
  let dirty = false
  let editor: Editor
  const title = h('input', {
    class: 'note-title',
    type: 'text',
    placeholder: 'Title',
    'aria-label': 'Title',
    maxlength: 200,
    oninput: () => changed(),
  })
  title.value = note.title

  function changed() {
    dirty = true
    status.textContent = ''
    clearTimeout(timer)
    timer = window.setTimeout(() => void save(), AUTOSAVE_MS)
  }

  async function save() {
    clearTimeout(timer)
    if (!dirty) return
    dirty = false
    await saveNote(note!.id, { title: title.value.trim(), content: editor.getJSON() })
    status.textContent = 'Saved'
  }

  // ----- Files: images go into the text, anything else into the strip -----
  let strip: AttachmentStrip

  async function addFiles(files: File[], at: number | null) {
    const big = files.filter((f) => f.size > LARGE_FILE_BYTES && kindOf(f.type) !== 'image')
    if (big.length > 0) {
      const ok = await openSheet<boolean>('Large file', (api) => ({
        content: [
          h('h2', {}, 'Large file'),
          h('p', { class: 'sheet-text' }, `${big.map((f) => `${f.name} (${formatBytes(f.size)})`).join(', ')}. Large files fill up this device’s storage, and backups get big. Add anyway?`),
          sheetActions(null, button('Cancel', () => api.close(false)), button('Add anyway', () => api.close(true), 'primary')),
        ],
      }))
      if (!ok) return
    }
    let pos = at
    let others = false
    for (const file of files) {
      if (kindOf(file.type) === 'image') {
        const a = await addFileAttachment(owner, file, { inline: true })
        const node = { type: 'noteImage', attrs: { blobId: a.blobId, alt: file.name } }
        if (pos == null) editor.chain().focus().insertContent(node).run()
        else {
          editor.chain().insertContentAt(pos, node).run()
          pos += 1
        }
      } else {
        await addFileAttachment(owner, file)
        others = true
      }
    }
    if (others) await strip.refresh()
    changed()
  }

  // A pasted web address becomes a link: on the selected text, or showing its domain.
  function pasteLink(text: string): boolean {
    if (/\s/.test(text) || !/^(https?:\/\/|www\.)|^[a-z0-9-]+(\.[a-z0-9-]+)+\//i.test(text)) return false
    const href = normalizeUrl(text)
    if (!href) return false
    if (!editor.state.selection.empty) return editor.chain().focus().setLink({ href }).run()
    editor
      .chain()
      .focus()
      .insertContent([
        { type: 'text', text: linkLabel({ name: '', url: href }), marks: [{ type: 'link', attrs: { href } }] },
        { type: 'text', text: ' ' },
      ])
      .run()
    return true
  }

  // ----- Math -----
  async function mathAt(kind: 'inline' | 'block', latex: string, pos: number | null) {
    const result = await editMath(latex, pos != null, kind)
    if (!result) return
    const c = editor.chain().focus()
    if (result === 'delete') {
      if (pos == null) return
      if (kind === 'inline') c.deleteInlineMath({ pos }).run()
      else c.deleteBlockMath({ pos }).run()
    } else if (pos == null) {
      if (kind === 'inline') c.insertInlineMath({ latex: result.latex }).run()
      else c.insertBlockMath({ latex: result.latex }).run()
    } else if (kind === 'inline') c.updateInlineMath({ latex: result.latex, pos }).run()
    else c.updateBlockMath({ latex: result.latex, pos }).run()
  }

  const body = h('div', { class: 'note-body' })
  editor = new Editor({
    element: body,
    content: note.content as object,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: true, autolink: true, linkOnPaste: false, HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: 'Write here. Paste images and links; add math from the toolbar.' }),
      Mathematics.configure({
        katexOptions: { throwOnError: false },
        inlineOptions: { onClick: (node, pos) => void mathAt('inline', node.attrs.latex, pos) },
        blockOptions: { onClick: (node, pos) => void mathAt('block', node.attrs.latex, pos) },
      }),
      NoteImage,
    ],
    editorProps: {
      attributes: { class: 'note-content', 'aria-label': 'Note' },
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])]
        if (files.length > 0) {
          void addFiles(files, null)
          return true
        }
        const text = event.clipboardData?.getData('text/plain')?.trim()
        return text ? pasteLink(text) : false
      },
      handleDrop: (view, event, _slice, moved) => {
        const files = [...(event.dataTransfer?.files ?? [])]
        if (moved || files.length === 0) return false
        event.preventDefault()
        void addFiles(files, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? null)
        return true
      },
    },
    onUpdate: () => changed(),
    onTransaction: () => syncToolbar(),
  })

  // ----- Toolbar -----
  const imageInput = h('input', {
    type: 'file',
    accept: 'image/*',
    multiple: true,
    hidden: true,
    onchange: () => {
      const files = [...(imageInput.files ?? [])]
      imageInput.value = ''
      void addFiles(files, null)
    },
  })
  type Tool = { label: string; text: string | SVGSVGElement; run: () => void; active?: () => boolean }
  const tools: Tool[] = [
    { label: 'Heading', text: 'H1', run: () => editor.chain().focus().toggleHeading({ level: 1 }).run(), active: () => editor.isActive('heading', { level: 1 }) },
    { label: 'Subheading', text: 'H2', run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(), active: () => editor.isActive('heading', { level: 2 }) },
    { label: 'Bold', text: 'B', run: () => editor.chain().focus().toggleBold().run(), active: () => editor.isActive('bold') },
    { label: 'Italic', text: 'I', run: () => editor.chain().focus().toggleItalic().run(), active: () => editor.isActive('italic') },
    { label: 'Code', text: '</>', run: () => editor.chain().focus().toggleCode().run(), active: () => editor.isActive('code') },
    { label: 'Bulleted list', text: '•', run: () => editor.chain().focus().toggleBulletList().run(), active: () => editor.isActive('bulletList') },
    { label: 'Numbered list', text: '1.', run: () => editor.chain().focus().toggleOrderedList().run(), active: () => editor.isActive('orderedList') },
    { label: 'Checklist', text: checklistIcon(), run: () => editor.chain().focus().toggleTaskList().run(), active: () => editor.isActive('taskList') },
    { label: 'Quote', text: '❝', run: () => editor.chain().focus().toggleBlockquote().run(), active: () => editor.isActive('blockquote') },
    { label: 'Math in the line', text: 'x²', run: () => void mathAt('inline', '', null) },
    { label: 'Formula on its own line', text: '∑', run: () => void mathAt('block', '', null) },
    { label: 'Image', text: imageIcon(), run: () => imageInput.click() },
  ]
  const toolButtons = tools.map((t) =>
    h(
      'button',
      {
        type: 'button',
        class: 'tool',
        'aria-label': t.label,
        title: t.label,
        // Keep the editor's selection when a tool is pressed.
        onmousedown: (e: Event) => e.preventDefault(),
        onclick: t.run,
      },
      t.text,
    ),
  )
  function syncToolbar() {
    tools.forEach((t, i) => t.active && toolButtons[i].setAttribute('aria-pressed', String(t.active())))
  }

  // ----- Leaving: save, and drop images that were taken out of the text -----
  async function leave() {
    await save()
    await removeUnusedInlineImages(note!.id, editor.getJSON())
  }
  const onHidden = () => document.visibilityState === 'hidden' && void save()
  window.addEventListener('hashchange', () => {
    void leave().finally(() => editor.destroy())
    document.removeEventListener('visibilitychange', onHidden)
    window.removeEventListener('pagehide', onPageHide)
  }, { once: true })
  const onPageHide = () => void save()
  document.addEventListener('visibilitychange', onHidden)
  window.addEventListener('pagehide', onPageHide)

  // ----- Header actions -----
  const pinButton = h(
    'button',
    {
      class: 'icon-btn header-end pin-toggle',
      'aria-label': 'Pin to top',
      'aria-pressed': String(pinned),
      onclick: async () => {
        pinned = !pinned
        pinButton.setAttribute('aria-pressed', String(pinned))
        await setPinned(note.id, pinned)
      },
    },
    '📌',
  )
  const menuButton = h(
    'button',
    {
      class: 'icon-btn',
      'aria-label': 'Note options',
      onclick: async () => {
        if (await confirmDelete(`Delete “${noteTitle({ title: title.value })}”?`, 'Its attachments go too.')) {
          clearTimeout(timer)
          dirty = false
          await deleteNote(note.id)
          back(elementHash(el))
        }
      },
    },
    moreIcon(),
  )

  strip = attachmentStrip(owner)
  const top = await header(el, h('span', { class: 'header-title-small' }, el.title, status), () => back(elementHash(el)), pinButton, menuButton)
  const screen = h(
    'div',
    { class: 'deck-screen note-screen', style: { '--c': top.color, '--fg': textColorOn(top.color) } },
    top.node,
    h('div', { class: 'note-toolbar', role: 'toolbar', 'aria-label': 'Formatting' }, toolButtons, imageInput),
    h(
      'main',
      { class: 'locus-body note-main' },
      title,
      body,
      h('section', { class: 'note-extras' }, h('div', { class: 'field-label' }, 'Attachments', strip.el), linkedItemsSection(owner, () => {})),
    ),
  )
  syncToolbar()
  // A brand-new note: start in the title, once the screen is on the page.
  if (!note.title && !note.plainText) setTimeout(() => title.isConnected && title.focus(), 50)
  return screen
}
