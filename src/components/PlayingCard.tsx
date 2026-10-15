import { useLayoutEffect, useRef, type ReactNode } from "react";
import { isCalm } from "../motion";
import type { Card } from "../types";
import { SuitIcon } from "./SuitIcon";

const TYPE_NAMES: Record<Card["type"], string> = {
  flashcard: "Flashcard",
  formula: "Formula problem",
  table: "Table problem",
};

type Props = {
  type: Card["type"];
  front: ReactNode;
  back?: ReactNode; // shown after the card flips
  flipped?: boolean;
  shake?: boolean;
  celebrate?: boolean; // a right answer: hop, shine and green glow
};

// A card that looks like a card: paper, rounded corners, a colored frame and
// suit icons for its type. Every card is the same size; long text shrinks to
// fit. It floats gently, leans toward the mouse, and can flip in 3D.
// (The wrappers and their movement are explained in cards.css.)
export function PlayingCard({ type, front, back, flipped = false, shake = false, celebrate = false }: Props) {
  const tiltRef = useRef<HTMLDivElement>(null);

  // Lean the card a little toward the mouse pointer (not on touch screens).
  function handlePointerMove(event: React.PointerEvent) {
    const el = tiltRef.current;
    if (!el || event.pointerType !== "mouse" || isCalm()) return;
    const box = el.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width - 0.5; // -0.5 (left) to 0.5 (right)
    const y = (event.clientY - box.top) / box.height - 0.5;
    el.style.setProperty("--ry", `${x * 10}deg`);
    el.style.setProperty("--rx", `${-y * 8}deg`);
  }

  function handlePointerLeave() {
    tiltRef.current?.style.setProperty("--ry", "0deg");
    tiltRef.current?.style.setProperty("--rx", "0deg");
  }

  let className = "playing-card";
  if (shake) className += " shake";
  if (celebrate) className += " celebrate";

  return (
    <div className={className}>
      <div className="card-float">
        <div
          className="card-tilt"
          ref={tiltRef}
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
        >
          <div className={`card-flip${flipped ? " flipped" : ""}`}>
            <div className={`card-side front type-${type}`} aria-hidden={flipped}>
              <Corners type={type} />
              <FittedContent>{front}</FittedContent>
            </div>
            {back && (
              <div className={`card-side back type-${type}`} aria-hidden={!flipped}>
                <Corners type={type} />
                <FittedContent>{back}</FittedContent>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const LARGEST_TEXT = 1.3; // rem
const SMALLEST_TEXT = 0.75; // rem

// The card's text area. If the text doesn't fit, it gets smaller step by step;
// only if it still doesn't fit at the smallest size can it scroll.
function FittedContent({ children }: { children: ReactNode }) {
  const boxRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    function fit() {
      if (!box) return;
      let size = LARGEST_TEXT;
      box.style.fontSize = `${size}rem`;
      const overflowing = () =>
        box.scrollHeight > box.clientHeight + 1 || box.scrollWidth > box.clientWidth + 1;
      while (overflowing() && size > SMALLEST_TEXT) {
        size = Math.round((size - 0.05) * 100) / 100;
        box.style.fontSize = `${size}rem`;
      }
    }
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  });

  return (
    <div className="card-content" ref={boxRef}>
      <div className="card-content-inner">{children}</div>
    </div>
  );
}

function Corners({ type }: { type: Card["type"] }) {
  return (
    <>
      <span className="corner top" title={TYPE_NAMES[type]}>
        <SuitIcon type={type} />
      </span>
      <span className="corner bottom" aria-hidden="true">
        <SuitIcon type={type} />
      </span>
    </>
  );
}
