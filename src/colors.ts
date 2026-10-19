// Preset locus colors, offered as swatches in the create sheet (plus a custom picker).
export const PALETTE = [
  '#4f8ef7', // blue
  '#6c63ff', // indigo
  '#9b51e0', // purple
  '#e86fa8', // pink
  '#eb5757', // red
  '#f2994a', // orange
  '#f2c94c', // yellow
  '#8bc34a', // lime
  '#27ae60', // green
  '#2bb3c0', // teal
  '#8d6e63', // brown
  '#607d8b', // slate
]

// Black or white, whichever reads better on the given background.
export function textColorOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  // Pure contrast math flips to black at ~0.18, which puts black text on saturated
  // blues and purples where white reads better. 0.3 keeps white on those and
  // black on the light colors (yellow, lime, orange, teal, green, pink).
  return luminance < 0.3 ? '#ffffff' : '#0b0f14'
}
