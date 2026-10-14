import { useState } from "react";
import { checkAnswer, makeVariant } from "../formula";
import { Rating, type Grade } from "../scheduler";
import type { FormulaProblem } from "../types";
import { GradeButtons } from "./GradeButtons";
import { MathText } from "./MathText";

type Props = {
  card: FormulaProblem;
  dueDates: Record<Grade, Date>;
  now: Date;
  onRate: (grade: Grade) => void;
};

// What happened after the user answered:
// correct / wrong after typing, or "self" if they chose to just see the answer.
type Outcome = "correct" | "wrong" | "self";

export function FormulaReview({ card, dueDates, now, onRate }: Props) {
  // New random numbers each time this component appears.
  const [variant] = useState(() => makeVariant(card));
  const [input, setInput] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState("");

  function handleCheck(event: React.FormEvent) {
    event.preventDefault();
    const result = checkAnswer(input, variant, card);
    if (result === "not-a-number") {
      setError("Please type a number.");
      return;
    }
    setOutcome(result);
  }

  return (
    <>
      <div className="card-face">
        <div className="card-text">
          <MathText text={variant.prompt} />
        </div>

        {outcome && (
          <>
            <hr />
            {outcome === "correct" && <div className="feedback correct">✓ Correct: {input.trim()}</div>}
            {outcome === "wrong" && (
              <div className="feedback wrong">✗ You answered {input.trim()}</div>
            )}
            <div className="card-text">
              Answer: <strong>{variant.answerText}</strong>
            </div>
            {variant.solution && (
              <div className="card-text solution">
                <MathText text={variant.solution} />
              </div>
            )}
          </>
        )}
      </div>

      {outcome === null && (
        <>
          <form className="answer-form" onSubmit={handleCheck}>
            <input
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setError("");
              }}
              inputMode="decimal"
              placeholder="Your answer"
              aria-label="Your answer"
              autoFocus
            />
            <button type="submit" className="primary">
              Check
            </button>
          </form>
          {error && <p className="feedback wrong">{error}</p>}
          <button className="link" onClick={() => setOutcome("self")}>
            Show answer / I'll self-grade
          </button>
        </>
      )}

      {outcome === "correct" && (
        <GradeButtons
          dueDates={dueDates}
          now={now}
          onRate={onRate}
          allowed={[Rating.Hard, Rating.Good, Rating.Easy]}
          preselected={Rating.Good}
        />
      )}
      {outcome === "wrong" && (
        <GradeButtons
          dueDates={dueDates}
          now={now}
          onRate={onRate}
          allowed={[Rating.Again]}
          preselected={Rating.Again}
        />
      )}
      {outcome === "self" && <GradeButtons dueDates={dueDates} now={now} onRate={onRate} />}
    </>
  );
}
