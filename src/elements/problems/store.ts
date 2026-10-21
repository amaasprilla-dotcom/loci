// Problem templates and attempts in the database (SPEC-v2.md, "Problems").

import { db, deleteLinksFor } from '../../store/db'
import type { ProblemTemplate } from '../../types'
import { newSrs } from '../flashcards/srs'
import { constraintsLeaveRoom } from './engine'

// What the editor fills in; the rest (ids, scheduling) comes from the store.
export type TemplateDraft = Omit<ProblemTemplate, 'id' | 'elementId' | 'srs' | 'tooTight' | 'createdAt' | 'updatedAt'>

export function emptyDraft(): TemplateDraft {
  return {
    title: '',
    texts: [''],
    vars: [],
    mode: 'formula',
    answer: 0,
    derived: [],
    constraints: [],
    answerFormat: {},
    customDistractors: [],
    answerMode: 'choice',
  }
}

export async function listTemplates(elementId: string): Promise<ProblemTemplate[]> {
  const rows = await db.problemTemplates.where('elementId').equals(elementId).toArray()
  return rows.sort((a, b) => a.createdAt - b.createdAt)
}

// A new template is due straight away (SPEC-v2.md, "Authoring flow").
export async function createTemplate(elementId: string, draft: TemplateDraft, now = Date.now()): Promise<ProblemTemplate> {
  const t: ProblemTemplate = { ...draft, id: crypto.randomUUID(), elementId, srs: newSrs(now), createdAt: now, updatedAt: now }
  if (!constraintsLeaveRoom(t)) t.tooTight = true
  await db.problemTemplates.add(t)
  return t
}

// Editing keeps the template's schedule and history.
export async function updateTemplate(id: string, draft: TemplateDraft, now = Date.now()): Promise<void> {
  const old = await db.problemTemplates.get(id)
  if (!old) return
  const t: ProblemTemplate = { ...old, ...draft, updatedAt: now }
  delete t.tooTight
  if (!constraintsLeaveRoom(t)) t.tooTight = true
  await db.problemTemplates.put(t)
}

export async function deleteTemplate(id: string): Promise<void> {
  await db.transaction('rw', db.problemTemplates, db.problemAttempts, db.links, async () => {
    await db.problemAttempts.where('templateId').equals(id).delete()
    await deleteLinksFor([{ type: 'template', id }])
    await db.problemTemplates.delete(id)
  })
}
