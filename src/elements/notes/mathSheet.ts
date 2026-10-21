// Editing math in a note: MathLive's visual math field (fractions, roots and
// powers appear as you type; an on-screen math keyboard on phones), in a sheet
// at the top of the screen so that keyboard doesn't cover it. MathLive is loaded
// the first time it's needed. Notes show math with KaTeX.

import { h } from '../../dom'
import { createMathField } from '../../mathField'
import { button, openSheet, sheetActions, submitButton } from '../../sheet'

export type MathResult = { latex: string } | 'delete'

// Resolves with the new LaTeX, 'delete', or null if cancelled.
export async function editMath(latex: string, editing: boolean, display: 'inline' | 'block'): Promise<MathResult | null> {
  const field = await createMathField(latex, 'Math')

  return openSheet<MathResult>('Math', (api) => ({
    content: [
      h('h2', {}, editing ? 'Edit math' : display === 'block' ? 'Add a formula' : 'Add math'),
      field,
      h('p', { class: 'field-hint' }, 'Type as you would write it: / makes a fraction, ^ a power. On a phone, the math keyboard has the rest.'),
      sheetActions(
        editing && button('Delete', () => api.close('delete'), 'danger-text'),
        button('Cancel', () => api.close(null)),
        submitButton('Done'),
      ),
    ],
    onSubmit: () => api.close(field.value.trim() ? { latex: field.value } : editing ? 'delete' : null),
    focus: field,
    placement: 'top',
  }))
}
