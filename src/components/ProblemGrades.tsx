import { Rating, type Grade } from "../scheduler";
import { GradeButtons } from "./GradeButtons";

// How a problem card went:
// - correct: right answer        -> Hard / Good / Easy, Good suggested
// - almost:  right except accents -> Again / Hard, Hard suggested
// - wrong:   wrong answer         -> Again only
// - self:    user chose to just see the answer -> all four, user decides
export type Outcome = "correct" | "almost" | "wrong" | "self";

const BUTTONS: Record<Outcome, { allowed?: Grade[]; preselected?: Grade }> = {
  correct: { allowed: [Rating.Hard, Rating.Good, Rating.Easy], preselected: Rating.Good },
  almost: { allowed: [Rating.Again, Rating.Hard], preselected: Rating.Hard },
  wrong: { allowed: [Rating.Again], preselected: Rating.Again },
  self: {},
};

type Props = {
  outcome: Outcome;
  dueDates: Record<Grade, Date>;
  now: Date;
  onRate: (grade: Grade) => void;
};

// The rating buttons to show after a problem card has been answered.
export function ProblemGrades({ outcome, dueDates, now, onRate }: Props) {
  const { allowed, preselected } = BUTTONS[outcome];
  return (
    <GradeButtons
      dueDates={dueDates}
      now={now}
      onRate={onRate}
      allowed={allowed}
      preselected={preselected}
    />
  );
}
