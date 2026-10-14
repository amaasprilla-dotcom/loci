import { useEffect, useState } from "react";
import { formatInterval, GRADES, previewDueDates, Rating, type Grade } from "../scheduler";
import type { AppActions } from "../useAppData";

// Cards that come due again within this many minutes (e.g. after "Again")
// are shown again later in the same session instead of waiting for next time.
const LEARN_AHEAD_MINUTES = 20;

type Props = {
  app: AppActions;
  deckIds: string[];
  onExit: () => void;
};

export function StudyScreen({ app, deckIds, onExit }: Props) {
  // The cards still to show, in order. Shuffled so decks and topics mix.
  const [queue, setQueue] = useState<string[]>(() => shuffle(app.dueCardIds(deckIds)));
  const [revealed, setRevealed] = useState(false);
  const [counts, setCounts] = useState<Record<Grade, number>>({
    [Rating.Again]: 0,
    [Rating.Hard]: 0,
    [Rating.Good]: 0,
    [Rating.Easy]: 0,
  });

  const cardId = queue[0];
  const card = cardId ? app.data.cards[cardId] : undefined;
  const reviewedCount = Object.values(counts).reduce((a, b) => a + b, 0);

  function handleRate(grade: Grade) {
    if (!cardId) return;
    const next = app.reviewCard(cardId, grade);
    setCounts((c) => ({ ...c, [grade]: c[grade] + 1 }));
    setRevealed(false);

    const learnAheadLimit = Date.now() + LEARN_AHEAD_MINUTES * 60_000;
    const comesBackSoon = next.due.getTime() <= learnAheadLimit;
    setQueue((q) => (comesBackSoon ? [...q.slice(1), cardId] : q.slice(1)));
  }

  // Keyboard shortcuts on desktop: Space shows the answer, 1-4 rate it.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!card) return;
      if (!revealed && (event.key === " " || event.key === "Enter")) {
        event.preventDefault();
        setRevealed(true);
      } else if (revealed && ["1", "2", "3", "4"].includes(event.key)) {
        handleRate(Number(event.key) as Grade);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!card) {
    return (
      <div className="screen">
        <h1>{reviewedCount === 0 ? "Nothing due right now" : "Session complete"}</h1>
        {reviewedCount === 0 ? (
          <p className="muted">Add cards or come back later.</p>
        ) : (
          <>
            <p>
              {reviewedCount} {reviewedCount === 1 ? "review" : "reviews"} done. Ratings:
            </p>
            <ul className="summary">
              {GRADES.map(({ grade, label }) => (
                <li key={grade}>
                  <span className={`grade-dot grade-${grade}`} /> {label}: {counts[grade]}
                </li>
              ))}
            </ul>
          </>
        )}
        <button className="primary" onClick={onExit}>
          Done
        </button>
      </div>
    );
  }

  const schedule = app.data.schedules[card.id];
  const now = new Date();
  const dueDates = previewDueDates(schedule, now);

  return (
    <div className="screen study">
      <div className="study-top">
        <button className="link" onClick={onExit}>
          ← Stop
        </button>
        <span className="muted">
          {reviewedCount} done · {queue.length} left
        </span>
      </div>

      <div className="card-face">
        <div className="card-text">{card.front}</div>
        {revealed && (
          <>
            <hr />
            <div className="card-text">{card.back}</div>
          </>
        )}
      </div>

      {revealed ? (
        <div className="grade-row">
          {GRADES.map(({ grade, label }) => (
            <button key={grade} className={`grade grade-${grade}`} onClick={() => handleRate(grade)}>
              <span>{label}</span>
              <small>{formatInterval(now, dueDates[grade])}</small>
            </button>
          ))}
        </div>
      ) : (
        <button className="primary big" onClick={() => setRevealed(true)}>
          Show answer
        </button>
      )}
    </div>
  );
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
