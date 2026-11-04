import { getSchema } from '@tiptap/core'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import StarterKit from '@tiptap/starter-kit'
import { EditorState } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'
import { joinPoints } from './listJoin'

const schema = getSchema([StarterKit, TaskList, TaskItem.configure({ nested: true })])
const item = (text: string, ...more: object[]) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }, ...more] })
const ol = (attrs: object, ...items: object[]) => ({ type: 'orderedList', attrs, content: items })
const ul = (...items: object[]) => ({ type: 'bulletList', content: items })
const doc = (...content: object[]) => schema.nodeFromJSON({ type: 'doc', content })

// The document after joining at every point, as the plugin does.
function joined(...content: object[]) {
  const state = EditorState.create({ schema, doc: doc(...content) })
  const tr = state.tr
  for (const p of joinPoints(state.doc)) tr.join(p)
  return tr.doc.toJSON().content as { type: string; content?: unknown[] }[]
}

describe('joinPoints', () => {
  it('joins two numbered lists that touch, so numbering runs on', () => {
    const out = joined(ol({}, item('one'), item('two')), ol({}, item('three')))
    expect(out.map((n) => n.type)).toEqual(['orderedList'])
    expect(out[0].content).toHaveLength(3)
  })

  it('leaves lists apart when something is between them', () => {
    expect(joined(ol({}, item('one')), { type: 'paragraph' }, ol({}, item('two'))).map((n) => n.type)).toEqual(['orderedList', 'paragraph', 'orderedList'])
  })

  it('leaves different kinds and styles apart', () => {
    expect(joined(ol({}, item('one')), ul(item('two'))).map((n) => n.type)).toEqual(['orderedList', 'bulletList'])
    expect(joined(ol({ type: 'a' }, item('one')), ol({}, item('two'))).map((n) => n.type)).toEqual(['orderedList', 'orderedList'])
  })

  it('joins nested lists and runs of three', () => {
    const out = joined(ol({}, item('one', ul(item('a')), ul(item('b')))), ol({}, item('two')), ol({}, item('three')))
    expect(out).toHaveLength(1)
    expect(out[0].content).toHaveLength(3)
    const first = out[0].content![0] as { content: { type: string }[] }
    expect(first.content.map((n) => n.type)).toEqual(['paragraph', 'bulletList'])
  })
})
