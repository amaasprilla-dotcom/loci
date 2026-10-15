// A small "stack of cards" mark for a deck: the more cards, the more edges
// show behind the top card (up to 4).

const CARDS_PER_EDGE = 6;
const MAX_EDGES = 4;

type Props = {
  cardCount: number;
  size?: "small" | "large";
};

export function DeckStack({ cardCount, size = "small" }: Props) {
  const edges = Math.min(MAX_EDGES, Math.floor(cardCount / CARDS_PER_EDGE));

  // Each edge: a white card slightly smaller than its black outline, offset down and right.
  const shadows = Array.from({ length: edges }, (_, i) => {
    const offset = (i + 1) * 3;
    return `${offset}px ${offset}px 0 -1.5px #ffffff, ${offset}px ${offset}px 0 0 #0b0f14`;
  });

  return (
    <span
      className={`deck-stack ${size}`}
      style={{ boxShadow: shadows.join(", ") || undefined, marginRight: edges * 3, marginBottom: edges * 3 }}
      aria-hidden="true"
    />
  );
}
