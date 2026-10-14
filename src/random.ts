// Small helpers for randomness.

// Returns a shuffled copy (Fisher-Yates), leaving the original untouched.
export function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// A random whole number from 0 up to (but not including) length.
export function randomIndex(length: number): number {
  return Math.floor(Math.random() * length);
}
