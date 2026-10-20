import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { recordReview } from '../elements/flashcards/session'
import { schedule } from '../elements/flashcards/srs'
import { addCards, DEFAULT_FLASHCARDS_DATA, listCards } from '../elements/flashcards/store'
import { type Backup, BACKUP_VERSION, BackupError, exportBackup, importBackup, parseBackup } from './backup'
import { createElement, createLocus, db, findOrCreateTag } from './db'

const clearAll = () => Promise.all(db.tables.map((t) => t.clear()))

async function seed() {
  const tag = await findOrCreateTag('Language')
  const locus = await createLocus({ name: 'Spanish', color: '#4f8ef7', tagIds: [tag.id], x: 0.3, y: 0.6 })
  const deck = await createElement(locus.id, 'flashcards', 'Verbs', { ...DEFAULT_FLASHCARDS_DATA })
  await addCards(deck.id, [
    { front: 'hablar', back: 'to speak' },
    { front: 'comer', back: 'to eat' },
  ])
  const [card] = await listCards(deck.id)
  const now = new Date(2026, 0, 10, 15).getTime()
  await recordReview(card, schedule(card, 2, now, 0.5), 2, now)
  return { tag, locus, deck }
}

// Everything in the database, sorted, for comparing.
async function snapshot() {
  const sort = <T extends { id: string }>(rows: T[]) => rows.sort((a, b) => a.id.localeCompare(b.id))
  return {
    tags: sort(await db.tags.toArray()),
    loci: sort(await db.loci.toArray()),
    elements: sort(await db.elements.toArray()),
    cards: sort(await db.cards.toArray()),
    reviews: sort(await db.reviews.toArray()),
  }
}

beforeEach(clearAll)

describe('export → import round trip', () => {
  it('replacing from a backup restores every record exactly', async () => {
    await seed()
    const before = await snapshot()
    const file = JSON.stringify(await exportBackup())

    await clearAll()
    await createLocus({ name: 'Something else', color: '#000000', x: 0, y: 0 }) // replace removes it
    await importBackup(parseBackup(file), 'replace')

    expect(await snapshot()).toEqual(before)
  })

  it('the file carries a version and every table', async () => {
    await seed()
    const backup = await exportBackup(1234)
    expect(backup).toMatchObject({ version: BACKUP_VERSION, exportedAt: 1234 })
    expect([backup.tags.length, backup.loci.length, backup.elements.length, backup.cards.length, backup.reviews.length]).toEqual([1, 1, 1, 2, 1])
  })
})

describe('merge', () => {
  it('adds what is missing and keeps the newer copy of what is on both sides', async () => {
    const { locus } = await seed()
    const backup = await exportBackup()

    // Here, after the backup: rename the locus (newer than the file).
    await db.loci.update(locus.id, { name: 'Español', updatedAt: Date.now() + 1000 })
    // In the file: one card edited later than ours, and a new card.
    const [edited] = backup.cards
    backup.cards[0] = { ...edited, back: 'to talk', updatedAt: edited.updatedAt + 5000 }
    backup.cards.push({ ...edited, id: 'new-card', front: 'vivir', back: 'to live' })

    const summary = await importBackup(backup, 'merge')

    expect((await db.loci.get(locus.id))!.name).toBe('Español') // ours was newer
    expect((await db.cards.get(edited.id))!.back).toBe('to talk') // theirs was newer
    expect(await db.cards.get('new-card')).toBeDefined()
    expect(summary.cards).toEqual({ added: 1, updated: 1 })
    expect(summary.loci).toEqual({ added: 0, updated: 0 })
  })

  it('merging the same file twice changes nothing the second time', async () => {
    await seed()
    const backup = await exportBackup()
    await clearAll()
    await importBackup(backup, 'merge')
    const once = await snapshot()
    const summary = await importBackup(backup, 'merge')
    expect(await snapshot()).toEqual(once)
    expect(Object.values(summary).every((s) => s.added === 0 && s.updated === 0)).toBe(true)
  })

  it('a tag made separately on both devices ("Math" / "math") stays one tag', async () => {
    const ours = await findOrCreateTag('Math')
    const theirs = { id: 'their-math', name: 'math', key: 'math', updatedAt: 1 }
    const backup: Backup = {
      version: BACKUP_VERSION,
      exportedAt: 0,
      tags: [theirs],
      loci: [{ id: 'calc', name: 'Calculus', color: '#000000', tagIds: ['their-math'], x: 0, y: 0, radius: 48, createdAt: 0, updatedAt: 1 }],
      elements: [],
      cards: [],
      reviews: [],
    }
    await importBackup(backup, 'merge')
    expect(await db.tags.count()).toBe(1)
    expect((await db.loci.get('calc'))!.tagIds).toEqual([ours.id])
  })
})

describe('parseBackup', () => {
  const valid = { version: 1, exportedAt: 0, tags: [], loci: [], elements: [], cards: [], reviews: [] }

  it('accepts a valid file', () => {
    expect(parseBackup(JSON.stringify(valid))).toMatchObject(valid)
  })

  it.each([
    ['not JSON', 'hello', 'isn’t JSON'],
    ['some other JSON', '{"name":"x"}', 'isn’t a Loci backup'],
    ['a newer version', JSON.stringify({ ...valid, version: 99 }), 'newer version'],
    ['a missing table', JSON.stringify({ ...valid, cards: undefined }), '“cards” is missing'],
    ['a record without updatedAt', JSON.stringify({ ...valid, loci: [{ id: 'a' }] }), 'incomplete'],
  ])('rejects %s with a clear message', (_, text, message) => {
    expect(() => parseBackup(text)).toThrow(BackupError)
    expect(() => parseBackup(text)).toThrow(message)
  })
})
