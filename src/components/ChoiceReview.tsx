import { useEffect, useRef, useState } from "react";
import { isCalm } from "../motion";
import { makeQuestion } from "../questions";
import { Rating, type Grade } from "../scheduler";
import { sounds } from "../sound";
import type { Card, ReviewResult } from "../types";
import { ChoiceButtons } from "./ChoiceButtons";
import { GradeButtons } from "./GradeButtons";
import { MathText } from "./MathText";
import { PlayingCard } from "./PlayingCard";

type Props = {
  card: Card;
  otherBacks: string[]; // for multiple-choice flashcards: wrong options
  dueDates?: Record<Grade, Date>; // missing in practice mode
  now: Date;
  onAnswer: (correct: boolean) => void; // the moment an option is picked
  onRate: (grade: Grade, result: ReviewResult) => void;
  onSkip: () => void;
};

const SHAKE_MS = 450;

// A multiple-choice card: problems (formula and table) and multiple-choice flashcards.
//   Right answer: the card hops, shines and gets a stamp; problems ask
//                 Hard / Good / Easy (Good suggested), flashcards just say Next (counts as Good).
//   Wrong answer: the card shakes, then flips to show the answer (and worked
//                 solution); rated Again.
export function ChoiceReview({ card, otherBacks, dueDates, now, onAnswer, onRate, onSkip }: Props) {
  // A new question (new numbers, new options) each time this component appears.
  const [question] = useState(() => makeQuestion(card, otherBacks));
  const [picked, setPicked] = useState<string | null>(null);
  const [shaking, setShaking] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const flipTimer = useRef<number | undefined>(undefined);
  const correct = picked === question.answer;

  // Don't leave a timer running if the card goes away early.
  useEffect(() => () => window.clearTimeout(flipTimer.current), []);

  function handlePick(option: string) {
    setPicked(option);
    onAnswer(option === question.answer);
    if (option === question.answer) {
      sounds.correct();
      return;
    }
    sounds.wrong();
    if (isCalm()) {
      setFlipped(true);
      return;
    }
    setShaking(true);
    flipTimer.current = window.setTimeout(() => {
      setShaking(false);
      setFlipped(true);
      sounds.flip();
    }, SHAKE_MS);
  }

  const prompt = (
    <div className="card-text">
      <MathText text={question.prompt} />
    </div>
  );

  return (
    <>
      <div className="card-stage">
        <PlayingCard
          type={card.type}
          shake={shaking}
          celebrate={picked !== null && correct}
          flipped={flipped}
          front={
            <>
              {prompt}
              {picked !== null && correct && <div className="stamp correct">✓ Correct</div>}
            </>
          }
          back={
            <>
              <div className="card-text small-text">
                <MathText text={question.prompt} />
              </div>
              <hr />
              <div className="stamp wrong">✗ Not quite</div>
              <div className="card-text">
                Answer: <strong><MathText text={question.answer} /></strong>
              </div>
              {question.solution && (
                <div className="card-text solution">
                  <MathText text={question.solution} />
                </div>
              )}
            </>
          }
        />
      </div>

      <div className="controls">
        <ChoiceButtons
          options={question.options}
          answer={question.answer}
          picked={picked}
          onPick={handlePick}
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
      </div>
    </>
  );
}
