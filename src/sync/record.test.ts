import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addCards, DEFAULT_FLASHCARDS_DATA, listCards } from '../elements/flashcards/store'
import { exportBackup, importBackup } from '../store/backup'
import { createElement, createLocus, db, deleteLocus, findOrCreateTag, moveLocus } from '../store/db'
import { markSilent, setRecording } from './record'

const clearAll = () => Promise.all(db.tables.map((t) => t.clear()))
const outbox = async () => (await db.syncOutbox.toArray()).map((r) => `${r.op} ${r.table}`).sort()

beforeEach(async () => {
  setRecording(false)
  await clearAll()
  setRecording(true)
})
afterEach(() => setRecording(false))

describe('recording changes', () => {
  it('records adds and updates once per record', async () => {
    const locus = await createLocus({ name: 'Spanish', color: '#4f8ef7', x: 0.3, y: 0.6 })
    await moveLocus(locus.id, 0.5, 0.5)
    await moveLocus(locus.id, 0.6, 0.5)
    const rows = await db.syncOutbox.toArray()
    expect(rows).toEqual([{ table: 'loci', id: locus.id, op: 'put', changedAt: expect.any(Number) }])
  })

  it('records every record a cascade deletes', async () => {
    const locus = await createLocus({ name: 'Spanish', color: '#4f8ef7', tagIds: [(await findOrCreateTag('Language')).id], x: 0.3, y: 0.6 })
    const deck = await createElement(locus.id, 'flashcards', 'Verbs', { ...DEFAULT_FLASHCARDS_DATA })
    await addCards(deck.id, [{ front: 'hablar', back: 'to speak' }])
    const [card] = await listCards(deck.id)
    await db.syncOutbox.clear()

    await deleteLocus(locus.id)
    expect(await outbox()).toEqual(['delete cards', 'delete elements', 'delete loci', 'delete tags'])
    expect((await db.syncOutbox.toArray()).find((r) => r.table === 'cards')?.id).toBe(card.id)
  })

  it('records nothing for deleting what is already gone', async () => {
    await db.notes.delete('never-was')
    await db.notes.where('elementId').equals('nothing').delete()
    expect(await db.syncOutbox.count()).toBe(0)
  })

  it('records each record a clear() removes (backup Replace)', async () => {
    await createLocus({ name: 'A', color: '#000', x: 0, y: 0 })
    const backup = await exportBackup()
    await createLocus({ name: 'B', color: '#000', x: 0, y: 0 })
    await db.syncOutbox.clear()
    await importBackup(backup, 'replace')
    // B is deleted, A is written back.
    expect(await outbox()).toEqual(['delete loci', 'put loci'])
  })

  it('records nothing in silent transactions', async () => {
    await db.transaction('rw', db.loci, async (tx) => {
      markSilent(tx.idbtrans)
      await db.loci.put({ id: 'pulled', name: 'From the laptop', color: '#000', tagIds: [], x: 0, y: 0, radius: 48, createdAt: 1, updatedAt: 1 })
    })
    expect(await db.loci.get('pulled')).toBeDefined()
    expect(await db.syncOutbox.count()).toBe(0)
  })

  it('records nothing with sync off', async () => {
    setRecording(false)
    await createLocus({ name: 'A', color: '#000', x: 0, y: 0 })
    expect(await db.syncOutbox.count()).toBe(0)
  })

  it('leaves this device’s own tables out', async () => {
    await db.syncState.put({ key: 'cursor', value: 3 })
    expect(await db.syncOutbox.count()).toBe(0)
  })
})
