// What's being edited right now (SPEC-v4-sync.md, "An open editor is never changed
// under the user's hands"). An editor registers the record it edits: a change to
// that record from another device is handed to the editor to show its bar, and
// screens aren't redrawn while anything is being edited.

import type { ServerRecord, SyncedTable } from './rules'

interface Editing {
  table: SyncedTable
  id: string
  changed(deleted: boolean): void
}

const editing = new Set<Editing>()

// Returns the function to call when editing ends. `id` may be null for something
// new, which no other device can have changed.
export function startEditing(table: SyncedTable, id: string | null, changed: (deleted: boolean) => void): () => void {
  const entry = { table, id: id ?? '', changed }
  editing.add(entry)
  return () => editing.delete(entry)
}

export function isEditing(): boolean {
  return editing.size > 0
}

export function tellEditors(records: ServerRecord[]): void {
  for (const entry of [...editing]) {
    const record = records.find((r) => r.table === entry.table && r.id === entry.id)
    if (record) entry.changed(record.deleted)
  }
}
