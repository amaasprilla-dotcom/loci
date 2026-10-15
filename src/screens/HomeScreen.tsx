import { useState } from "react";
import { ExamChip } from "../components/ExamChip";
import { PackList } from "../components/PackList";
import { daysUntilExam } from "../exam";
import { formatInterval } from "../scheduler";
import { currentStreak } from "../streak";
import type { AppActions } from "../useAppData";
import { useNow } from "../useNow";

type Props = {
  app: AppActions;
  onOpenDeck: (deckId: string) => void;
  onStudy: (deckIds: string[], practice?: boolean) => void;
};

export function HomeScreen({ app, onOpenDeck, onStudy }: Props) {
  const [newDeckName, setNewDeckName] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const decks = app.data.decks.filter((d) => !d.archived);
  const archived = app.data.decks.filter((d) => d.archived);
  const deckIds = decks.map((d) => d.id);

  const now = useNow();
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  const dueNow = app.dueCardIds(deckIds, now).length;
  const dueToday = app.dueCardIds(deckIds, endOfToday).length;
  const streak = currentStreak(app.data.reviewDays, now);
  const nextDue = app.nextDueDate(deckIds, now);
  const canPractice = app.practiceCardIds(deckIds).length > 0;
  const examsOver = decks.filter((d) => d.examDate && daysUntilExam(d.examDate, now) < 0);

  function handleAddDeck(event: React.FormEvent) {
    event.preventDefault();
    const name = newDeckName.trim();
    if (!name) return;
    app.addDeck(name);
    setNewDeckName("");
  }

  return (
    <div className="screen">
      <div className="stats">
        <div className="stat">
          <strong>{dueToday}</strong>
          <span className="muted">due today</span>
        </div>
        <div className="stat">
          <strong>{streak}</strong>
          <span className="muted">day streak{streak > 0 && " 🔥"}</span>
        </div>
      </div>

      {/* The main Study button: a mixed session across all decks. */}
      <button className="primary big" disabled={dueNow === 0} onClick={() => onStudy(deckIds)}>
        {dueNow > 0
          ? `Study · ${dueNow} ${dueNow === 1 ? "card" : "cards"}`
          : nextDue
            ? "All caught up"
            : "No cards yet"}
      </button>
      {dueNow === 0 && nextDue && (
        <p className="muted center">Next card due in {formatInterval(now, nextDue)}.</p>
      )}
      {dueNow === 0 && canPractice && (
        <button onClick={() => onStudy(deckIds, true)}>Practice anyway</button>
      )}

      {examsOver.map((deck) => (
        <section key={deck.id} className="panel">
          <h2>Your {deck.name} exam has passed</h2>
          <p>Keep studying this deck for the long term?</p>
          <div className="button-row">
            <button className="primary" onClick={() => app.setExamDate(deck.id, undefined)}>
              Yes, keep studying
            </button>
            <button onClick={() => app.setArchived(deck.id, true)}>No, archive it</button>
          </div>
        </section>
      ))}

      {decks.length === 0 && archived.length === 0 ? (
        <>
          <h2>Welcome!</h2>
          <p className="muted">Add a ready-made pack to start studying, or create your own deck below.</p>
          <PackList app={app} />
        </>
      ) : (
        <>
          <h2>Decks</h2>
          <ul className="list">
            {decks.map((deck) => {
              const due = app.dueCardIds([deck.id], now).length;
              return (
                <li key={deck.id}>
                  <button className="list-item" onClick={() => onOpenDeck(deck.id)}>
                    <span>
                      {deck.name} <ExamChip deck={deck} now={now} />
                    </span>
                    <span className="muted">
                      {deck.cardIds.length} cards
                      {due > 0 && <strong className="due"> · {due} due</strong>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <form className="inline-form" onSubmit={handleAddDeck}>
        <input
          value={newDeckName}
          onChange={(e) => setNewDeckName(e.target.value)}
          placeholder="New deck name"
          aria-label="New deck name"
        />
        <button type="submit" disabled={!newDeckName.trim()}>
          Add deck
        </button>
      </form>

      {archived.length > 0 && (
        <>
          <button className="link" onClick={() => setShowArchived(!showArchived)}>
            {showArchived ? "Hide" : "Show"} archived decks ({archived.length})
          </button>
          {showArchived && (
            <ul className="list">
              {archived.map((deck) => (
                <li key={deck.id} className="card-row">
                  <button className="link" onClick={() => onOpenDeck(deck.id)}>
                    {deck.name}
                  </button>
                  <button className="small" onClick={() => app.setArchived(deck.id, false)}>
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
