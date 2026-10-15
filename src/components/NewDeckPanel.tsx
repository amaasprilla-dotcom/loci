import { useState } from "react";
import { PACKS, type Pack } from "../packs";
import type { AppActions } from "../useAppData";

type Props = {
  app: AppActions;
  onCreated: () => void; // an empty deck was made
  onOpenPack: (pack: Pack) => void; // a built-in pack was chosen
};

// Making a new deck: start empty, or open one of the built-in packs.
export function NewDeckPanel({ app, onCreated, onOpenPack }: Props) {
  const [name, setName] = useState("");

  function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    app.addDeck(name.trim());
    setName("");
    onCreated();
  }

  return (
    <div className="new-deck">
      <form className="inline-form" onSubmit={handleCreate}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name your deck"
          aria-label="New deck name"
        />
        <button type="submit" disabled={!name.trim()}>
          Create empty deck
        </button>
      </form>

      <p className="muted">Or open a ready-made pack:</p>
      <div className="pack-grid">
        {PACKS.map((pack) => {
          const opened = app.data.decks.some((deck) => deck.packId === pack.id);
          const problems = pack.cards.filter((card) => card.type !== "flashcard").length;
          return (
            <button
              key={pack.id}
              className="pack-tile"
              disabled={opened}
              onClick={() => onOpenPack(pack)}
            >
              <span className="foil-strip" aria-hidden="true" />
              <span className="pack-tile-text">
                <strong>{pack.name}</strong>
                <span>{pack.description}</span>
                <small>
                  {pack.cards.length} cards · {problems} problem {problems === 1 ? "template" : "templates"}
                  {opened && " · opened ✓"}
                </small>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
