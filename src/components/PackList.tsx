import { PACKS } from "../packs";
import type { AppActions } from "../useAppData";

// The built-in packs, each with a one-click "Add" button.
// Used on the Packs screen and on the Home screen for new users.
export function PackList({ app }: { app: AppActions }) {
  return (
    <ul className="list">
      {PACKS.map((pack) => {
        const added = app.data.decks.some((deck) => deck.packId === pack.id);
        const problemCount = pack.cards.filter((card) => card.type !== "flashcard").length;
        return (
          <li key={pack.id} className="pack">
            <div>
              <strong>{pack.name}</strong>
              <p className="muted">{pack.description}</p>
              <small className="muted">
                {pack.cards.length} cards · {problemCount} problem{" "}
                {problemCount === 1 ? "template" : "templates"}
              </small>
            </div>
            <button className={added ? "" : "primary"} disabled={added} onClick={() => app.addPack(pack)}>
              {added ? "Added ✓" : "Add"}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
