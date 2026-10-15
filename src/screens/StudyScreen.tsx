import { useEffect, useRef, useState } from "react";
import { ChoiceReview } from "../components/ChoiceReview";
import { CountUp } from "../components/CountUp";
import { FlashcardReview } from "../components/FlashcardReview";
import { dailyGoal } from "../goal";
import { isCalm } from "../motion";
import { formatMultiplier, nextMultiplier, pointsFor } from "../points";
import { isMultipleChoice } from "../questions";
import { orderSession, requeue } from "../queue";
import { previewDueDates, Rating, State, type Grade } from "../scheduler";
import { sounds } from "../sound";
import { dayKey } from "../storage";
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
  points: number; // base points, before the multiplier
  score: number; // points x multiplier, card by card
  bestMultiplier: number;
};

// A calm pause screen shown between cards.
type Pause = "time-up" | "break" | null;

// How the current card leaves: played into the tray, or discarded to the side.
type Exit = "play" | "discard" | null;

// Things that pop up over the card for a moment.
type Particle = { dx: number; dy: number; color: string };
type PointsPop = { id: number; gained: number; points: number; multiplier: number };
type ComboPop = { id: number; text: string; lost: boolean };

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
    points: 0,
    score: 0,
    bestMultiplier: 1,
  });
  const [pause, setPause] = useState<Pause>(null);
  const [timeUpShown, setTimeUpShown] = useState(false);
  const [breakShown, setBreakShown] = useState(false);
  const [finished, setFinished] = useState(false);

  // Combo multiplier, and the multiplier the current card was answered at.
  const [multiplier, setMultiplier] = useState(1);
  const answeredAt = useRef<number | null>(null);

  const [exit, setExit] = useState<Exit>(null);
  const [pointsPop, setPointsPop] = useState<PointsPop | null>(null);
  const [comboPop, setComboPop] = useState<ComboPop | null>(null);
  const [burst, setBurst] = useState<{ id: number; particles: Particle[] } | null>(null);
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

  // The moment an option is picked: the combo goes up (with confetti) or breaks.
  function handleAnswer(correct: boolean) {
    const id = Date.now();
    if (correct) {
      answeredAt.current = multiplier;
      const raised = nextMultiplier(multiplier, true);
      setMultiplier(raised);
      setStats((s) => ({ ...s, bestMultiplier: Math.max(s.bestMultiplier, raised) }));
      setBurst({ id, particles: makeParticles() });
      if (raised > multiplier) setComboPop({ id, text: `Combo ${formatMultiplier(raised)}!`, lost: false });
    } else {
      answeredAt.current = 1;
      if (multiplier > 1) setComboPop({ id, text: "Combo lost", lost: true });
      setMultiplier(1);
    }
  }

  // Animate the card away (points pop off it), then deal the next one.
  function leave(kind: Exit, newQueue: string[]) {
    setExit(kind);
    if (kind === "play") {
      sounds.play();
      setPlayed((n) => n + 1);
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

    // Score: this card's points x the multiplier it was answered at.
    const points = pointsFor(card.type, result);
    const usedMultiplier = answeredAt.current ?? multiplier;
    answeredAt.current = null;
    const gained = Math.round(points * usedMultiplier);
    setPointsPop({ id: now.getTime(), gained, points, multiplier: usedMultiplier });
    sounds.tick();

    const appChecked = result === "correct" || result === "wrong";
    setStats((s) => ({
      ...s,
      reviewed: s.reviewed + 1,
      problemsSolved: s.problemsSolved + (result === "correct" && card.type !== "flashcard" ? 1 : 0),
      checked: s.checked + (appChecked ? 1 : 0),
      correct: s.correct + (result === "correct" ? 1 : 0),
      points: s.points + points,
      score: s.score + gained,
    }));

    // See it again later in this session? In practice: only after "Again".
    const comesBackSoon = practice
      ? grade === Rating.Again
      : next.due.getTime() <= Date.now() + LEARN_AHEAD_MINUTES * 60_000;
    const rest = queue.slice(1);
    const missed = result === "wrong" || grade === Rating.Again;
    leave(missed ? "discard" : "play", comesBackSoon ? requeue(rest, cardId) : rest);
  }

  function handleSkip() {
    if (!cardId || exit) return;
    const now = new Date();
    app.skipCard(cardId, now.getTime() - shownAt.getTime(), practice, now);
    setStats((s) => ({ ...s, skipped: s.skipped + 1 }));
    leave("discard", queue.slice(1));
  }

  // Finish early. Nothing answered yet? Then there's nothing to summarize.
  function finish() {
    if (shownCount === 0) onExit();
    else setFinished(true);
  }

  if (!card || finished) {
    return (
      <SessionSummary app={app} stats={stats} startedAt={startedAt} practice={practice} onExit={onExit} />
    );
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
        <div className="score" title="Session score">
          <span className="score-value">
            <CountUp value={stats.score} durationMs={400} />
          </span>
          <span key={multiplier} className={`multiplier${multiplier > 1 ? " hot" : ""}`}>
            {formatMultiplier(multiplier)}
          </span>
        </div>
        <span className="muted left-count">
          {practice && <strong className="practice-tag">Practice · </strong>}
          {left} left
        </span>
      </div>
      <div className="progress" aria-hidden="true">
        <div style={{ width: `${progress * 100}%` }} />
      </div>

      <div className="pop-layer" aria-hidden="true">
        {pointsPop && (
          <span key={pointsPop.id} className="points-pop">
            +{pointsPop.gained}
            {pointsPop.multiplier > 1 && (
              <small>
                {pointsPop.points} {formatMultiplier(pointsPop.multiplier)}
              </small>
            )}
          </span>
        )}
        {comboPop && (
          <span key={comboPop.id} className={`combo-pop${comboPop.lost ? " lost" : ""}`}>
            {comboPop.text}
          </span>
        )}
        {burst?.particles.map((particle, i) => {
          const style = {
            "--dx": `${particle.dx}px`,
            "--dy": `${particle.dy}px`,
            "--particle-color": particle.color,
          } as React.CSSProperties;
          return <span key={`${burst.id}-${i}`} className="particle" style={style} />;
        })}
      </div>

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
            onAnswer={handleAnswer}
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

const PARTICLE_COLORS = ["var(--accent)", "var(--good)", "#ffffff", "var(--type-flashcard)", "#ff7ab6"];

// Confetti flying out in all directions.
function makeParticles(count = 22): Particle[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
    const distance = 90 + Math.random() * 90;
    return {
      dx: Math.cos(angle) * distance,
      dy: Math.sin(angle) * distance - 30,
      color: PARTICLE_COLORS[i % PARTICLE_COLORS.length],
    };
  });
}

type SummaryProps = {
  app: AppActions;
  stats: Stats;
  startedAt: number;
  practice: boolean;
  onExit: () => void;
};

// The end-of-session screen: the score counts up, then the stats.
function SessionSummary({ app, stats, startedAt, practice, onExit }: SummaryProps) {
  const [endedAt] = useState(() => Date.now());
  const seconds = Math.round((endedAt - startedAt) / 1000);
  const accuracy = stats.checked > 0 ? Math.round((stats.correct / stats.checked) * 100) : null;
  const nothingDone = stats.reviewed + stats.skipped === 0;
  const bonus = stats.score - stats.points;

  // Did this session complete today's goal? Then it gets its moment (once a day).
  const [goalJustMet] = useState(() => {
    const now = new Date(endedAt);
    const activeDecks = app.data.decks.filter((d) => !d.archived).map((d) => d.id);
    const goal = dailyGoal(
      app.data.reviewLog,
      app.dueCardIds(activeDecks, now).length,
      app.data.profile.settings.sessionMinutes,
      now,
    );
    return goal.met && app.data.profile.goalCelebratedOn !== dayKey(now);
  });
  const [goalParticles] = useState(() => makeParticles(30));

  // Remember it's been celebrated today (only once, even as the data changes).
  const marked = useRef(false);
  useEffect(() => {
    if (!goalJustMet || marked.current) return;
    marked.current = true;
    app.markGoalCelebrated(dayKey(new Date()));
  }, [goalJustMet, app]);

  // The fanfare plays after the score has counted up.
  useEffect(() => {
    if (!goalJustMet) return;
    const timer = window.setTimeout(sounds.goal, 2300);
    return () => window.clearTimeout(timer);
  }, [goalJustMet]);

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
    <div className="screen narrow summary">
      <h1>{practice ? "Practice done" : "Session complete"}</h1>

      <div className="score-sum">
        <div className="sum-row">
          <span className="muted">Points</span>
          <strong>
            <CountUp value={stats.points} delayMs={250} durationMs={600} />
          </strong>
        </div>
        <div className="sum-row">
          <span className="muted">
            Combo bonus <small>(best {formatMultiplier(stats.bestMultiplier)})</small>
          </span>
          <strong>
            + <CountUp value={bonus} delayMs={950} durationMs={500} />
          </strong>
        </div>
        <div className="sum-row total">
          <span>Session score</span>
          <strong>
            <CountUp value={stats.score} delayMs={1550} durationMs={700} />
          </strong>
        </div>
      </div>

      {goalJustMet && (
        <section className="goal-moment">
          {goalParticles.map((particle, i) => {
            const style = {
              "--dx": `${particle.dx}px`,
              "--dy": `${particle.dy}px`,
              "--particle-color": particle.color,
            } as React.CSSProperties;
            return <span key={i} className="particle" style={style} />;
          })}
          <span className="goal-check" aria-hidden="true">
            ✓
          </span>
          <div>
            <h2>Daily goal complete!</h2>
            <p>That's today's retrieval practice done. Tomorrow's cards will thank you.</p>
          </div>
        </section>
      )}

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
