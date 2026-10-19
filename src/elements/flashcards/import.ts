// Bulk import: one card per line, front and back separated by a tab. This is
// Anki's plain-text export ("Notes in Plain Text"), and what you get when you
// copy two columns out of a spreadsheet.

export interface ParsedImport {
  cards: { front: string; back: string }[]
  skipped: number // non-empty lines without a tab, or with an empty side
}

export function parseImport(text: string): ParsedImport {
  const cards: ParsedImport['cards'] = []
  let skipped = 0
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (/^#[a-z ]+:/i.test(line)) continue // Anki header lines, e.g. "#separator:tab"
    const tab = raw.indexOf('\t')
    if (tab < 0) {
      skipped++
      continue
    }
    // Anki may add more columns (tags); only the first two are front and back.
    const [front, back] = raw.split('\t').map((s) => s.trim())
    if (!front || !back) {
      skipped++
      continue
    }
    cards.push({ front, back })
  }
  return { cards, skipped }
}
