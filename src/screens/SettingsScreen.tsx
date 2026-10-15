import { useState } from "react";
import { ReviewHistory } from "../components/ReviewHistory";
import { downloadBackup, parseData } from "../storage";
import type { AppActions } from "../useAppData";

export function SettingsScreen({ app }: { app: AppActions }) {
  const [message, setMessage] = useState("");
  const deckCount = app.data.decks.length;
  const cardCount = Object.keys(app.data.cards).length;

  async function handleImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // so choosing the same file again still works
    if (!file) return;

    try {
      const imported = parseData(await file.text());
      const importedCards = Object.keys(imported.cards).length;
      const ok = confirm(
        `Replace everything with this backup (${imported.decks.length} decks, ${importedCards} cards)?\n` +
          "Your current data will be overwritten.",
      );
      if (!ok) return;
      app.replaceData(imported);
      setMessage(`Imported ${imported.decks.length} decks and ${importedCards} cards.`);
    } catch (error) {
      setMessage(`Import failed: ${(error as Error).message}`);
    }
  }

  function handleReset() {
    if (confirm("Delete all decks, cards and progress? This cannot be undone.")) {
      app.resetData();
      setMessage("All data deleted.");
    }
  }

  return (
    <div className="screen">
      <h1>Settings</h1>

      <section className="panel">
        <h2>Back up your data</h2>
        <p className="muted">
          Your {deckCount} decks, {cardCount} cards and {app.data.reviewLog.length} logged reviews
          are saved only in this browser. Clearing browser data deletes them, so download a
          backup now and then.
        </p>
        <button className="primary" onClick={() => downloadBackup(app.data)}>
          Export (download .json)
        </button>
      </section>

      <section className="panel">
        <h2>Restore from a backup</h2>
        <p className="muted">Replaces everything in this browser with the backup file.</p>
        <label className="file-button">
          Import (choose .json file)
          <input type="file" accept=".json,application/json" onChange={handleImport} />
        </label>
      </section>

      {message && <p className="notice">{message}</p>}

      <ReviewHistory app={app} />

      <section className="panel">
        <h2>Reset</h2>
        <p className="muted">Deletes all decks, cards and study history from this browser.</p>
        <button className="danger" onClick={handleReset}>
          Delete all data
        </button>
      </section>
    </div>
  );
}
