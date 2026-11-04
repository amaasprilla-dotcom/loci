// Typing in a note: Markdown-style shortcuts the editor doesn't have on its own,
// and a Tab key that always stays in the note (Escape still leaves the screen).
//
// Already built in (StarterKit): **bold**, *italic*, _italic_, ~~strike~~, `code`,
// "- " / "* " bullets, "1. " numbers, "> " quotes, "# " headings.
// Added here: ~strike~, ++underline++, and lettered and roman lists ("a. ", "A) ",
// "i. ", "IV. ").

import { Extension, InputRule, markInputRule, wrappingInputRule } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'

// One tilde each side, not two (that's StarterKit's own rule), no space just inside.
const STRIKE = /(?:^|\s)(~(?!\s)([^~]+?)(?<!\s)~)$/
const UNDERLINE = /(?:^|\s)(\+\+(?!\s)([^+]+?)(?<!\s)\+\+)$/

// "a. " lettered; "i. ", "ii. ", "iv. " roman. A single letter other than i is a letter
// (so "c. " means the third, not a hundred), as is v or x on its own.
const LIST_MARKER = /^([a-zA-Z]|i{2,3}|iv|vi{0,3}|ix|I{2,3}|IV|VI{0,3}|IX)[.)]\s$/
const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x']

export function markerAttrs(marker: string): { type: 'a' | 'A' | 'i' | 'I'; start: number } {
  const lower = marker.toLowerCase()
  const upper = marker !== lower
  if (lower === 'i' || (marker.length > 1 && ROMAN.includes(lower))) return { type: upper ? 'I' : 'i', start: ROMAN.indexOf(lower) + 1 }
  return { type: upper ? 'A' : 'a', start: lower.charCodeAt(0) - 96 }
}

// Where in a list the cursor is: the list item's depth, or -1.
function listItemDepth(state: { selection: { $from: { depth: number; node(d: number): PMNode } } }): number {
  const { $from } = state.selection
  for (let d = $from.depth; d > 0; d--) {
    const name = $from.node(d).type.name
    if (name === 'listItem' || name === 'taskItem') return d
  }
  return -1
}

export const NoteTyping = Extension.create({
  name: 'noteTyping',
  // Runs after the list and table keys: Tab here is only what they didn't take.
  priority: 10,

  addInputRules() {
    const { strike, underline } = this.editor.schema.marks
    const { orderedList } = this.editor.schema.nodes
    const rules: InputRule[] = []
    if (strike) rules.push(markInputRule({ find: STRIKE, type: strike }))
    if (underline) rules.push(markInputRule({ find: UNDERLINE, type: underline }))
    if (orderedList) {
      rules.push(
        wrappingInputRule({
          find: LIST_MARKER,
          type: orderedList,
          getAttributes: (match) => markerAttrs(match[1]),
          // Typed right under a list of the same style, at the next letter: it carries on.
          joinPredicate: (match, node) => {
            const { type, start } = markerAttrs(match[1])
            return node.attrs.type === type && node.attrs.start + node.childCount === start
          },
        }),
      )
    }
    return rules
  },

  addKeyboardShortcuts() {
    return {
      // In a list the list keys indent (or, on a first item, can't): either way the
      // key stays here instead of moving to the next button on the page.
      Tab: ({ editor }) => {
        if (listItemDepth(editor.state) >= 0) return true
        return editor.commands.insertContent('\t')
      },
      'Shift-Tab': ({ editor }) => {
        if (listItemDepth(editor.state) >= 0) return true
        const { $from, empty } = editor.state.selection
        if (empty && $from.parent.textBetween(Math.max(0, $from.parentOffset - 1), $from.parentOffset) === '\t') {
          return editor.commands.deleteRange({ from: $from.pos - 1, to: $from.pos })
        }
        return true
      },
    }
  },
})
