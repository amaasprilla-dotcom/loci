import { useRef, type ReactNode } from "react";
import { isCalm } from "../motion";
import type { Card } from "../types";
import { FitText } from "./FitText";
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

// A study card: white, rounded, with its type labelled in the corner. Every card
// is the same size; long text shrinks to fit. It floats gently, leans toward
// the mouse, and can flip in 3D.
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
              <CardLabel type={type} />
              <FitText className="card-content" largest={1.3} smallest={0.75}>
                <div className="card-content-inner">{front}</div>
              </FitText>
            </div>
            {back && (
              <div className={`card-side back type-${type}`} aria-hidden={!flipped}>
                <CardLabel type={type} />
                  <FitText className="card-content" largest={1.3} smallest={0.75}>
                  <div className="card-content-inner">{back}</div>
                </FitText>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// The card type in the top-left corner: an icon and its name.
function CardLabel({ type }: { type: Card["type"] }) {
  return (
    <span className="card-label">
      <SuitIcon type={type} />
      {TYPE_NAMES[type]}
    </span>
  );
}
