import { useEffect, useState } from "react";
import type { Grade } from "../scheduler";
import type { Flashcard } from "../types";
import { GradeButtons } from "./GradeButtons";
import { MathText } from "./MathText";

type Props = {
  card: Flashcard;
  dueDates: Record<Grade, Date>;
  now: Date;
  onRate: (grade: Grade) => void;
};

// Front -> "Show answer" -> back + rating buttons.
export function FlashcardReview({ card, dueDates, now, onRate }: Props) {
  const [revealed, setRevealed] = useState(false);

  // Space or Enter shows the answer.
  useEffect(() => {
    if (revealed) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        setRevealed(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [revealed]);

  return (
    <>
      <div className="card-face">
        <div className="card-text">
          <MathText text={card.front} />
        </div>
        {revealed && (
          <>
            <hr />
            <div className="card-text">
              <MathText text={card.back} />
            </div>
          </>
        )}
      </div>

      {revealed ? (
        <GradeButtons dueDates={dueDates} now={now} onRate={onRate} />
      ) : (
        <button className="primary big" onClick={() => setRevealed(true)}>
          Show answer
        </button>
      )}
    </>
  );
}
