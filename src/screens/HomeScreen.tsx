import { useState } from "react";
import type { AppActions } from "../useAppData";

type Props = {
  app: AppActions;
  onOpenDeck: (deckId: string) => void;
  onStudy: (deckIds: string[]) => void;
};

export function HomeScreen({ app, onOpenDeck, onStudy }: Props) {
  const [newDeckName, setNewDeckName] = useState("");
  const decks = app.data.decks;
  const allDeckIds = decks.map((d) => d.id);
  const totalDue = app.dueCardIds(allDeckIds).length;

  function handleAddDeck(event: React.FormEvent) {
    event.preventDefault();
    const name = newDeckName.trim();
    if (!name) return;
    app.addDeck(name);
    setNewDeckName("");
  }

  return (
    <div className="screen">
      <h1>Study</h1>

      <button className="primary big" disabled={totalDue === 0} onClick={() => onStudy(allDeckIds)}>
        {totalDue === 0 ? "Nothing due" : `Study all · ${totalDue} due`}
      </button>

      <h2>Decks</h2>
      {decks.length === 0 && <p className="muted">No decks yet. Create one below.</p>}
      <ul className="list">
        {decks.map((deck) => {
          const due = app.dueCardIds([deck.id]).length;
          return (
            <li key={deck.id}>
              <button className="list-item" onClick={() => onOpenDeck(deck.id)}>
                <span>{deck.name}</span>
                <span className="muted">
                  {deck.cardIds.length} cards{due > 0 && <strong className="due"> · {due} due</strong>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

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
