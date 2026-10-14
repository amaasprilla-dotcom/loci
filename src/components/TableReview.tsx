import { useState } from "react";
import type { Grade } from "../scheduler";
import { checkTypedAnswer, makeTableVariant } from "../table";
import type { TableProblem } from "../types";
import { MathText } from "./MathText";
import { ProblemGrades, type Outcome } from "./ProblemGrades";

type Props = {
  card: TableProblem;
  dueDates: Record<Grade, Date>;
  now: Date;
  onRate: (grade: Grade) => void;
};

export function TableReview({ card, dueDates, now, onRate }: Props) {
  // A new random cell each time this component appears.
  const [variant] = useState(() => makeTableVariant(card));
  const [input, setInput] = useState(""); // typed mode
  const [picked, setPicked] = useState<string | null>(null); // choice mode
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  function handleTypedCheck(event: React.FormEvent) {
    event.preventDefault();
    if (!input.trim()) return;
    setOutcome(checkTypedAnswer(input, variant.answer, card.ignoreAccents));
  }

  function handlePick(option: string) {
    setPicked(option);
    setOutcome(option === variant.answer ? "correct" : "wrong");
  }

  return (
    <>
      <div className="card-face">
        <div className="card-text">
          <MathText text={variant.prompt} />
        </div>

        {/* Typed mode: after answering, show how it went and the right answer. */}
        {card.mode === "typed" && outcome && (
          <>
            <hr />
            {outcome === "correct" && <div className="feedback correct">✓ Correct</div>}
            {outcome === "almost" && (
              <div className="feedback almost">≈ Almost: check the accents. You typed “{input.trim()}”</div>
            )}
            {outcome === "wrong" && <div className="feedback wrong">✗ You typed “{input.trim()}”</div>}
            <div className="card-text">
              Answer: <strong><MathText text={variant.answer} /></strong>
            </div>
          </>
        )}
      </div>

      {card.mode === "typed" && outcome === null && (
        <form className="answer-form" onSubmit={handleTypedCheck}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Your answer"
            aria-label="Your answer"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
          />
          <button type="submit" className="primary">
            Check
          </button>
        </form>
      )}

      {/* Choice mode: options stay visible; after a pick, the right one turns green. */}
      {card.mode === "choice" && (
        <div className="options">
          {variant.options.map((option) => {
            let className = "option";
            if (outcome && option === variant.answer) className += " correct";
            else if (option === picked) className += " wrong";
            return (
              <button
                key={option}
                className={className}
                disabled={outcome !== null}
                onClick={() => handlePick(option)}
              >
                <MathText text={option} />
              </button>
            );
          })}
        </div>
      )}

      {outcome === null && (
        <button className="link" onClick={() => setOutcome("self")}>
          Show answer / I'll self-grade
        </button>
      )}

      {outcome && <ProblemGrades outcome={outcome} dueDates={dueDates} now={now} onRate={onRate} />}
    </>
  );
}
