import type { AppActions } from "../useAppData";

const GRADE_LABELS = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" } as const;
const SHOWN = 10;

// The most recent entries of the review log, newest first.
// (The Progress screen in a later milestone will turn this log into charts.)
export function ReviewHistory({ app }: { app: AppActions }) {
  const log = app.data.reviewLog;
  const recent = log.slice(-SHOWN).reverse();
  const deckName = (deckId: string) =>
    app.data.decks.find((deck) => deck.id === deckId)?.name ?? "(deleted deck)";

  return (
    <section className="panel">
      <h2>Review history</h2>
      <p className="muted">
        {log.length === 0
          ? "No reviews logged yet. Every card you review from now on is recorded here."
          : `${log.length} ${log.length === 1 ? "review" : "reviews"} logged. Latest ${Math.min(SHOWN, log.length)}:`}
      </p>
      {recent.length > 0 && (
        <div className="table-scroll">
          <table className="history">
            <thead>
              <tr>
                <th>When</th>
                <th>Deck</th>
                <th>Card</th>
                <th>Result</th>
                <th>Rating</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((entry, i) => (
                <tr key={log.length - i}>
                  <td>
                    {new Date(entry.at).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td>{deckName(entry.deckId)}</td>
                  <td>{entry.cardType}</td>
                  <td>
                    {entry.result}
                    {entry.practice && " (practice)"}
                  </td>
                  <td>{entry.grade ? GRADE_LABELS[entry.grade] : "–"}</td>
                  <td>{Math.round(entry.durationMs / 1000)} s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
