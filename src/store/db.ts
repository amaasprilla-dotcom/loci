// IndexedDB storage through Dexie. All data stays on this device.

import Dexie, { type EntityTable, type Transaction } from 'dexie'
import { migrateCard } from '../elements/flashcards/srs'
import { defaultCheckin } from '../elements/goals/defaults'
import type {
  Attachment,
  AttachmentOwner,
  Card,
  Contributor,
  Exam,
  Goal,
  GoalEntry,
  ItemRef,
  Level,
  Link,
  Locus,
  LocusElement,
  Note,
  ProblemAttempt,
  ProblemTemplate,
  ReviewLog,
  Setting,
  StoredBlob,
  Tag,
  Todo,
  TodoCompletion,
} from '../types'

export const db = new Dexie('loci') as Dexie & {
  tags: EntityTable<Tag, 'id'>
  loci: EntityTable<Locus, 'id'>
  elements: EntityTable<LocusElement, 'id'>
  cards: EntityTable<Card, 'id'>
  reviews: EntityTable<ReviewLog, 'id'>
  links: EntityTable<Link, 'id'>
  attachments: EntityTable<Attachment, 'id'>
  blobs: EntityTable<StoredBlob, 'id'>
  settings: EntityTable<Setting, 'key'>
  notes: EntityTable<Note, 'id'>
  todos: EntityTable<Todo, 'id'>
  todoCompletions: EntityTable<TodoCompletion, 'id'>
  goals: EntityTable<Goal, 'id'>
  goalContributors: EntityTable<Contributor, 'id'>
  goalEntries: EntityTable<GoalEntry, 'id'>
  problemTemplates: EntityTable<ProblemTemplate, 'id'>
  problemAttempts: EntityTable<ProblemAttempt, 'id'>
  exams: EntityTable<Exam, 'id'>
}

db.version(1).stores({
  tags: 'id, &key',
  loci: 'id',
  elements: 'id, locusId',
  cards: 'id, elementId, [elementId+due]', // "due cards in this deck" is one range query
  reviews: 'id, cardId, at',
})

// v2: cards are scheduled by FSRS. Their due date now lives in srs.due.
db.version(2)
  .stores({
    cards: 'id, elementId, [elementId+srs.due]',
  })
  .upgrade(migrateCardsToFsrs)

// v2: links between any two items, findable from either end.
db.version(3).stores({
  links: 'id, [from.type+from.id], [to.type+to.id], kind',
})

// v2: attachments on notes, to-dos and goals; their files as Blobs; app settings.
db.version(4).stores({
  attachments: 'id, [ownerType+ownerId]',
  blobs: 'id',
  settings: 'key',
})

// v2: notes (Notes element), newest first by updatedAt, pinned ones on top.
db.version(5).stores({
  notes: 'id, elementId, updatedAt, pinned',
})

// v2: to-dos (To-do list element) and one row per occurrence dealt with.
db.version(6).stores({
  todos: 'id, elementId, status, when.kind',
  todoCompletions: 'id, todoId, occurrenceAt',
})

// v2: goals (Goals element), what counts toward them, and check-in answers.
db.version(7).stores({
  goals: 'id, elementId, status, deadline',
  goalContributors: 'id, goalId, linkId',
  goalEntries: 'id, contributorId, at',
})

// v2: problem templates (Problems element) and every attempt at one.
db.version(8).stores({
  problemTemplates: 'id, elementId, [elementId+srs.due]',
  problemAttempts: 'id, templateId, at',
})

// v2: exams (Test mode), one locus each.
db.version(9).stores({
  exams: 'id, locusId, date, status',
})

// Runs once, when a v1 database is first opened by v2: gives every card its
// FSRS state, replaying its review history where there is one.
async function migrateCardsToFsrs(tx: Transaction): Promise<void> {
  const cards = await tx.table<Card>('cards').toArray()
  const logs = await tx.table<ReviewLog>('reviews').toArray()
  await tx.table<Card>('cards').bulkPut(migrateV1Cards(cards, logs))
}

// Gives v1 cards (no srs yet) their FSRS state. Used by the upgrade above and
// for cards arriving from an old backup file.
export function migrateV1Cards(cards: Card[], logs: ReviewLog[]): Card[] {
  const byCard = new Map<string, ReviewLog[]>()
  for (const log of logs) byCard.set(log.cardId, [...(byCard.get(log.cardId) ?? []), log])
  return cards.map((card) => (card.srs ? card : { ...card, srs: migrateCard(card, byCard.get(card.id) ?? []) }))
}

// Ask the browser not to evict our data when the device runs low on space.
// Browsers may say no (or ask the user); the app works either way.
export async function requestPersistentStorage(): Promise<void> {
  if (!navigator.storage?.persist) return
  if (await navigator.storage.persisted()) return
  await navigator.storage.persist()
}

export const DEFAULT_RADIUS = 48

export async function listLoci(): Promise<Locus[]> {
  const loci = await db.loci.toArray()
  return loci.sort((a, b) => a.createdAt - b.createdAt)
}

export async function createLocus(input: {
  name: string
  color: string
  tagIds?: string[]
  studyImportance?: Level
  studyDifficulty?: Level
  retention?: number
  x: number
  y: number
}): Promise<Locus> {
  const now = Date.now()
  const locus: Locus = {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    color: input.color,
    tagIds: input.tagIds ?? [],
    x: input.x,
    y: input.y,
    radius: DEFAULT_RADIUS,
    ...(input.studyImportance && { studyImportance: input.studyImportance }),
    ...(input.studyDifficulty && { studyDifficulty: input.studyDifficulty }),
    ...(input.retention && { retention: input.retention }),
    createdAt: now,
    updatedAt: now,
  }
  await db.loci.add(locus)
  return locus
}

// x and y are the new home position, normalized 0..1 of the field.
export async function moveLocus(id: string, x: number, y: number): Promise<void> {
  await db.loci.update(id, { x, y, updatedAt: Date.now() })
}

export async function updateLocus(id: string, patch: Pick<Locus, 'name' | 'color' | 'tagIds' | 'studyImportance' | 'studyDifficulty' | 'retention'>): Promise<void> {
  await db.transaction('rw', db.loci, db.tags, async () => {
    await db.loci.update(id, { ...patch, name: patch.name.trim(), updatedAt: Date.now() })
    await pruneUnusedTags()
  })
}

// Deletes the locus and everything in it: its elements with all their contents, and its exams.
export async function deleteLocus(id: string): Promise<void> {
  await db.transaction('rw', CONTENT_TABLES(), async () => {
    const elementIds = await db.elements.where('locusId').equals(id).primaryKeys()
    await deleteElementsAndContents(elementIds)
    const examIds = await db.exams.where('locusId').equals(id).primaryKeys()
    await deleteLinksFor([{ type: 'locus', id }, ...refs('exam', examIds)])
    await db.exams.bulkDelete(examIds)
    await db.loci.delete(id)
    await pruneUnusedTags()
  })
}

// Every table that deleting a locus or an element can touch.
export const CONTENT_TABLES = () => [
  db.loci,
  db.elements,
  db.cards,
  db.reviews,
  db.notes,
  db.todos,
  db.todoCompletions,
  db.goals,
  db.goalContributors,
  db.goalEntries,
  db.problemTemplates,
  db.problemAttempts,
  db.exams,
  db.attachments,
  db.blobs,
  db.links,
  db.tags,
]

// Deletes elements and everything in them: cards with their review history; problem
// templates with their attempts; notes,
// to-dos and goals with their attachments and files; to-do history; goal
// contributors and check-ins; and every link to any of these. To-dos elsewhere that
// waited on a deleted to-do or goal become due now; goals elsewhere lose
// contributors that counted a deleted to-do. Call inside a transaction over CONTENT_TABLES().
async function deleteElementsAndContents(elementIds: string[]): Promise<void> {
  const cardIds = await db.cards.where('elementId').anyOf(elementIds).primaryKeys()
  const noteIds = await db.notes.where('elementId').anyOf(elementIds).primaryKeys()
  const todoIds = await db.todos.where('elementId').anyOf(elementIds).primaryKeys()
  const goalIds = await db.goals.where('elementId').anyOf(elementIds).primaryKeys()
  const templateIds = await db.problemTemplates.where('elementId').anyOf(elementIds).primaryKeys()
  await wakeDependents([...refs('todo', todoIds), ...refs('goal', goalIds)])
  await removeTodoContributors(todoIds, new Set(goalIds))
  await deleteGoalContents(goalIds)
  await deleteLinksFor([...refs('element', elementIds), ...refs('card', cardIds), ...refs('note', noteIds), ...refs('todo', todoIds), ...refs('goal', goalIds), ...refs('template', templateIds)])
  await deleteAttachmentsOf([
    ...noteIds.map((id) => ({ type: 'note' as const, id })),
    ...todoIds.map((id) => ({ type: 'todo' as const, id })),
    ...goalIds.map((id) => ({ type: 'goal' as const, id })),
  ])
  await db.reviews.where('cardId').anyOf(cardIds).delete()
  await db.cards.bulkDelete(cardIds)
  await db.notes.bulkDelete(noteIds)
  await db.todoCompletions.where('todoId').anyOf(todoIds).delete()
  await db.todos.bulkDelete(todoIds)
  await db.goals.bulkDelete(goalIds)
  await db.problemAttempts.where('templateId').anyOf(templateIds).delete()
  await db.problemTemplates.bulkDelete(templateIds)
  await db.elements.bulkDelete(elementIds)
}

// To-dos (outside the set being deleted) waiting on these to-dos or goals: due now,
// since what they waited for is gone.
export async function wakeDependents(items: ItemRef[]): Promise<void> {
  const gone = new Set(items.filter((i) => i.type === 'todo').map((i) => i.id))
  const now = Date.now()
  for (const item of items) {
    const links = await db.links.where('[from.type+from.id]').equals([item.type, item.id]).filter((l) => l.kind === 'after').toArray()
    for (const l of links) {
      if (gone.has(l.to.id)) continue
      const t = await db.todos.get(l.to.id)
      if (t?.status === 'open' && (t.when.kind === 'after' || t.when.kind === 'goal')) await db.todos.update(t.id, { when: { kind: 'at', at: now, hasTime: true }, updatedAt: now })
    }
  }
}

// A goal's contributors and check-in answers (not the goal row, links or attachments).
export async function deleteGoalContents(goalIds: string[]): Promise<void> {
  const contributorIds = await db.goalContributors.where('goalId').anyOf(goalIds).primaryKeys()
  await db.goalEntries.where('contributorId').anyOf(contributorIds).delete()
  await db.goalContributors.bulkDelete(contributorIds)
}

// To-dos about to be deleted no longer count toward goals: their contributors go
// (with their contributes links). A goal left with none gets the default check-in,
// since a goal always has one (SPEC-v2.md). Goals in `skip` are being deleted anyway.
export async function removeTodoContributors(todoIds: string[], skip: Set<string> = new Set()): Promise<void> {
  const now = Date.now()
  const touched = new Set<string>()
  for (const todoId of todoIds) {
    const links = await db.links.where('[from.type+from.id]').equals(['todo', todoId]).filter((l) => l.kind === 'contributes').toArray()
    for (const link of links) {
      const contributors = await db.goalContributors.where('linkId').equals(link.id).toArray()
      for (const c of contributors) {
        await db.goalEntries.where('contributorId').equals(c.id).delete()
        await db.goalContributors.delete(c.id)
        touched.add(c.goalId)
      }
      await db.links.delete(link.id)
    }
  }
  for (const goalId of touched) {
    if (skip.has(goalId)) continue
    if ((await db.goalContributors.where('goalId').equals(goalId).count()) === 0) await db.goalContributors.add(defaultCheckin(goalId, now))
  }
}

// Removes the owners' attachments, and each file nothing else uses any more.
// Call inside a transaction that includes db.attachments and db.blobs.
export async function deleteAttachmentsOf(owners: { type: AttachmentOwner; id: string }[]): Promise<void> {
  for (const owner of owners) {
    const rows = await db.attachments.where('[ownerType+ownerId]').equals([owner.type, owner.id]).toArray()
    await db.attachments.bulkDelete(rows.map((a) => a.id))
    for (const a of rows) if (a.blobId) await deleteBlobIfUnused(a.blobId)
  }
}

export async function deleteBlobIfUnused(blobId: string): Promise<void> {
  const stillUsed = await db.attachments.filter((a) => a.blobId === blobId).count()
  if (stillUsed === 0) await db.blobs.delete(blobId)
}

// What deleting a locus would remove, for the confirmation message.
export async function countLocusContents(id: string): Promise<{ elements: number; cards: number; problems: number; notes: number; todos: number; goals: number; exams: number }> {
  const elementIds = await db.elements.where('locusId').equals(id).primaryKeys()
  return { elements: elementIds.length, ...(await countElementContents(elementIds)), exams: await db.exams.where('locusId').equals(id).count() }
}

// What deleting these elements would also remove, for confirmation messages.
export async function countElementContents(elementIds: string[]): Promise<{ cards: number; problems: number; notes: number; todos: number; goals: number }> {
  const [cards, problems, notes, todos, goals] = await Promise.all([
    db.cards.where('elementId').anyOf(elementIds).count(),
    db.problemTemplates.where('elementId').anyOf(elementIds).count(),
    db.notes.where('elementId').anyOf(elementIds).count(),
    db.todos.where('elementId').anyOf(elementIds).count(),
    db.goals.where('elementId').anyOf(elementIds).count(),
  ])
  return { cards, problems, notes, todos, goals }
}

// ---------- Elements ----------

export async function getElement(id: string): Promise<LocusElement | undefined> {
  return db.elements.get(id)
}

export async function listElements(locusId: string): Promise<LocusElement[]> {
  const elements = await db.elements.where('locusId').equals(locusId).toArray()
  return elements.sort((a, b) => a.order - b.order)
}

export async function createElement<TData>(locusId: string, type: string, title: string, data: TData): Promise<LocusElement<TData>> {
  return db.transaction('rw', db.elements, async () => {
    const siblings = await db.elements.where('locusId').equals(locusId).toArray()
    const element: LocusElement<TData> = {
      id: crypto.randomUUID(),
      locusId,
      type,
      title: title.trim(),
      order: siblings.reduce((max, e) => Math.max(max, e.order + 1), 0), // goes last
      data,
      updatedAt: Date.now(),
    }
    await db.elements.add(element)
    return element
  })
}

export async function updateElement(id: string, patch: Partial<Pick<LocusElement, 'title' | 'data'>>): Promise<void> {
  await db.elements.update(id, { ...patch, ...(patch.title != null && { title: patch.title.trim() }), updatedAt: Date.now() })
}

// ids in their new order.
export async function reorderElements(ids: string[]): Promise<void> {
  const now = Date.now()
  await db.elements.bulkUpdate(ids.map((id, order) => ({ key: id, changes: { order, updatedAt: now } })))
}

// Deletes the element with its cards and their review history.
export async function deleteElement(id: string): Promise<void> {
  await db.transaction('rw', CONTENT_TABLES(), async () => {
    await deleteElementsAndContents([id])
  })
}

// ---------- Links ----------

const refs = (type: ItemRef['type'], ids: string[]): ItemRef[] => ids.map((id) => ({ type, id }))

// Removes every link that starts or ends at one of these items. Call it inside the
// transaction that deletes them (with db.links in scope), so no link points nowhere.
export async function deleteLinksFor(items: ItemRef[]): Promise<void> {
  for (const item of items) {
    await db.links.where('[from.type+from.id]').equals([item.type, item.id]).delete()
    await db.links.where('[to.type+to.id]').equals([item.type, item.id]).delete()
  }
}

// ---------- Tags ----------

export function tagKey(name: string): string {
  return name.trim().toLowerCase()
}

export async function listTags(): Promise<Tag[]> {
  const tags = await db.tags.toArray()
  return tags.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

// Returns the tag with this name, matching case-insensitively, creating it if needed.
export async function findOrCreateTag(name: string): Promise<Tag> {
  return db.transaction('rw', db.tags, async () => {
    const key = tagKey(name)
    const existing = await db.tags.where('key').equals(key).first()
    if (existing) return existing
    const tag: Tag = { id: crypto.randomUUID(), name: name.trim(), key, updatedAt: Date.now() }
    await db.tags.add(tag)
    return tag
  })
}

// Tags only exist through the loci that carry them: once no locus uses a tag,
// it leaves the filter bar and the tag list.
async function pruneUnusedTags(): Promise<void> {
  const used = new Set((await db.loci.toArray()).flatMap((l) => l.tagIds))
  const unused = (await db.tags.toCollection().primaryKeys()).filter((id) => !used.has(id))
  await db.tags.bulkDelete(unused)
}
