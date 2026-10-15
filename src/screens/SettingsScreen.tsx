import { useState } from "react";
import { ReviewHistory } from "../components/ReviewHistory";
import { downloadBackup, parseData } from "../storage";
import type { Profile } from "../types";
import type { AppActions } from "../useAppData";

type SessionMinutes = Profile["settings"]["sessionMinutes"];

export function SettingsScreen({ app }: { app: AppActions }) {
  const [message, setMessage] = useState("");
  const deckCount = app.data.decks.length;
  const cardCount = Object.keys(app.data.cards).length;
  const settings = app.data.profile.settings;
  const sessionMinutes = settings.sessionMinutes;

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
    <div className="screen narrow">
      <h1>Settings</h1>

      <section className="panel">
        <h2>Look and sound</h2>
        <label className="toggle-row">
          <span>
            Sound effects
            <br />
            <small className="muted">Soft card sounds, played at low volume.</small>
          </span>
          <input
            type="checkbox"
            checked={settings.sound}
            onChange={(e) => app.updateSettings({ sound: e.target.checked })}
          />
        </label>
        <label className="toggle-row">
          <span>
            Calm mode
            <br />
            <small className="muted">
              No floating, tilting, shaking or particles: cards simply fade. Turns on by itself if
              your device asks for reduced motion.
            </small>
          </span>
          <input
            type="checkbox"
            checked={settings.calmMode}
            onChange={(e) => app.updateSettings({ calmMode: e.target.checked })}
          />
        </label>
      </section>

      <section className="panel">
        <h2>Session length</h2>
        <p className="muted">
          When the time is up, the app suggests stopping: two short sessions beat one long one.
        </p>
        <select
          aria-label="Session length"
          value={sessionMinutes ?? "empty"}
          onChange={(e) =>
            app.updateSettings({
              sessionMinutes:
                e.target.value === "empty" ? null : (Number(e.target.value) as SessionMinutes),
            })
          }
        >
          <option value="15">15 minutes</option>
          <option value="30">30 minutes</option>
          <option value="45">45 minutes</option>
          <option value="60">60 minutes</option>
          <option value="empty">Until the queue is empty</option>
        </select>
      </section>

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
