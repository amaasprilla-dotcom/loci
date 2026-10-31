// Pasting into a note: rich text keeps its formatting (bold, colors, highlights,
// sizes, tables...), minus the parts that only restate the source's defaults.
// Google Docs, Word and web pages put a font, a size and black on every run of
// text; kept, those would make pasted text look unlike typed text for no reason.

// px at which a pasted size reads as ordinary body text (Docs' 11pt, Word's 12pt, 16px).
const BODY_PX = { min: 13, max: 17 }

// Whether a pasted style says something worth keeping. Fonts and line heights never are.
export function keepStyle(property: string, value: string): boolean {
  const v = value.trim().toLowerCase()
  if (property === 'font-family' || property === 'line-height') return false
  if (property === 'color') return !isPlainText(v)
  if (property === 'background-color') return !isNoBackground(v)
  if (property === 'font-size') {
    const px = toPx(v)
    return px != null && (px < BODY_PX.min || px > BODY_PX.max)
  }
  return true
}

function toPx(size: string): number | null {
  const m = /^([\d.]+)(px|pt|em|rem)$/.exec(size)
  if (!m) return null // keywords (medium, larger), percentages: leave the size alone
  const n = Number(m[1])
  return m[2] === 'pt' ? (n * 4) / 3 : m[2] === 'px' ? n : n * 16
}

// [r, g, b, alpha] of a hex, rgb() or rgba() color, or null.
function rgba(color: string): [number, number, number, number] | null {
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/.exec(color)
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1]
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1]
  }
  const fn = /^rgba?\(([^)]+)\)$/.exec(color)
  if (!fn) return null
  const parts = fn[1].split(/[\s,/]+/).filter(Boolean).map(Number)
  if (parts.length < 3 || parts.some(Number.isNaN)) return null
  return [parts[0], parts[1], parts[2], parts[3] ?? 1]
}

// Black or near-black grey: the source's ordinary text color.
function isPlainText(color: string): boolean {
  if (color === 'black' || color === 'windowtext' || color === 'inherit' || color === 'initial') return true
  const c = rgba(color)
  if (!c) return false
  const [r, g, b] = c
  return Math.max(r, g, b) < 64 && Math.max(r, g, b) - Math.min(r, g, b) < 16
}

function isNoBackground(color: string): boolean {
  if (color === 'transparent' || color === 'white' || color === 'window' || color === 'inherit' || color === 'initial') return true
  const c = rgba(color)
  if (!c) return false
  const [r, g, b, a] = c
  return a === 0 || Math.min(r, g, b) > 248
}

// Before the editor reads pasted HTML: drop the styles keepStyle turns down.
export function tidyPastedHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  for (const el of doc.body.querySelectorAll<HTMLElement>('[style]')) {
    for (const property of [...el.style]) {
      if (!keepStyle(property, el.style.getPropertyValue(property))) el.style.removeProperty(property)
    }
    // An empty style would still read as a (blank) text style around the text.
    if (el.style.length === 0) el.removeAttribute('style')
  }
  return doc.body.innerHTML
}

// Plain text that's really Markdown: headings, lists, quotes, code, tables, bold, links.
export function looksLikeMarkdown(text: string): boolean {
  return (
    /^(#{1,6} |\s*[-*+] |\s*\d+[.)] |> |```|\|.*\|\s*$)/m.test(text) ||
    /\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\)/.test(text)
  )
}
