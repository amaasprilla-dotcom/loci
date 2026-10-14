import { useEffect } from "react";
import { formatInterval, GRADES, type Grade } from "../scheduler";

type Props = {
  dueDates: Record<Grade, Date>; // when the card would come back for each rating
  now: Date;
  onRate: (grade: Grade) => void;
  allowed?: Grade[]; // which buttons to show (default: all four)
  preselected?: Grade; // highlighted and focused, so Enter picks it
};

// The Again / Hard / Good / Easy buttons, each showing its next interval.
// Keys 1-4 also work on a keyboard.
export function GradeButtons({ dueDates, now, onRate, allowed, preselected }: Props) {
  const shown = GRADES.filter(({ grade }) => !allowed || allowed.includes(grade));

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const grade = Number(event.key) as Grade;
      if (shown.some((g) => g.grade === grade)) onRate(grade);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="grade-row" style={{ gridTemplateColumns: `repeat(${shown.length}, 1fr)` }}>
      {shown.map(({ grade, label }) => (
        <button
          key={grade}
          className={`grade grade-${grade}${grade === preselected ? " selected" : ""}`}
          autoFocus={grade === preselected}
          onClick={() => onRate(grade)}
        >
          <span>{label}</span>
          <small>{formatInterval(now, dueDates[grade])}</small>
        </button>
      ))}
    </div>
  );
}
