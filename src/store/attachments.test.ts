import 'fake-indexeddb/auto'
import '../elements/all'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  addFileAttachment,
  addLinkAttachment,
  blobBytes,
  deleteAttachment,
  deleteAttachmentsFor,
  getBlob,
  kindOf,
  linkLabel,
  listAttachments,
  normalizeUrl,
  renameAttachment,
} from './attachments'
import { backupToZip, BackupError, exportBackup, importBackup, readBackupFile } from './backup'
import { db } from './db'

const note = { type: 'note' as const, id: 'note-1' }
const todo = { type: 'todo' as const, id: 'todo-1' }
const file = (name: string, text: string, type: string) => new File([text], name, { type })

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('links', () => {
  it('accept web addresses as typed, and nothing that could run code', () => {
    expect(normalizeUrl('example.com/page')).toBe('https://example.com/page')
    expect(normalizeUrl('http://example.com')).toBe('http://example.com/')
    expect(normalizeUrl('mailto:me@example.com')).toBe('mailto:me@example.com')
    expect(normalizeUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeUrl('data:text/html,hi')).toBeNull()
    expect(normalizeUrl('hello')).toBeNull()
    expect(normalizeUrl('')).toBeNull()
  })

  it('show their title, or their domain without one', async () => {
    const titled = await addLinkAttachment(note, 'www.example.com/a', 'Lecture notes')
    const bare = await addLinkAttachment(note, 'https://www.example.com/b')
    expect([linkLabel(titled), linkLabel(bare)]).toEqual(['Lecture notes', 'example.com'])
  })
})

describe('files', () => {
  it('are stored as Blobs and listed in the order added', async () => {
    const pdf = await addFileAttachment(note, file('syllabus.pdf', 'PDF!', 'application/pdf'))
    await addFileAttachment(note, file('song.mp3', 'MP3', 'audio/mpeg'))
    await addFileAttachment(todo, file('other.txt', 'x', 'text/plain'))
    expect((await listAttachments(note)).map((a) => [a.name, a.kind])).toEqual([
      ['syllabus.pdf', 'pdf'],
      ['song.mp3', 'audio'],
    ])
    expect(await (await getBlob(pdf.blobId!))!.text()).toBe('PDF!')
    expect(await blobBytes()).toEqual({ count: 3, bytes: 4 + 3 + 1 })
  })

  it('kinds come from the file type', () => {
    expect(['image/png', 'audio/ogg', 'video/mp4', 'application/pdf', 'application/zip'].map(kindOf)).toEqual(['image', 'audio', 'video', 'pdf', 'file'])
  })

  it('can be renamed; removing one removes its file', async () => {
    const a = await addFileAttachment(note, file('a.txt', 'aaa', 'text/plain'))
    await renameAttachment(a.id, '  Reading list ')
    expect((await listAttachments(note))[0].name).toBe('Reading list')
    await deleteAttachment(a.id)
    expect(await listAttachments(note)).toEqual([])
    expect(await db.blobs.count()).toBe(0)
  })

  it('deleting an owner removes its attachments and their files, and nothing else', async () => {
    await addFileAttachment(note, file('a.txt', 'a', 'text/plain'))
    await addLinkAttachment(note, 'example.com')
    const kept = await addFileAttachment(todo, file('b.txt', 'b', 'text/plain'))
    await db.transaction('rw', db.attachments, db.blobs, () => deleteAttachmentsFor(note))
    expect(await db.attachments.toArray()).toEqual([kept])
    expect(await db.blobs.toCollection().primaryKeys()).toEqual([kept.blobId])
  })
})

describe('zip backup', () => {
  it('round-trips attachments and their files', async () => {
    const a = await addFileAttachment(note, file('photo.png', 'not really a png', 'image/png'))
    await addLinkAttachment(note, 'example.com', 'Example')
    await db.settings.put({ key: 'numberFormat', value: 'comma', updatedAt: 1 })
    const zip = await backupToZip(await exportBackup())

    await Promise.all(db.tables.map((t) => t.clear()))
    await importBackup(await readBackupFile(zip), 'replace')

    expect((await listAttachments(note)).map((x) => x.name)).toEqual(['photo.png', 'Example'])
    expect(await (await getBlob(a.blobId!))!.text()).toBe('not really a png')
    expect((await db.settings.get('numberFormat'))!.value).toBe('comma')
  })

  it('still reads an old .json backup', async () => {
    const old = { version: 2, exportedAt: 0, tags: [], loci: [{ id: 'l', name: 'Old', color: '#000000', tagIds: [], x: 0, y: 0, radius: 48, createdAt: 0, updatedAt: 1 }], elements: [], cards: [], reviews: [] }
    const backup = await readBackupFile(new Blob([JSON.stringify(old)], { type: 'application/json' }))
    expect(backup.loci[0].name).toBe('Old')
    expect([backup.attachments, backup.blobs, backup.settings]).toEqual([[], [], []])
  })

  it('reports a zip whose attached file is missing as damaged', async () => {
    await addFileAttachment(note, file('a.txt', 'a', 'text/plain'))
    const backup = await exportBackup()
    // A zip whose data.json lists a file that isn't in it.
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(await (await backupToZip(backup)).arrayBuffer())
    zip.remove(`blobs/${backup.blobs[0].id}`)
    const missing = new Blob([(await zip.generateAsync({ type: 'uint8array' })) as Uint8Array<ArrayBuffer>])
    await expect(readBackupFile(missing)).rejects.toThrow(BackupError)
  })

  it('merging keeps this device’s newer settings', async () => {
    await db.settings.put({ key: 'numberFormat', value: 'dot', updatedAt: 100 })
    const backup = await exportBackup()
    backup.settings = [{ key: 'numberFormat', value: 'comma', updatedAt: 50 }]
    await importBackup(backup, 'merge')
    expect((await db.settings.get('numberFormat'))!.value).toBe('dot')
  })
})
