import 'fake-indexeddb/auto'
import '../all'
import { beforeEach, describe, expect, it } from 'vitest'
import { addFileAttachment, listAttachments } from '../../store/attachments'
import { exportBackup, importBackup } from '../../store/backup'
import { createElement, createLocus, db, deleteElement, deleteLocus } from '../../store/db'
import { addLink } from '../../store/links'
import { createNote, deleteNote, docText, firstLine, listNotes, removeUnusedInlineImages, saveNote, searchNotes, setPinned } from './store'

const doc = (...content: unknown[]) => ({ type: 'doc', content })
const p = (...content: unknown[]) => ({ type: 'paragraph', content })
const text = (t: string) => ({ type: 'text', text: t })
const image = (blobId: string) => ({ type: 'noteImage', attrs: { blobId } })

let notebookId: string
let locusId: string

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  locusId = (await createLocus({ name: 'Physics', color: '#000000', x: 0.5, y: 0.5 })).id
  notebookId = (await createElement(locusId, 'notes', 'Lectures', {})).id
})

describe('note text', () => {
  it('one line per block, math as its LaTeX, for search and the list preview', () => {
    const content = doc(
      { type: 'heading', attrs: { level: 2 }, content: [text('Kinematics')] },
      p(text('Speed is '), { type: 'inlineMath', attrs: { latex: '\\frac{d}{t}' } }, text('.')),
      { type: 'bulletList', content: [{ type: 'listItem', content: [p(text('one'))] }, { type: 'listItem', content: [p(text('two'))] }] },
      { type: 'blockMath', attrs: { latex: 'E = mc^2' } },
      p(),
    )
    expect(docText(content)).toBe('Kinematics\nSpeed is \\frac{d}{t}.\none\ntwo\nE = mc^2')
    expect(firstLine({ plainText: docText(content) })).toBe('Kinematics')
  })
})

describe('notes', () => {
  it('are listed pinned first, then most recently edited', async () => {
    const a = await createNote(notebookId)
    await saveNote(a.id, { title: 'A', content: doc(p(text('first'))) })
    const b = await createNote(notebookId)
    await saveNote(b.id, { title: 'B', content: doc(p(text('second'))) })
    const c = await createNote(notebookId)
    await saveNote(c.id, { title: 'C', content: doc() })
    await setPinned(a.id, true)
    expect((await listNotes(notebookId)).map((n) => n.title)).toEqual(['A', 'C', 'B'])
  })

  it('search matches title and text, ignoring case', async () => {
    const a = await createNote(notebookId)
    await saveNote(a.id, { title: 'Momentum', content: doc(p(text('p = mv'))) })
    const b = await createNote(notebookId)
    await saveNote(b.id, { title: 'Energy', content: doc(p(text('Work and momentum transfer'))) })
    const notes = await listNotes(notebookId)
    expect(searchNotes(notes, 'MOMENTUM').map((n) => n.title).sort()).toEqual(['Energy', 'Momentum'])
    expect(searchNotes(notes, 'p = mv').map((n) => n.title)).toEqual(['Momentum'])
    expect(searchNotes(notes, '')).toHaveLength(2)
  })

  it('deleting a note takes its attachments, files and links with it', async () => {
    const n = await createNote(notebookId)
    await addFileAttachment({ type: 'note', id: n.id }, new File(['x'], 'a.pdf', { type: 'application/pdf' }))
    await addLink({ type: 'note', id: n.id }, { type: 'locus', id: locusId }, 'related')
    await deleteNote(n.id)
    expect([await db.notes.count(), await db.attachments.count(), await db.blobs.count(), await db.links.count()]).toEqual([0, 0, 0, 0])
  })

  it('deleting the notebook, or its locus, deletes its notes and everything on them', async () => {
    for (const remove of [() => deleteElement(notebookId), () => deleteLocus(locusId)]) {
      await Promise.all(db.tables.map((t) => t.clear()))
      locusId = (await createLocus({ name: 'Physics', color: '#000000', x: 0.5, y: 0.5 })).id
      notebookId = (await createElement(locusId, 'notes', 'Lectures', {})).id
      const n = await createNote(notebookId)
      await addFileAttachment({ type: 'note', id: n.id }, new File(['x'], 'a.png', { type: 'image/png' }), { inline: true })
      await addLink({ type: 'locus', id: locusId }, { type: 'note', id: n.id }, 'related')
      await remove()
      expect([await db.notes.count(), await db.attachments.count(), await db.blobs.count(), await db.links.count()]).toEqual([0, 0, 0, 0])
    }
  })

  it('images taken out of the text lose their file once the note is left', async () => {
    const n = await createNote(notebookId)
    const owner = { type: 'note' as const, id: n.id }
    const kept = await addFileAttachment(owner, new File(['k'], 'kept.png', { type: 'image/png' }), { inline: true })
    await addFileAttachment(owner, new File(['g'], 'gone.png', { type: 'image/png' }), { inline: true })
    const strip = await addFileAttachment(owner, new File(['s'], 'slides.pdf', { type: 'application/pdf' })) // not inline: stays
    await removeUnusedInlineImages(n.id, doc(p(), image(kept.blobId!)))
    expect((await listAttachments(owner)).map((a) => a.name).sort()).toEqual(['kept.png', 'slides.pdf'])
    expect((await db.blobs.toCollection().primaryKeys()).sort()).toEqual([kept.blobId, strip.blobId].sort())
  })

  it('are in backups', async () => {
    const n = await createNote(notebookId)
    await saveNote(n.id, { title: 'Kept', content: doc(p(text('hello'))) })
    const backup = await exportBackup()
    await Promise.all(db.tables.map((t) => t.clear()))
    await importBackup(backup, 'replace')
    expect((await db.notes.get(n.id))).toMatchObject({ title: 'Kept', plainText: 'hello' })
  })
})
