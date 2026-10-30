// After a pull: fixing what two devices editing apart can leave behind (SPEC-v4-sync.md,
// "Keeping the data consistent"). Repairs are ordinary, recorded writes, so they
// reach the other devices too. Most of the time there's nothing to do: the other
// device's own cascades arrive with its deletions.

import { deleteCard } from '../elements/flashcards/store'
import { deleteGoal } from '../elements/goals/store'
import { deleteNote } from '../elements/notes/store'
import { deleteTemplate } from '../elements/problems/store'
import { deleteTodo } from '../elements/todos/store'
import { deleteExam } from '../exams/exams'
import { deleteAttachment } from '../store/attachments'
import { db, deleteElement, deleteLocus, wakeDependents } from '../store/db'
import type { AttachmentOwner, ItemRef, ItemType, Link } from '../types'
import type { ServerRecord, SyncedTable } from './rules'

const TABLE_OF: Record<ItemType, SyncedTable> = {
  locus: 'loci',
  element: 'elements',
  todo: 'todos',
  goal: 'goals',
  note: 'notes',
  card: 'cards',
  template: 'problemTemplates',
  exam: 'exams',
}

const OWNER_TABLE: Record<AttachmentOwner, SyncedTable> = { note: 'notes', todo: 'todos', goal: 'goals' }

// Deletes a record the way the app does, with everything that hangs off it.
// Deleting something already gone does nothing (and records nothing).
const REMOVE: Partial<Record<SyncedTable, (id: string) => Promise<void>>> = {
  loci: deleteLocus,
  elements: deleteElement,
  cards: deleteCard,
  notes: deleteNote,
  todos: (id) => deleteTodo(id),
  goals: deleteGoal,
  problemTemplates: deleteTemplate,
  exams: deleteExam,
  attachments: deleteAttachment,
  goalContributors: async (id) => {
    await db.transaction('rw', db.goalContributors, db.goalEntries, async () => {
      await db.goalEntries.where('contributorId').equals(id).delete()
      await db.goalContributors.delete(id)
    })
  },
}

// Each record's parent: deleting the parent deletes it.
function parentOf(record: ServerRecord): { table: SyncedTable; id: string } | null {
  const data = record.data as Record<string, string>
  switch (record.table) {
    case 'elements':
    case 'exams':
      return { table: 'loci', id: data.locusId }
    case 'cards':
    case 'notes':
    case 'todos':
    case 'goals':
    case 'problemTemplates':
      return { table: 'elements', id: data.elementId }
    case 'reviews':
      return { table: 'cards', id: data.cardId }
    case 'recallAttempts':
      return { table: 'notes', id: data.noteId }
    case 'todoCompletions':
      return { table: 'todos', id: data.todoId }
    case 'goalContributors':
      return { table: 'goals', id: data.goalId }
    case 'goalEntries':
      return { table: 'goalContributors', id: data.contributorId }
    case 'problemAttempts':
      return { table: 'problemTemplates', id: data.templateId }
    case 'attachments':
      return { table: OWNER_TABLE[data.ownerType as AttachmentOwner], id: data.ownerId }
    default:
      return null
  }
}

const exists = async (table: SyncedTable, id: string) => (await db.table(table).get(id)) !== undefined

async function remove(table: SyncedTable, id: string) {
  const removeFn = REMOVE[table]
  if (removeFn) await removeFn(id)
  else await db.table(table).delete(id)
}

// `pulled`: the records this pull changed, oldest change first.
// `tagAliases`: tags deleted for having the same name as another, and their survivor.
export async function repairAfterPull(pulled: ServerRecord[], tagAliases: Record<string, string>): Promise<void> {
  await moveLociOffAliasedTags(tagAliases)

  // Deleted elsewhere: what was added under it here goes too.
  for (const record of pulled) if (record.deleted) await remove(record.table, record.id)

  // Added elsewhere under something deleted here: it goes.
  for (const record of pulled) {
    if (record.deleted || !(await exists(record.table, record.id))) continue
    if (record.table === 'links') {
      await repairLink(record.data as unknown as Link)
      continue
    }
    const parent = parentOf(record)
    if (parent && !(await exists(parent.table, parent.id))) await remove(record.table, record.id)
  }
}

async function moveLociOffAliasedTags(aliases: Record<string, string>) {
  if (Object.keys(aliases).length === 0) return
  const now = Date.now()
  await db.transaction('rw', db.loci, async () => {
    for (const locus of await db.loci.toArray()) {
      if (!locus.tagIds.some((id) => id in aliases)) continue
      const tagIds = [...new Set(locus.tagIds.map((id) => aliases[id] ?? id))]
      await db.loci.update(locus.id, { tagIds, updatedAt: now })
    }
  })
}

// A link with a missing end goes. If what a to-do waited for is gone, the to-do
// is due now, as when deleting here.
async function repairLink(link: Link) {
  const ends: ItemRef[] = [link.from, link.to]
  const missing: ItemRef[] = []
  for (const end of ends) if (!(await exists(TABLE_OF[end.type], end.id))) missing.push(end)
  if (missing.length === 0) return
  await db.transaction('rw', db.links, db.todos, async () => {
    if (missing.includes(link.from)) await wakeDependents([link.from])
    await db.links.delete(link.id)
  })
}
