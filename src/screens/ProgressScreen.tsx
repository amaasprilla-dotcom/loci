import { ChartPanel, ColumnChart, MasteryBars, NumbersTable, StudyCalendar } from "../components/charts";
import { mastery, minutesPerDay, minutesPerWeek, retention, studyCalendar, upcoming } from "../progress";
import type { AppActions } from "../useAppData";
import { useNow } from "../useNow";

// The Progress screen: five charts, all worked out from the review log.
export function ProgressScreen({ app }: { app: AppActions }) {
  const now = useNow();
  const { data } = app;
  const log = data.reviewLog;

  const activeDecks = data.decks.filter((d) => !d.archived).map((d) => d.id);
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  const calendar = studyCalendar(log, now);
  const kept = retention(log, now);
  const nextWeek = upcoming(data, now, app.dueCardIds(activeDecks, endOfToday).length);
  const decks = mastery(data);
  const daily = minutesPerDay(log, now);
  const weekly = minutesPerWeek(log, now);
  const daysStudied = calendar.flat().filter((day) => day.reviews > 0).length;

  if (log.length === 0) {
    return (
      <div className="screen narrow">
        <h1>Progress</h1>
        <p className="muted">
          Your charts appear here after your first study session: every card you review is recorded.
        </p>
      </div>
    );
  }

  return (
    <div className="screen">
      <h1>Progress</h1>

      <div className="progress-grid">
        <ChartPanel
          title="Study calendar"
          caption={`Each square is a day; brighter means more reviews. You studied on ${daysStudied} of the last ~4 months' days.`}
        >
          <StudyCalendar weeks={calendar} />
          <NumbersTable
            headers={["Day", "Reviews"]}
            rows={calendar
              .flat()
              .filter((day) => day.reviews > 0)
              .reverse()
              .map((day) => [day.date.toLocaleDateString(), day.reviews])}
          />
        </ChartPanel>

        <ChartPanel
          title="Retention"
          caption="How often you remembered a card you'd seen before, over the last 30 days. Around 90% means the spacing is working."
        >
          <RetentionFigure {...kept} />
        </ChartPanel>

        <ChartPanel
          title="Coming up"
          caption="Cards due on each of the next 7 days, so you can plan ahead. Exam days are flagged."
        >
          <ColumnChart
            title="Cards due on each of the next 7 days"
            columns={nextWeek.map((day) => ({
              label: day.label,
              value: day.cards,
              marker: day.exams.length > 0 ? "Exam" : undefined,
              tooltip:
                `${day.label}: ${day.cards} ${day.cards === 1 ? "card" : "cards"}` +
                (day.exams.length > 0 ? ` · exam: ${day.exams.join(", ")}` : ""),
            }))}
          />
          <NumbersTable
            headers={["Day", "Cards due", "Exam"]}
            rows={nextWeek.map((day) => [day.label, day.cards, day.exams.join(", ") || "–"])}
          />
        </ChartPanel>

        <ChartPanel
          title="Mastery by deck"
          caption="New: never studied. Learning: remembered for less than 3 weeks. Solid: 3 weeks or more."
        >
          <MasteryBars decks={decks} />
          <NumbersTable
            headers={["Deck", "New", "Learning", "Solid"]}
            rows={decks.map((deck) => [deck.name, deck.fresh, deck.learning, deck.solid])}
          />
        </ChartPanel>

        <ChartPanel
          title="Time studied"
          caption="Real time spent on cards (each card counts for at most 3 minutes), per day and per week."
        >
          <h3 className="chart-subtitle">Last 14 days</h3>
          <ColumnChart
            title="Minutes studied per day, last 14 days"
            labelEvery={3}
            formatValue={formatMinutes}
            columns={daily.map((day) => ({
              label: day.label,
              value: day.minutes,
              tooltip: `${day.date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}: ${formatMinutes(day.minutes)}`,
            }))}
          />
          <h3 className="chart-subtitle">Last 8 weeks</h3>
          <ColumnChart
            title="Minutes studied per week, last 8 weeks"
            labelEvery={2}
            formatValue={formatMinutes}
            columns={weekly.map((week) => ({
              label: week.label,
              value: week.minutes,
              tooltip: `Week of ${week.label}: ${formatMinutes(week.minutes)}`,
            }))}
          />
          <NumbersTable
            headers={["Period", "Minutes"]}
            rows={[
              ...daily.map((day) => [day.date.toLocaleDateString(), formatMinutes(day.minutes)]),
              ...weekly.map((week) => [`Week of ${week.label}`, formatMinutes(week.minutes)]),
            ]}
          />
        </ChartPanel>
      </div>
    </div>
  );
}

// "12m", "1h 5m", "<1m"
function formatMinutes(minutes: number): string {
  if (minutes > 0 && minutes < 1) return "<1m";
  const whole = Math.round(minutes);
  if (whole < 60) return `${whole}m`;
  return `${Math.floor(whole / 60)}h ${whole % 60}m`;
}

type RetentionProps = { rate: number | null; reviews: number; remembered: number; previousRate: number | null };

// One big number, with a trend arrow against the 30 days before.
function RetentionFigure({ rate, reviews, remembered, previousRate }: RetentionProps) {
  if (rate === null) {
    return <p className="muted">No reviews of seen-before cards in the last 30 days yet.</p>;
  }
  const percent = Math.round(rate * 100);
  const change = previousRate === null ? null : percent - Math.round(previousRate * 100);

  return (
    <div className="retention">
      <span className="hero-figure">{percent}%</span>
      <div className="retention-detail">
        <span>
          {remembered} of {reviews} reviews remembered
        </span>
        {change === null ? (
          <span className="muted">No earlier month to compare with yet.</span>
        ) : (
          <span className={`trend ${change > 0 ? "up" : change < 0 ? "down" : "flat"}`}>
            <span aria-hidden="true">{change > 0 ? "▲" : change < 0 ? "▼" : "▶"}</span>{" "}
            {change === 0 ? "Same" : `${change > 0 ? "Up" : "Down"} ${Math.abs(change)} points`} vs the 30
            days before
          </span>
        )}
      </div>
    </div>
  );
}
