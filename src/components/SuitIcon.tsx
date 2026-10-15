import type { Card } from "../types";

// Small original icons, one per card type (drawn for this app):
//   flashcard = spark (four-pointed star), formula = prism (hollow triangle),
//   table = tiles (four small diamonds).
const PATHS: Record<Card["type"], string> = {
  flashcard: "M12 1.5c.9 5.6 3.4 8.6 9.5 10.5-6.1 1.9-8.6 4.9-9.5 10.5-.9-5.6-3.4-8.6-9.5-10.5C8.6 10.1 11.1 7.1 12 1.5z",
  formula: "M12 2.5 22.5 20.5h-21zM12 9.5l-4.6 8h9.2z",
  table: "M12 2l4 4-4 4-4-4zM6 8l4 4-4 4-4-4zM18 8l4 4-4 4-4-4zM12 14l4 4-4 4-4-4z",
};

export function SuitIcon({ type }: { type: Card["type"] }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[type]} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}
