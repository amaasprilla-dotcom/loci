import { useState } from "react";
import { DeckStack } from "../components/DeckStack";
import { ExamChip } from "../components/ExamChip";
import { NewDeckPanel } from "../components/NewDeckPanel";
import { PackOpening } from "../components/PackOpening";
import { daysUntilExam } from "../exam";
import { isCalm } from "../motion";
import type { Pack } from "../packs";
import { formatInterval } from "../scheduler";
import { sounds } from "../sound";
import { currentStreak } from "../streak";
import type { AppActions } from "../useAppData";
import { useNow } from "../useNow";

type Props = {
  app: AppActions;
  onOpenDeck: (deckId: string) => void;
  onStudy: (deckIds: string[], practice?: boolean) => void;
};

export function HomeScreen({ app, onOpenDeck, onStudy }: Props) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [opening, setOpening] = useState<string | null>(null); // name of the pack being added
  const [showArchived, setShowArchived] = useState(false);
  const decks = app.data.decks.filter((d) => !d.archived);
  const archived = app.data.decks.filter((d) => d.archived);
  const deckIds = decks.map((d) => d.id);
  const isNewUser = app.data.decks.length === 0;

  const now = useNow();
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  const dueNow = app.dueCardIds(deckIds, now).length;
  const dueToday = app.dueCardIds(deckIds, endOfToday).length;
  const streak = currentStreak(app.data.reviewDays, now);
  const nextDue = app.nextDueDate(deckIds, now);
  const canPractice = app.practiceCardIds(deckIds).length > 0;
  const examsOver = decks.filter((d) => d.examDate && daysUntilExam(d.examDate, now) < 0);

  // Opening a pack: the deck is created right away; the animation is just for show.
  function openPack(pack: Pack) {
    app.addPack(pack);
    setSheetOpen(false);
    if (isCalm()) sounds.packOpen();
    else setOpening(pack.name);
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
          <span className="muted">day streak</span>
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

      {isNewUser ? (
        // First visit: show the packs right away, so it's "open a pack" then "Study".
        <section className="panel">
          <h2>Welcome! Pick your first deck</h2>
          <NewDeckPanel app={app} onCreated={() => {}} onOpenPack={openPack} />
        </section>
      ) : (
        <>
          <h2>Your decks</h2>
          <div className="deck-grid">
            {decks.map((deck) => {
              const due = app.dueCardIds([deck.id], now).length;
              return (
                <button
                  key={deck.id}
                  className={`deck-slot${due > 0 ? " has-due" : ""}`}
                  onClick={() => onOpenDeck(deck.id)}
                >
                  <DeckStack cardCount={deck.cardIds.length} />
                  <span className="deck-info">
                    <span className="deck-name">{deck.name}</span>
                    <span className="muted">
                      {deck.cardIds.length} {deck.cardIds.length === 1 ? "card" : "cards"}
                    </span>
                    {due > 0 && <span className="due-badge">{due} due</span>}
                    {deck.examDate && (
                      <span>
                        <ExamChip deck={deck} now={now} />
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
            <button className="deck-slot add" onClick={() => setSheetOpen(true)}>
              <span className="plus">+</span> New deck
            </button>
          </div>
        </>
      )}

      {archived.length > 0 && (
        <>
          <button className="link" onClick={() => setShowArchived(!showArchived)}>
            {showArchived ? "Hide" : "Show"} archived decks ({archived.length})
          </button>
          {showArchived && (
            <ul className="list">
              {archived.map((deck) => (
                <li key={deck.id} className="panel archived-row">
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

      {sheetOpen && (
        <div className="sheet-backdrop" onClick={() => setSheetOpen(false)}>
          <div
            className="sheet"
            role="dialog"
            aria-label="New deck"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sheet-header">
              <h2>New deck</h2>
              <button className="small" onClick={() => setSheetOpen(false)}>
                Close
              </button>
            </div>
            <NewDeckPanel app={app} onCreated={() => setSheetOpen(false)} onOpenPack={openPack} />
          </div>
        </div>
      )}

      {opening && (
<PackOpening packName={opening} onDone={() => setOpening(null)} />
      )}
    </div>
  );
}
