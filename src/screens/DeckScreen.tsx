import { useState } from "react";
import { ExamChip } from "../components/ExamChip";
import { daysUntilExam, intervalCapDays } from "../exam";
import { formatInterval, isDue, State } from "../scheduler";
import type { AppActions } from "../useAppData";
import { MathText } from "../components/MathText";
import { useNow } from "../useNow";

type Props = {
  app: AppActions;
  deckId: string;
  onBack: () => void;
  onStudy: (deckIds: string[], practice?: boolean) => void;
};

export function DeckScreen({ app, deckId, onBack, onStudy }: Props) {
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [choice, setChoice] = useState(false);
  const now = useNow();

  const deck = app.data.decks.find((d) => d.id === deckId);
  if (!deck) {
    return (
      <div className="screen">
        <p>This deck no longer exists.</p>
        <button onClick={onBack}>Back</button>
      </div>
    );
  }

  const dueCount = app.dueCardIds([deck.id], now).length;
  const nextDue = app.nextDueDate([deck.id], now);
  const canPractice = app.practiceCardIds([deck.id]).length > 0;
  const daysLeft = deck.examDate ? daysUntilExam(deck.examDate, now) : undefined;

  function handleAddCard(event: React.FormEvent) {
    event.preventDefault();
    if (!front.trim() || !back.trim()) return;
    app.addFlashcard(deckId, front.trim(), back.trim(), choice);
    setFront("");
    setBack("");
  }

  function handleDeleteDeck() {
    if (confirm(`Delete the deck "${deck!.name}" and all its cards?`)) {
      app.deleteDeck(deckId);
      onBack();
    }
  }

  function dueLabel(cardId: string): string {
    const schedule = app.data.schedules[cardId];
    if (schedule.state === State.New) return "new";
    if (isDue(schedule, now)) return "due now";
    return `due in ${formatInterval(now, schedule.due)}`;
  }

  return (
    <div className="screen">
      <button className="link" onClick={onBack}>
        ← All decks
      </button>
      <h1>
        {deck.name} <ExamChip deck={deck} now={now} />
      </h1>

      {deck.archived ? (
        <div className="notice">
          This deck is archived, so it's left out of studying.{" "}
          <button className="small" onClick={() => app.setArchived(deck.id, false)}>
            Restore
          </button>
        </div>
      ) : (
        <>
          <button
            className="primary big"
            disabled={dueCount === 0}
            onClick={() => onStudy([deck.id])}
          >
            {dueCount === 0 ? "Nothing due" : `Study · ${dueCount} due`}
          </button>
          {dueCount === 0 && nextDue && (
            <p className="muted center">Next card due in {formatInterval(now, nextDue)}.</p>
          )}
          {canPractice && (
            <button onClick={() => onStudy([deck.id], true)}>
              Practice {dueCount === 0 ? "anyway" : "(without changing due dates)"}
            </button>
          )}
        </>
      )}

      <section className="panel">
        <h2>Exam date</h2>
        <div className="inline-form">
          <input
            type="date"
            aria-label="Exam date"
            value={deck.examDate ?? ""}
            onChange={(e) => app.setExamDate(deck.id, e.target.value || undefined)}
          />
          {deck.examDate && (
            <button onClick={() => app.setExamDate(deck.id, undefined)}>Clear</button>
          )}
        </div>
        <p className="muted">
          {daysLeft === undefined
            ? "Optional. With an exam date, reviews are packed closer together, all new cards are introduced by 3 days before, and every card comes up in the last 2 days."
            : daysLeft >= 0
              ? `Exam mode is on: no card is scheduled more than ${formatDays(intervalCapDays(daysLeft))} ahead, new cards are spread out until 3 days before, and every card comes up in the last 2 days.`
              : "The exam date has passed."}
        </p>
      </section>

      <h2>Add flashcard</h2>
      <form className="card-form" onSubmit={handleAddCard}>
        <label>
          Front
          <textarea value={front} onChange={(e) => setFront(e.target.value)} rows={2} />
        </label>
        <label>
          Back
          <textarea value={back} onChange={(e) => setBack(e.target.value)} rows={2} />
        </label>
        {(front.includes("$") || back.includes("$")) && (
          <div className="preview">
            <small className="muted">Preview</small>
            <div className="card-text">
              <MathText text={front} />
            </div>
            <div className="card-text muted">
              <MathText text={back} />
            </div>
          </div>
        )}
        <p className="muted hint">Tip: put math between dollar signs, e.g. {"$v = \\frac{d}{t}$"}</p>
        <label className="check">
          <input type="checkbox" checked={choice} onChange={(e) => setChoice(e.target.checked)} />
          Multiple choice: pick the back from 4 options (wrong ones come from other cards in this
          deck)
        </label>
        <button type="submit" disabled={!front.trim() || !back.trim()}>
          Add card
        </button>
      </form>

      <h2>Cards ({deck.cardIds.length})</h2>
      {deck.cardIds.length === 0 && (
        <p className="muted">No cards yet. Add your first one with the form above.</p>
      )}
      <ul className="list">
        {deck.cardIds.map((cardId) => {
          const card = app.data.cards[cardId];
          return (
            <li key={cardId} className="card-row">
              <div className="card-row-text">
                {card.type === "flashcard" && (
                  <>
                    <div>
                      <MathText text={card.front} />
                    </div>
                    <div className="muted">
                      <MathText text={card.back} />
                    </div>
                    <button
                      className="small toggle"
                      onClick={() => app.setFlashcardChoice(card.id, !card.choice)}
                    >
                      {card.choice ? "Multiple choice ✓" : "Show answer"} · change
                    </button>
                  </>
                )}
                {card.type === "formula" && (
                  <>
                    <div>{card.prompt}</div>
                    <div className="muted">
                      Formula problem · multiple choice · answer = {card.answer}
                    </div>
                  </>
                )}
                {card.type === "table" && (
                  <>
                    <div>
                      <MathText text={card.prompt} />
                    </div>
                    <div className="muted">
                      Table problem · {card.rows.length} × {card.cols.length} · multiple choice
                    </div>
                  </>
                )}
              </div>
              <div className="card-row-side">
                <small className="muted">{dueLabel(cardId)}</small>
                <button
                  className="danger small"
                  onClick={() => confirm("Delete this card?") && app.deleteCard(cardId)}
                >
                  Delete
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <button className="danger" onClick={handleDeleteDeck}>
        Delete deck
      </button>
    </div>
  );
}

// 1.5 -> "1.5 days", 1 -> "1 day"
function formatDays(days: number): string {
  const rounded = Math.round(days * 10) / 10;
  return `${rounded} ${rounded === 1 ? "day" : "days"}`;
}
