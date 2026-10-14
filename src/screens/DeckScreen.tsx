import { useState } from "react";
import { formatInterval, isDue, State } from "../scheduler";
import type { AppActions } from "../useAppData";
import { MathText } from "../components/MathText";

type Props = {
  app: AppActions;
  deckId: string;
  onBack: () => void;
  onStudy: (deckIds: string[]) => void;
};

export function DeckScreen({ app, deckId, onBack, onStudy }: Props) {
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");

  const deck = app.data.decks.find((d) => d.id === deckId);
  if (!deck) {
    return (
      <div className="screen">
        <p>This deck no longer exists.</p>
        <button onClick={onBack}>Back</button>
      </div>
    );
  }

  const dueCount = app.dueCardIds([deck.id]).length;
  const now = new Date();

  function handleAddCard(event: React.FormEvent) {
    event.preventDefault();
    if (!front.trim() || !back.trim()) return;
    app.addFlashcard(deckId, front.trim(), back.trim());
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
      <h1>{deck.name}</h1>

      <button className="primary big" disabled={dueCount === 0} onClick={() => onStudy([deck.id])}>
        {dueCount === 0 ? "Nothing due" : `Study · ${dueCount} due`}
      </button>

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
        <button type="submit" disabled={!front.trim() || !back.trim()}>
          Add card
        </button>
      </form>

      <h2>Cards ({deck.cardIds.length})</h2>
      {deck.cardIds.length === 0 && <p className="muted">No cards yet.</p>}
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
                  </>
                )}
                {card.type === "formula" && (
                  <>
                    <div>{card.prompt}</div>
                    <div className="muted">Formula problem · answer = {card.answer}</div>
                  </>
                )}
                {card.type === "table" && (
                  <>
                    <div>
                      <MathText text={card.prompt} />
                    </div>
                    <div className="muted">
                      Table problem · {card.rows.length} × {card.cols.length} ·{" "}
                      {card.mode === "typed" ? "type the answer" : "multiple choice"}
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
