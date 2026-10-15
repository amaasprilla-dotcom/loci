import { useState } from "react";
import { FlashcardReview } from "../components/FlashcardReview";
import { FormulaReview } from "../components/FormulaReview";
import { TableReview } from "../components/TableReview";
import { GRADES, previewDueDates, Rating, type Grade } from "../scheduler";
import type { ReviewResult } from "../types";
import type { AppActions } from "../useAppData";
import { shuffle } from "../random";

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
  // When the current card was shown. Used to label the rating buttons.
  const [shownAt, setShownAt] = useState(() => new Date());
  const [counts, setCounts] = useState<Record<Grade, number>>({
    [Rating.Again]: 0,
    [Rating.Hard]: 0,
    [Rating.Good]: 0,
    [Rating.Easy]: 0,
  });

  const cardId = queue[0];
  const card = cardId ? app.data.cards[cardId] : undefined;
  const reviewedCount = Object.values(counts).reduce((a, b) => a + b, 0);

  function handleRate(grade: Grade, result: ReviewResult) {
    if (!cardId) return;
    const durationMs = Date.now() - shownAt.getTime();
    const next = app.reviewCard(cardId, grade, result, durationMs);
    setCounts((c) => ({ ...c, [grade]: c[grade] + 1 }));

    const learnAheadLimit = Date.now() + LEARN_AHEAD_MINUTES * 60_000;
    const comesBackSoon = next.due.getTime() <= learnAheadLimit;
    setQueue((q) => (comesBackSoon ? [...q.slice(1), cardId] : q.slice(1)));
    setShownAt(new Date());
  }

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

  const dueDates = previewDueDates(app.data.schedules[card.id], shownAt);
  const reviewProps = { dueDates, now: shownAt, onRate: handleRate };
  const progress = reviewedCount / (reviewedCount + queue.length);

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
      <div className="progress" aria-hidden="true">
        <div style={{ width: `${progress * 100}%` }} />
      </div>

      {/* A new key after every rating makes React start the card fresh
          (new numbers, empty answer box), even if the same card comes back. */}
      {card.type === "flashcard" && (
        <FlashcardReview key={reviewedCount} card={card} {...reviewProps} />
      )}
      {card.type === "formula" && <FormulaReview key={reviewedCount} card={card} {...reviewProps} />}
      {card.type === "table" && <TableReview key={reviewedCount} card={card} {...reviewProps} />}
    </div>
  );
}

