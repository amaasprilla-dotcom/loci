// Every task from every element in every locus (SPEC.md, "Tasks screen").
// Never stored: worked out from the elements each time, so it's always current.
// One result drives the Tasks screen, the home badge and which bubbles pulse.

import { type Task, registry } from '../elements/registry'
import { db } from '../store/db'

export async function allTasks(now = Date.now()): Promise<Task[]> {
  const [elements, loci] = await Promise.all([db.elements.toArray(), db.loci.toArray()])
  const locusOrder = new Map(loci.map((l) => [l.id, l.createdAt]))
  const elementOrder = new Map(elements.map((e) => [e.id, e.order]))
  const lists = await Promise.all(
    // A type this version doesn't know (e.g. from a newer backup) has no tasks.
    elements.map((el) => registry.get(el.type)?.getTasks(el, now) ?? Promise.resolve([])),
  )
  // Soonest first; ties (everything due "now") keep loci and elements in their usual order.
  return lists
    .flat()
    .sort(
      (a, b) =>
        a.dueAt - b.dueAt ||
        (locusOrder.get(a.locusId) ?? 0) - (locusOrder.get(b.locusId) ?? 0) ||
        (elementOrder.get(a.elementId) ?? 0) - (elementOrder.get(b.elementId) ?? 0),
    )
}

// The element whose work falls due soonest after now, for the empty Tasks screen.
// `locusIds` limits it to some loci (the tag filter).
export async function nextUpcoming(now: number, locusIds?: Set<string>): Promise<{ elementId: string; title: string; at: number } | null> {
  const elements = (await db.elements.toArray()).filter((el) => !locusIds || locusIds.has(el.locusId))
  let best: { elementId: string; title: string; at: number } | null = null
  for (const el of elements) {
    const at = await registry.get(el.type)?.nextDueAt?.(el, now)
    if (at != null && (best == null || at < best.at)) best = { elementId: el.id, title: el.title, at }
  }
  return best
}
