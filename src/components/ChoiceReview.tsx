import { useState } from "react";
import { makeQuestion } from "../questions";
import { Rating, type Grade } from "../scheduler";
import type { Card, ReviewResult } from "../types";
import { ChoiceButtons } from "./ChoiceButtons";
import { GradeButtons } from "./GradeButtons";
import { MathText } from "./MathText";

type Props = {
  card: Card;
  otherBacks: string[]; // for multiple-choice flashcards: wrong options
  dueDates?: Record<Grade, Date>; // missing in practice mode
  now: Date;
  onRate: (grade: Grade, result: ReviewResult) => void;
  onSkip: () => void;
};

// A multiple-choice card: problems (formula and table) and multiple-choice flashcards.
//   Right answer: problems ask Hard / Good / Easy (Good suggested);
//                 flashcards just say Next (counts as Good).
//   Wrong answer: shows the right answer (and worked solution), rated Again.
export function ChoiceReview({ card, otherBacks, dueDates, now, onRate, onSkip }: Props) {
  // A new question (new numbers, new options) each time this component appears.
  const [question] = useState(() => makeQuestion(card, otherBacks));
  const [picked, setPicked] = useState<string | null>(null);
  const correct = picked === question.answer;

  return (
    <>
      <div className="card-face">
        <div className="card-text">
          <MathText text={question.prompt} />
        </div>

        {picked !== null && (
          <>
            <hr />
            <div className={`feedback ${correct ? "correct" : "wrong"}`}>
              {correct ? "✓ Correct" : "✗ Not quite"}
            </div>
            {!correct && (
              <div className="card-text">
                Answer: <strong><MathText text={question.answer} /></strong>
              </div>
            )}
            {question.solution && (
              <div className="card-text solution">
                <MathText text={question.solution} />
              </div>
            )}
          </>
        )}
      </div>

      <ChoiceButtons
        options={question.options}
        answer={question.answer}
        picked={picked}
        onPick={setPicked}
      />

      {picked === null && (
        <button className="link skip" onClick={onSkip}>
          Skip this card →
        </button>
      )}

      {picked !== null && correct && question.askDifficulty && (
        <GradeButtons
          dueDates={dueDates}
          now={now}
          onRate={(grade) => onRate(grade, "correct")}
          allowed={[Rating.Hard, Rating.Good, Rating.Easy]}
          preselected={Rating.Good}
        />
      )}
      {picked !== null && correct && !question.askDifficulty && (
        <button className="primary big" autoFocus onClick={() => onRate(Rating.Good, "correct")}>
          Next
        </button>
      )}
      {picked !== null && !correct && (
        <GradeButtons
          dueDates={dueDates}
          now={now}
          onRate={(grade) => onRate(grade, "wrong")}
          allowed={[Rating.Again]}
          preselected={Rating.Again}
        />
      )}
    </>
  );
}
