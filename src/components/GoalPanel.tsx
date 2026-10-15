import type { DailyGoal } from "../goal";

// Today's goal on Home: clear the due cards OR study for the session length.
export function GoalPanel({ goal }: { goal: DailyGoal }) {
  const total = goal.cleared + goal.dueLeft;

  return (
    <section className={`panel goal-panel${goal.met ? " met" : ""}`}>
      <h2>Today's goal {goal.met && <span className="goal-done">✓ Done</span>}</h2>

      {!goal.active && (
        <p className="muted">Nothing was due today, so no goal. Practice is a bonus if you feel like it.</p>
      )}

      {goal.active && goal.met && (
        <p>
          {goal.queueDone
            ? "Every due card cleared. Nice work."
            : `${Math.round(goal.minutes)} minutes of real study today. Nice work.`}
        </p>
      )}

      {goal.active && !goal.met && (
        <>
          <p className="muted">
            Clear today's cards, <strong>or</strong>{" "}
            {goal.targetMinutes === null
              ? "keep going until the queue is empty."
              : `study for ${goal.targetMinutes} minutes.`}
          </p>
          <GoalBar label={`${goal.cleared} of ${total} cards cleared`} share={goal.cleared / total} />
          {goal.targetMinutes !== null && (
            <GoalBar
              label={`${Math.floor(goal.minutes)} of ${goal.targetMinutes} minutes studied`}
              share={goal.minutes / goal.targetMinutes}
            />
          )}
        </>
      )}
    </section>
  );
}

function GoalBar({ label, share }: { label: string; share: number }) {
  return (
    <div className="goal-bar">
      <div className="progress" aria-hidden="true">
        <div style={{ width: `${Math.min(1, share) * 100}%` }} />
      </div>
      <small className="muted">{label}</small>
    </div>
  );
}
