import { useState } from "react";
import { PackList } from "../components/PackList";
import { formatInterval } from "../scheduler";
import { currentStreak } from "../streak";
import type { AppActions } from "../useAppData";
import { useNow } from "../useNow";

type Props = {
  app: AppActions;
  onOpenDeck: (deckId: string) => void;
  onStudy: (deckIds: string[]) => void;
};

export function HomeScreen({ app, onOpenDeck, onStudy }: Props) {
  const [newDeckName, setNewDeckName] = useState("");
  const decks = app.data.decks;
  const allDeckIds = decks.map((d) => d.id);

  const now = useNow();
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  const dueNow = app.dueCardIds(allDeckIds, now).length;
  const dueToday = app.dueCardIds(allDeckIds, endOfToday).length;
  const streak = currentStreak(app.data.reviewDays, now);
  const nextDue = app.nextDueDate(allDeckIds);

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

      <button className="primary big" disabled={dueNow === 0} onClick={() => onStudy(allDeckIds)}>
        {dueNow > 0
          ? `Study · ${dueNow} ${dueNow === 1 ? "card" : "cards"}`
          : nextDue
            ? "All caught up"
            : "No cards yet"}
      </button>
      {dueNow === 0 && nextDue && (
        <p className="muted center">Next card due in {formatInterval(now, nextDue)}.</p>
      )}

      {decks.length === 0 ? (
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
                    <span>{deck.name}</span>
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
    </div>
  );
}

