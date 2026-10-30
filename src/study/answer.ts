// Typed answers for flashcards (SPEC-v3-coach.md, "Typed answers"): the app checks
// what was typed against the card's back, forgiving case, accents, punctuation,
// spacing and a typo or two, and the rating is derived like a problem's.

import type { Grade } from '../types'
import { MEDIAN_AFTER, median, QUICK } from '../elements/problems/schedule'

export const MAX_TYPED_LENGTH = 80 // longer backs are explanations, not answers: those cards flip

// Lowercase, no accents, punctuation as spaces, one space between words.
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = row
  }
  return prev[b.length]
}

// Typos allowed for an answer this long: none up to 4 characters, 1 up to 10, then 2.
export function allowedTypos(length: number): number {
  return length <= 4 ? 0 : length <= 10 ? 1 : 2
}

// The answers a back accepts: the whole back, and each part of "a; b" or "a / b".
// A bare slash stays part of the answer ("km/h").
export function acceptedAnswers(back: string): string[] {
  const parts = back.split(/;|\s\/\s|\n/).map(normalize).filter(Boolean)
  return [...new Set([normalize(back), ...parts])].filter(Boolean)
}

export function checkAnswer(typed: string, back: string): boolean {
  const t = normalize(typed)
  if (!t) return false
  return acceptedAnswers(back).some((a) => levenshtein(t, a) <= allowedTypos(a.length))
}

// Whether a card can be answered by typing; if not it flips, even in a Type deck.
export function typeable(back: string): boolean {
  const b = back.trim()
  return b.length > 0 && b.length <= MAX_TYPED_LENGTH && normalize(b).length > 0
}

// Wrong: Again. Right: Good, or Easy when quicker than 0.6× your median on this
// card. `previous`: times (ms) of earlier right answers on it; no median before 3.
export function typedGrade(correct: boolean, ms: number, previous: number[]): Grade {
  if (!correct) return 0
  if (previous.length < MEDIAN_AFTER) return 2
  return ms < QUICK * median(previous) ? 3 : 2
}
