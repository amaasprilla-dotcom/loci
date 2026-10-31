// Reading and writing the notes in a notebook (a Notes element).

import { db, deleteAttachmentsOf, deleteBlobIfUnused, deleteLinksFor } from '../../store/db'
import type { Note } from '../../types'

export const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] }

// Pinned notes first, then the most recently edited.
export async function listNotes(elementId: string): Promise<Note[]> {
  const notes = await db.notes.where('elementId').equals(elementId).toArray()
  return notes.sort((a, b) => b.pinned - a.pinned || b.updatedAt - a.updatedAt)
}

export async function createNote(elementId: string): Promise<Note> {
  const now = Date.now()
  const note: Note = { id: crypto.randomUUID(), elementId, title: '', content: EMPTY_DOC, plainText: '', pinned: 0, createdAt: now, updatedAt: now }
  await db.notes.add(note)
  return note
}

export async function saveNote(id: string, patch: { title: string; content: unknown }): Promise<void> {
  await db.notes.update(id, { title: patch.title, content: patch.content, plainText: docText(patch.content), updatedAt: Date.now() })
}

export async function setPinned(id: string, pinned: boolean): Promise<void> {
  await db.notes.update(id, { pinned: pinned ? 1 : 0, updatedAt: Date.now() })
}

// Deletes the note with its attachments (and their files), its links and its recall history.
export async function deleteNote(id: string): Promise<void> {
  await db.transaction('rw', [db.notes, db.attachments, db.blobs, db.links, db.recallAttempts], async () => {
    await deleteLinksFor([{ type: 'note', id }])
    await deleteAttachmentsOf([{ type: 'note', id }])
    await db.recallAttempts.where('noteId').equals(id).delete()
    await db.notes.delete(id)
  })
}

// Images pasted into a note are stored as inline attachments. Once one is gone
// from the text, its file goes too. Run when leaving the note (not on every save,
// so undo can still bring an image back while editing).
export async function removeUnusedInlineImages(noteId: string, content: unknown): Promise<void> {
  const used = new Set(blobIdsIn(content))
  await db.transaction('rw', db.attachments, db.blobs, async () => {
    const inline = (await db.attachments.where('[ownerType+ownerId]').equals(['note', noteId]).toArray()).filter((a) => a.inline)
    for (const a of inline) {
      if (a.blobId && used.has(a.blobId)) continue
      await db.attachments.delete(a.id)
      if (a.blobId) await deleteBlobIfUnused(a.blobId)
    }
  })
}

// ---------- Reading ProseMirror JSON ----------

interface PMNode {
  type?: string
  text?: string
  attrs?: Record<string, unknown>
  content?: PMNode[]
}

const BLOCKS = new Set(['paragraph', 'heading', 'blockquote', 'codeBlock', 'listItem', 'taskItem', 'blockMath', 'tableCell', 'tableHeader'])

// The note's text, one line per block, for search and the list's preview.
// Math counts as its LaTeX source, so "\\frac" or "sigma" finds it.
export function docText(doc: unknown): string {
  const lines: string[] = []
  let line = ''
  const walk = (node: PMNode) => {
    if (node.type === 'text') line += node.text ?? ''
    else if (node.type === 'inlineMath' || node.type === 'blockMath') line += String(node.attrs?.latex ?? '')
    else if (node.type === 'hardBreak') line += ' '
    for (const child of node.content ?? []) walk(child)
    if (node.type && BLOCKS.has(node.type) && line.trim()) {
      lines.push(line.trim())
      line = ''
    }
  }
  walk(doc as PMNode)
  if (line.trim()) lines.push(line.trim())
  return lines.join('\n')
}

// Every stored image a note's content shows.
export function blobIdsIn(doc: unknown): string[] {
  const ids: string[] = []
  const walk = (node: PMNode) => {
    if (node.type === 'noteImage' && typeof node.attrs?.blobId === 'string') ids.push(node.attrs.blobId)
    for (const child of node.content ?? []) walk(child)
  }
  walk(doc as PMNode)
  return ids
}

export function noteTitle(note: Pick<Note, 'title'>): string {
  return note.title.trim() || 'Untitled'
}

// The first line of text, for the list.
export function firstLine(note: Pick<Note, 'plainText'>): string {
  return note.plainText.split('\n').find((l) => l.trim()) ?? ''
}

// Notes whose title or text contains the query, ignoring case.
export function searchNotes(notes: Note[], query: string): Note[] {
  const q = query.trim().toLowerCase()
  if (!q) return notes
  return notes.filter((n) => n.title.toLowerCase().includes(q) || n.plainText.toLowerCase().includes(q))
}
