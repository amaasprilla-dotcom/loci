// MathLive's visual math field (fractions, roots and powers appear as you type;
// an on-screen math keyboard on phones), loaded the first time it's needed. Used
// by notes and problem templates. Typed decimals follow the number format setting.

import { separators } from './locale'

let ready: Promise<typeof import('mathlive')> | null = null

export function loadMathLive(): Promise<typeof import('mathlive')> {
  ready ??= import('mathlive').then((m) => {
    // Fonts ship with the app (scripts/copy-mathlive-assets.mjs), so math works offline.
    m.MathfieldElement.fontsDirectory = `${import.meta.env.BASE_URL}mathlive/fonts`
    m.MathfieldElement.soundsDirectory = null
    return m
  })
  return ready
}

export type MathField = InstanceType<(typeof import('mathlive'))['MathfieldElement']>

// A new math field holding `latex`.
export async function createMathField(latex: string, label: string): Promise<MathField> {
  const { MathfieldElement } = await loadMathLive()
  MathfieldElement.decimalSeparator = separators().decimal === ',' ? ',' : '.'
  const field = new MathfieldElement()
  field.value = latex
  field.classList.add('math-input')
  field.setAttribute('aria-label', label)
  return field
}
