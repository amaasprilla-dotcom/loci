// Two lists of the same kind side by side become one list. Splitting a numbered
// list (Enter on an empty item) leaves two lists with a paragraph between; deleting
// that paragraph left them as two lists touching, the second counting from 1 again.
// Merged, the numbers run on as one list. Also covers pastes and drags that put
// lists next to each other.

import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'

const LISTS = new Set(['bulletList', 'orderedList', 'taskList'])

// Same kind, and for numbered lists the same style (1, a, i...): "a, b" then "1, 2" stay apart.
function sameList(a: PMNode, b: PMNode): boolean {
  if (a.type !== b.type || !LISTS.has(a.type.name)) return false
  return a.type.name !== 'orderedList' || (a.attrs.type ?? null) === (b.attrs.type ?? null)
}

// Positions between two touching lists that should be one, last first (so joining
// one doesn't shift the others).
export function joinPoints(doc: PMNode): number[] {
  const points: number[] = []
  // `start`: where the node's content begins.
  const walk = (node: PMNode, start: number) => {
    let prev: PMNode | null = null
    node.forEach((child, offset) => {
      const pos = start + offset
      if (prev && sameList(prev, child)) points.push(pos)
      if (!child.isTextblock && !child.isLeaf) walk(child, pos + 1)
      prev = child
    })
  }
  walk(doc, 0)
  // Joining at a point only moves what comes after it, so going from the end back is safe.
  return points.sort((a, b) => b - a)
}

export const ListJoin = Extension.create({
  name: 'listJoin',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('listJoin'),
        appendTransaction: (transactions, _old, state): Transaction | null => {
          if (!transactions.some((tr) => tr.docChanged)) return null
          const points = joinPoints(state.doc)
          if (points.length === 0) return null
          const tr = state.tr
          for (const p of points) tr.join(p)
          return tr
        },
      }),
    ]
  },
})
