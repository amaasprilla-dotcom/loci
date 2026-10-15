import { useEffect, useRef, useState } from "react";
import { ChoiceReview } from "../components/ChoiceReview";
import { FlashcardReview } from "../components/FlashcardReview";
import { isCalm } from "../motion";
import { pointsFor } from "../points";
import { isMultipleChoice } from "../questions";
import { orderSession, requeue } from "../queue";
import { previewDueDates, Rating, State, type Grade } from "../scheduler";
import { sounds } from "../sound";
import type { ReviewResult } from "../types";
import type { AppActions } from "../useAppData";

// Cards that come due again within this many minutes (e.g. after "Again")
// are shown again later in the same session instead of waiting for next time.
const LEARN_AHEAD_MINUTES = 20;
// After this long, suggest a break (once).
const BREAK_AFTER_MINUTES = 60;
// How long a card takes to fly away before the next one is dealt.
const EXIT_MS = 480;
const CALM_EXIT_MS = 200;

type Props = {
  app: AppActions;
  deckIds: string[];
  practice: boolean; // extra practice: nothing due needed, schedule untouched
  onExit: () => void;
};

type Stats = {
  reviewed: number; // answered (not skipped)
  problemsSolved: number; // problems answered correctly
  checked: number; // answers the app checked (multiple choice)
  correct: number; // ...of which right
  skipped: number;
};

// A calm pause screen shown between cards.
type Pause = "time-up" | "break" | null;

// How the current card leaves: played into the tray, or discarded to the side.
type Exit = "play" | "discard" | null;

// Points popping off a played card, with a burst of particles if it was right.
type Particle = { dx: number; dy: number; color: string };
type Pop = { id: number; points: number; particles: Particle[] };

export function StudyScreen({ app, deckIds, practice, onExit }: Props) {
  const [queue, setQueue] = useState<string[]>(() => {
    if (practice) return app.practiceCardIds(deckIds);
    const isNewProblem = (id: string) =>
      app.data.cards[id].type !== "flashcard" && app.data.schedules[id].state === State.New;
    return orderSession(app.dueCardIds(deckIds), isNewProblem);
  });
  const [startedAt] = useState(() => Date.now());
  // When the current card was shown: for the log (time spent) and the rating labels.
  const [shownAt, setShownAt] = useState(() => new Date());
  const [stats, setStats] = useState<Stats>({
    reviewed: 0,
    problemsSolved: 0,
    checked: 0,
    correct: 0,
    skipped: 0,
  });
  const [pause, setPause] = useState<Pause>(null);
  const [timeUpShown, setTimeUpShown] = useState(false);
  const [breakShown, setBreakShown] = useState(false);
  const [finished, setFinished] = useState(false);

  const [exit, setExit] = useState<Exit>(null);
  const [pop, setPop] = useState<Pop | null>(null);
  const [played, setPlayed] = useState(0); // cards in the tray
  // Changes only when the next card is dealt, so the old one can finish leaving first.
  const [cardKey, setCardKey] = useState(0);
  const exitTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(exitTimer.current), []);

  const sessionMinutes = app.data.profile.settings.sessionMinutes;
  const cardId = queue[0];
  const card = cardId ? app.data.cards[cardId] : undefined;
  const shownCount = stats.reviewed + stats.skipped;

  // After every card: move on, and check whether it's time for a pause screen.
  function nextCard(newQueue: string[]) {
    setQueue(newQueue);
    setShownAt(new Date());
    if (newQueue.length === 0) return;

    const minutes = (Date.now() - startedAt) / 60_000;
    if (sessionMinutes !== null && !timeUpShown && minutes >= sessionMinutes) {
      setPause("time-up");
      setTimeUpShown(true);
      // Already an hour in? This pause covers the break suggestion too.
      if (minutes >= BREAK_AFTER_MINUTES) setBreakShown(true);
    } else if (!breakShown && minutes >= BREAK_AFTER_MINUTES) {
      setPause("break");
      setBreakShown(true);
    }
  }

  // Animate the card away (points pop off it), then deal the next one.
  function leave(kind: Exit, newQueue: string[], points: number, burst: boolean) {
    setExit(kind);
    if (kind === "play") {
      sounds.play();
      setPlayed((n) => n + 1);
    }
    if (points > 0) {
      sounds.tick();
      setPop({ id: Date.now(), points, particles: burst ? makeParticles() : [] });
    }
    exitTimer.current = window.setTimeout(
      () => {
        setExit(null);
        setCardKey((key) => key + 1);
        nextCard(newQueue);
      },
      isCalm() ? CALM_EXIT_MS : EXIT_MS,
    );
  }

  function handleRate(grade: Grade, result: ReviewResult) {
    if (!cardId || !card || exit) return; // ignore clicks while a card is leaving
    const now = new Date();
    const durationMs = now.getTime() - shownAt.getTime();
    const next = app.reviewCard(cardId, grade, result, durationMs, practice, now);

    const appChecked = result === "correct" || result === "wrong";
    setStats((s) => ({
      ...s,
      reviewed: s.reviewed + 1,
      problemsSolved: s.problemsSolved + (result === "correct" && card.type !== "flashcard" ? 1 : 0),
      checked: s.checked + (appChecked ? 1 : 0),
      correct: s.correct + (result === "correct" ? 1 : 0),
    }));

    // See it again later in this session? In practice: only after "Again".
    const comesBackSoon = practice
      ? grade === Rating.Again
      : next.due.getTime() <= Date.now() + LEARN_AHEAD_MINUTES * 60_000;
    const rest = queue.slice(1);
    const missed = result === "wrong" || grade === Rating.Again;
    leave(
      missed ? "discard" : "play",
      comesBackSoon ? requeue(rest, cardId) : rest,
      pointsFor(card.type, result),
      result === "correct",
    );
  }

  function handleSkip() {
    if (!cardId || exit) return;
    const now = new Date();
    app.skipCard(cardId, now.getTime() - shownAt.getTime(), practice, now);
    setStats((s) => ({ ...s, skipped: s.skipped + 1 }));
    leave("discard", queue.slice(1), 0, false);
  }

  // Finish early. Nothing answered yet? Then there's nothing to summarize.
  function finish() {
    if (shownCount === 0) onExit();
    else setFinished(true);
  }

  if (!card || finished) {
    return <SessionSummary stats={stats} startedAt={startedAt} practice={practice} onExit={onExit} />;
  }

  if (pause) {
    return (
      <div className="screen pause">
        {pause === "time-up" ? (
          <>
            <h1>Good place to stop.</h1>
            <p>A second short session later beats one long one.</p>
          </>
        ) : (
          <>
            <h1>Over an hour: time for a break?</h1>
            <p>A 10-minute break now helps the next stretch stick.</p>
          </>
        )}
        <button className="primary big" onClick={finish}>
          Finish
        </button>
        <button onClick={() => setPause(null)}>Keep going</button>
      </div>
    );
  }

  const dueDates = practice ? undefined : previewDueDates(app.data.schedules[card.id], shownAt);
  const otherBacks = app.otherBacks(card.id);
  // While a card is leaving, the queue still includes it.
  const left = exit ? queue.length - 1 : queue.length;
  const progress = shownCount / (shownCount + left);

  return (
    <div className="screen study">
      <div className="study-top">
        <button className="link" onClick={finish}>
          ← Finish
        </button>
        <div className="tray" title="Cards played this session">
          <span className="tray-card" aria-hidden="true" />
          <span key={played} className="tray-count">
            {played}
          </span>
        </div>
        <span className="muted">
          {practice && <strong className="practice-tag">Practice · </strong>}
          {left} left
        </span>
      </div>
      <div className="progress" aria-hidden="true">
        <div style={{ width: `${progress * 100}%` }} />
      </div>

      {pop && <PointsPop pop={pop} />}

      {/* The card and its buttons. A new key for every card dealt makes React
          start it fresh (new numbers, new options), even if the same card comes back. */}
      <div className={`card-slot${exit ? ` exit-${exit}` : ""}`}>
        {isMultipleChoice(card, otherBacks) ? (
          <ChoiceReview
            key={cardKey}
            card={card}
            otherBacks={otherBacks}
            dueDates={dueDates}
            now={shownAt}
            onRate={handleRate}
            onSkip={handleSkip}
          />
        ) : (
          card.type === "flashcard" && (
            <FlashcardReview
              key={cardKey}
              card={card}
              dueDates={dueDates}
              now={shownAt}
              onRate={handleRate}
              onSkip={handleSkip}
            />
          )
        )}
      </div>
    </div>
  );
}

// "+10" floating up, plus particles bursting out.
function PointsPop({ pop }: { pop: Pop }) {
  return (
    <div key={pop.id} className="pop-layer" aria-hidden="true">
      <span className="points-pop">+{pop.points}</span>
      {pop.particles.map((particle, i) => {
        const style = {
          "--dx": `${particle.dx}px`,
          "--dy": `${particle.dy}px`,
          "--particle-color": particle.color,
        } as React.CSSProperties;
        return <span key={i} className="particle" style={style} />;
      })}
    </div>
  );
}

const PARTICLE_COLORS = ["var(--accent)", "var(--good)", "#ffffff", "var(--type-flashcard)"];

// A dozen particles flying out in all directions.
function makeParticles(): Particle[] {
  return Array.from({ length: 12 }, (_, i) => {
    const angle = (i / 12) * Math.PI * 2 + Math.random() * 0.4;
    const distance = 70 + Math.random() * 60;
    return {
      dx: Math.cos(angle) * distance,
      dy: Math.sin(angle) * distance,
      color: PARTICLE_COLORS[i % PARTICLE_COLORS.length],
    };
  });
}

type SummaryProps = {
  stats: Stats;
  startedAt: number;
  practice: boolean;
  onExit: () => void;
};

// The end-of-session screen.
function SessionSummary({ stats, startedAt, practice, onExit }: SummaryProps) {
  const [endedAt] = useState(() => Date.now());
  const seconds = Math.round((endedAt - startedAt) / 1000);
  const accuracy = stats.checked > 0 ? Math.round((stats.correct / stats.checked) * 100) : null;
  const nothingDone = stats.reviewed + stats.skipped === 0;

  if (nothingDone) {
    return (
      <div className="screen narrow">
        <h1>{practice ? "Nothing to practice yet" : "Nothing due right now"}</h1>
        <p className="muted">Add cards, practice a deck, or come back later.</p>
        <button className="primary" onClick={onExit}>
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="screen narrow">
      <h1>{practice ? "Practice done" : "Session complete"}</h1>
      <div className="summary-grid">
        <SummaryItem value={stats.reviewed} label="cards reviewed" />
        <SummaryItem value={stats.problemsSolved} label="problems solved" />
        <SummaryItem value={stats.skipped} label="skipped" />
        <SummaryItem value={accuracy === null ? "–" : `${accuracy}%`} label="accuracy" />
        <SummaryItem
          value={`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`}
          label="time"
        />
      </div>
      {accuracy !== null && (
        <p className="muted">
          Accuracy counts the answers the app checked: {stats.correct} of {stats.checked} right.
        </p>
      )}
      <button className="primary big" onClick={onExit}>
        Done
      </button>
    </div>
  );
}

function SummaryItem({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="stat">
      <strong>{value}</strong>
      <span className="muted">{label}</span>
    </div>
  );
}
