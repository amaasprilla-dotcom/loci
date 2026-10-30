// How study work reads: "14 cards, 6 problems, 1 note", "~12 min".

import { count, formatNumber } from '../locale'

export function minutesText(seconds: number): string {
  return `~${formatNumber(Math.max(1, Math.round(seconds / 60)))} min`
}

export function studyCounts(cards: number, problems: number, notes = 0): string {
  return [cards > 0 && count(cards, 'card', 'cards'), problems > 0 && count(problems, 'problem', 'problems'), notes > 0 && count(notes, 'note', 'notes')].filter(Boolean).join(', ')
}
