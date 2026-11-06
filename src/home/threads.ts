// Tag threads (SPEC-v8-experimental.md, "Tag threads"): loci that share a tag are joined
// by a faint line, center to center, and move together when one is dragged.

export interface ThreadLocus {
  id: string
  tagIds: string[]
  x: number // any units, the same for all
  y: number
}

// One line between two loci, and every tag they share.
export interface Thread {
  a: string
  b: string
  tagIds: string[]
}

// For each tag, the shortest set of lines joining all its loci (a minimum spanning tree,
// Prim's), so a cluster of five gets four lines, not ten. Two loci joined by several tags
// get one line carrying them all.
export function tagEdges(loci: ThreadLocus[]): Thread[] {
  const byTag = new Map<string, ThreadLocus[]>()
  for (const l of loci) for (const t of new Set(l.tagIds)) byTag.set(t, [...(byTag.get(t) ?? []), l])
  const threads = new Map<string, Thread>()
  for (const [tagId, members] of byTag) {
    if (members.length < 2) continue
    const inTree = new Set<string>([members[0].id])
    // Each locus outside the tree: its nearest locus inside, and how far.
    const best = new Map(members.slice(1).map((m) => [m.id, { from: members[0], d: dist(m, members[0]) }]))
    while (best.size > 0) {
      let pick: string | null = null
      for (const [id, b] of best) if (pick === null || b.d < best.get(pick)!.d) pick = id
      const to = members.find((m) => m.id === pick)!
      const from = best.get(pick!)!.from
      best.delete(pick!)
      inTree.add(to.id)
      const [a, b] = from.id < to.id ? [from.id, to.id] : [to.id, from.id]
      const key = `${a}|${b}`
      const thread = threads.get(key) ?? { a, b, tagIds: [] }
      thread.tagIds.push(tagId)
      threads.set(key, thread)
      for (const [id, entry] of best) {
        const m = members.find((x) => x.id === id)!
        const d = dist(m, to)
        if (d < entry.d) best.set(id, { from: to, d })
      }
    }
  }
  return [...threads.values()]
}

// The loci that move with this one when it's dragged. With no tag selected: every locus
// sharing any tag with it. With a tag selected, it moves alone, so loci can be arranged
// inside their group.
export function groupOf(id: string, loci: ThreadLocus[], selectedTag: string | null): string[] {
  if (selectedTag) return []
  const self = loci.find((l) => l.id === id)
  if (!self || self.tagIds.length === 0) return []
  const tags = new Set(self.tagIds)
  return loci.filter((l) => l.id !== id && l.tagIds.some((t) => tags.has(t))).map((l) => l.id)
}

const dist = (p: ThreadLocus, q: ThreadLocus) => Math.hypot(p.x - q.x, p.y - q.y)
