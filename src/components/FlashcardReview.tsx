import { useEffect, useState } from "react";
import type { Grade } from "../scheduler";
import { sounds } from "../sound";
import type { Flashcard, ReviewResult } from "../types";
import { GradeButtons } from "./GradeButtons";
import { MathText } from "./MathText";
import { PlayingCard } from "./PlayingCard";

type Props = {
  card: Flashcard;
  dueDates?: Record<Grade, Date>; // missing in practice mode
  now: Date;
  onRate: (grade: Grade, result: ReviewResult) => void;
  onSkip: () => void;
};

// A classic flashcard: front -> "Show answer" (the card flips) -> Again / Hard / Good / Easy.
export function FlashcardReview({ card, dueDates, now, onRate, onSkip }: Props) {
  const [revealed, setRevealed] = useState(false);

  function reveal() {
    sounds.flip();
    setRevealed(true);
  }

  // Space or Enter shows the answer.
  useEffect(() => {
    if (revealed) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        sounds.flip();
        setRevealed(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [revealed]);

  return (
    <>
      <div className="card-stage">
        <PlayingCard
          type="flashcard"
          flipped={revealed}
          front={
            <div className="card-text">
              <MathText text={card.front} />
            </div>
          }
          back={
            <>
              <div className="card-text small-text">
                <MathText text={card.front} />
              </div>
              <hr />
              <div className="card-text">
                <MathText text={card.back} />
              </div>
            </>
          }
        />
      </div>

      <div className="controls">
        {revealed ? (
          <GradeButtons
            dueDates={dueDates}
            now={now}
            onRate={(grade) => onRate(grade, "flashcard")}
          />
        ) : (
          <>
            <button className="primary big" onClick={reveal}>
              Show answer
            </button>
            <button className="link skip" onClick={onSkip}>
              Skip this card →
            </button>
          </>
        )}
      </div>
    </>
  );
}
