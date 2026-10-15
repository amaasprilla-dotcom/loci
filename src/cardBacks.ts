// Card-back designs. Each one is a CSS pattern (see decks.css, ".back-<id>"),
// drawn for this app. All are available from the start.

import type { Deck } from "./types";

export const CARD_BACKS = [
  { id: "garnet", name: "Garnet stripes" },
  { id: "lagoon", name: "Lagoon dots" },
  { id: "meadow", name: "Meadow chevrons" },
  { id: "amethyst", name: "Amethyst diamonds" },
  { id: "sunrise", name: "Sunrise rays" },
  { id: "midnight", name: "Midnight stars" },
] as const;

// The deck's chosen back, or a stable default picked from its id.
export function cardBackOf(deck: Deck): string {
  if (deck.cardBack) return deck.cardBack;
  let hash = 0;
  for (const char of deck.id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return CARD_BACKS[hash % CARD_BACKS.length].id;
}
