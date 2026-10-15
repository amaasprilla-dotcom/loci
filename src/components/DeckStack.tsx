// A deck drawn as a physical stack of cards: the more cards, the taller the stack.

const CARDS_PER_LAYER = 4;
const MAX_LAYERS = 9;

type Props = {
  cardBack: string;
  cardCount: number;
  size?: "small" | "large";
};

export function DeckStack({ cardBack, cardCount, size = "small" }: Props) {
  const layers = Math.min(MAX_LAYERS, Math.max(1, Math.ceil(cardCount / CARDS_PER_LAYER)));

  // Each layer is a card edge peeking out below the top card, alternating
  // light and dark so the edges are visible.
  const edges = Array.from({ length: layers }, (_, i) => {
    const offset = (i + 1) * 2;
    const color = i % 2 === 0 ? "var(--paper-edge)" : "#b9ad8f";
    return `${offset / 2}px ${offset}px 0 0 ${color}`;
  });
  const shadow = [...edges, `${layers + 2}px ${layers * 2 + 6}px 10px rgba(0, 0, 0, 0.45)`].join(", ");

  return (
    <span
      className={`deck-stack card-back back-${cardBack} ${size}`}
      style={{ boxShadow: shadow, marginBottom: layers * 2 }}
      aria-hidden="true"
    />
  );
}
