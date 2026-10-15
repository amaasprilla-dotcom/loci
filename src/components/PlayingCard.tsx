import { useRef, type ReactNode } from "react";
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
  correct?: boolean; // green glow
};

// A card that looks like a card: paper, rounded corners, a colored frame and
// suit icons for its type. It floats gently, leans toward the mouse, and can
// flip in 3D. (The wrappers and their movement are explained in cards.css.)
export function PlayingCard({ type, front, back, flipped = false, shake = false, correct = false }: Props) {
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
  if (correct) className += " correct";

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
              {front}
            </div>
            {back && (
              <div className={`card-side back type-${type}`} aria-hidden={!flipped}>
                <Corners type={type} />
                {back}
              </div>
            )}
          </div>
        </div>
      </div>
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
