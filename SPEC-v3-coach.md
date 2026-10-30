# Loci v3 — Coach Spec

Oct 30, 2026 · @ANDREW

## Summary

Coach adds the study and behaviour-change practices that have the best evidence behind them. Some already exist in Loci and get sharper (retrieval, progress tracking). Some are new (if-then plans, WOOP, habits, lapse recovery, weekly challenges, persist-or-pivot reviews, procrastination tools, boundaries). Some can't work in a browser app (site blocking, notification curfews, fading reminders); they ship as **previews**: real settings and UI, no effect yet, clearly labelled.

Constraints carry over from v2: everything runs on-device, no AI, no backend, no paid APIs. No new libraries are needed.

**Where things live.** Practices that belong to one item stay on that item: typed answers on decks, recall on notes, if-then plans and habits on to-dos, WOOP and review dates on goals. Practices that span the app go on a new **Coach** screen, opened from a third button on the home top bar: weekly review, challenges, the procrastination toolkit, boundaries and focus.

**Previews.** A preview has a "Preview" badge and one line saying what would make it real ("Needs the Android app", "Needs the browser extension"). Its settings are saved, so the day it becomes real nothing has to be set up again.

## The practices

The list skips 11; the numbers below follow the source list.

| # | Practice | Evidence | What Loci does | Real or preview |
| --- | --- | --- | --- | --- |
| 1 | Spaced retrieval | g ≈ 0.6–0.75 | FSRS cards and problems (exists); typed answers checked by the app; blank-page recall of notes; a spacing strip | Real |
| 2 | Recorded progress tracking | d ≈ 0.40 | Goals and check-ins (exists); one-tap logging; weekly review; share a summary | Real |
| 3 | If-then plans | d ≈ 0.15–0.36 | To-dos written as "When …, I will …" with a cue and a backup plan; vague plans are rejected | Real (the trigger lives in your life) |
| 4 | WOOP | g ≈ 0.34 | Guided Wish → Outcome → Obstacle → Plan on goals | Real |
| 5 | Habits through repetition | median ~66 days | Habit mode on recurring to-dos: anchor, reps, automaticity, horizon | Real; fading reminders are a preview |
| 6 | CBT for procrastination | g ≈ 0.55 | Tiny first steps, start times, name-the-feeling log, short lessons, get-help card | Real (lessons and logs; severe cases need a human) |
| 7 | Shaping your environment | — | Set-up-beforehand checklists, focus session | Real; site/app blocker is a preview |
| 8 | Recovery and detachment | d ≈ 0.36 | Off-hours inside the app, bedtime, burnout check | Real in-app; notification curfew is a preview |
| 9 | Lapse recovery | +27% visits (best of 54) | Weekly targets with grace days, never miss twice, welcome back, fresh starts; no resetting streak | Real |
| 10 | Becoming more conscientious | tested as an app | Weekly behaviour challenges | Real |
| 12 | Persist or pivot | — | Review date and criterion on goals; a review sheet with the data and four choices | Real (the decision is yours) |

## 1. Spaced retrieval

Already built: FSRS for cards and problem templates, mixed Study sessions, exams. Three additions.

### Typed answers

A per-deck setting **Answer mode: Flip | Type** (default Flip, stored in the deck element's data).

- Type mode shows an input under the front. Enter submits; the back is revealed with the verdict.
- `checkAnswer(typed, back)` is pure: lowercase, strip accents and punctuation, collapse spaces, then accept an edit distance of 0 for answers up to 4 characters, 1 up to 10, 2 beyond. If the back has several answers separated by `;`, ` / ` or a new line, any one counts. A bare slash stays part of the answer (`km/h`).
- Rating is derived, like problems: wrong → Again; right → Good; right in under 0.6× the user's median card time → Easy. The first 3 attempts on a card rate right as Good.
- "I was right" under a wrong verdict turns it into Good. Typos happen; the user is the judge.
- Cards with no text answer (images, long backs over 80 characters) fall back to Flip inside a Type deck.

### Blank-page recall

A note's menu gets **Practise recall**. The note then carries an FSRS card and joins its locus's Study session.

- The session shows the note's title and a blank text area: "Write down everything you remember."
- **Reveal** shows what was typed next to the note. The user grades Again / Hard / Good / Easy, with the usual interval labels.
- `estSeconds` defaults to 180 and learns from the user's own times, like cards and problems.
- Each attempt is logged with the typed text, so the user can see their recall grow.
- Turning it off keeps the FSRS state, in case it is turned on again.

### Spacing strip

The locus Study row shows 28 small dots, one per day, filled on days the user studied in this locus (card reviews, problem attempts, recall attempts). It makes spacing visible without nagging.

## 2. Recorded progress tracking

Already built: goals with exact targets, check-ins, a progress chart, pace. Additions:

- **One-tap logging.** A check-in task with a single number or slider contributor shows inline buttons in Now: **Same as last** and **−/+ one step**. The Coach screen and each goal card get a **Log today** strip: one tap ticks today's occurrence of each habit and counted to-do. It calls the same `completeTodo` as Tasks, so a tick shows everywhere.
- **Weekly review.** See Coach.
- **Share.** "Share summary" on a goal and at the end of the weekly review builds plain text ("Violin: 18 of 60 sessions, +4 this week, on pace") and opens `navigator.share`, falling back to copying it. Sharing makes tracking stronger and needs no server.

## 3. If-then plans

A to-do already has a when and an action. Coach makes it a full implementation intention.

```ts
interface TodoPlan {
  cue?: string;            // "after breakfast, at my desk"
  obstacle?: string;       // "If I'm too tired"
  obstacleAction?: string; // "I will do just 5 minutes"
  firstStep?: string;      // "open the doc" (see 6)
}
// Todo.plan?: TodoPlan
```

- The add form reads as one sentence: **When** [when chip] [cue] **, I will** [action]. The cue is optional free text after the chip.
- **Add a backup plan** opens a second sentence: **If** [obstacle] **, then I will** [action]. Offered once the first plan is valid, with the hint "What's most likely to get in the way?"
- The detail view shows both sentences.

### Rejecting vague plans

`checkPlan(todo)` is pure and returns a list of problems, each with a short reason and, where possible, a rewrite hint.

| Check | Example flagged | Hint |
| --- | --- | --- |
| Action starts with a vague verb or none | "maths", "work on essay", "try to run" | "Start with what you'll physically do: write, read, run…" |
| Vague words | more, better, improve, some, a bit, regularly, focus on, get into | "How much? 'Read 10 pages' beats 'read more'." |
| No size | "study" with no amount, duration or object | "Add a size: '20 min', '1 page', '3 problems'." |
| No when | Someday | "A plan needs a when. Pick a time or a moment." |
| Too big | estimated over 2 h, or difficulty Very hard with no first step | "Make it smaller, or add a first step." |

- Problems show under the sentence. **Save stays disabled** while there are problems, with a small **Keep as written** link that saves anyway. It rejects, but the user stays in charge.
- The word lists are short and English-first; they live in one file so they can be translated.

### Do you care?

If-then plans only work for goals the person actually wants. When the to-do counts toward a goal, the form shows that goal's **why** above the sentence. Otherwise "Why it matters" stays an optional field, as today.

## 4. WOOP

```ts
interface Woop { wish: string; outcome: string; obstacle: string; plan: string; doneAt: number }
// Goal.woop?: Woop
```

A guided four-step sheet, one question per screen:

1. **Wish.** "What do you want to achieve? Make it challenging but possible." Fills the goal title if it is empty.
2. **Outcome.** "What's the best thing about achieving it? Imagine it for a moment." Shown under the title as the goal's why if there is none.
3. **Obstacle.** "What in *you* is most likely to stop you? A habit, a feeling, a thought." The hint steers away from outside excuses.
4. **Plan.** "When [obstacle], I will …" Saving creates an if-then to-do with that plan (the obstacle as cue), filled in for the user to confirm, and links it to the goal as a to-do count contributor if the user wants.

Offered at the end of creating a goal ("Run WOOP now? 2 minutes") and from the goal menu. Running it again replaces the old one; the date shows on the goal.

## 5. Habits

A habit is a **recurring to-do with habit mode on**. It keeps recurrence, completions, goal links and Tasks as they are, and adds:

```ts
interface Habit {
  anchor: string;                 // "after breakfast"
  place?: string;                 // "at my desk"
  startedAt: number;
  weeklyTarget: 1 | 2 | 3 | 4 | 5 | 6 | 7;  // days per week; the rest are grace days
  reminders: 'on' | 'fading' | 'off';       // preview, see below
}
// Todo.habit?: Habit

interface HabitCheck {           // self-reported automaticity (SRBAI, 4 items, 1–7)
  id: string; todoId: string; at: number;
  scores: [number, number, number, number];
  updatedAt: number;
}
```

- **Setting up.** "Build as a habit" on a recurring to-do. An anchor picker suggests common anchors (after breakfast, after brushing my teeth, when I sit at my desk, after I get home…) or free text. Three hints: same time, same place, start small.
- **Reps.** A total that only grows. There is **no streak** and nothing ever resets to zero.
- **This week.** Seven dots and "4 of 5 this week". The week starts on the locale's first day; days roll over at 04:00 like to-dos.
- **Horizon.** "Day 23 · habits take about 2 months, often longer. Judge it at 2–5 months, not weeks." The median is about 66 days and the range is 4–335.
- **Automaticity.** Every two weeks a check-in task asks the four SRBAI statements ("I do it automatically", "without having to consciously remember", "without thinking", "before I realise I'm doing it"). The mean shows as a small line chart drawn the same way as the goal chart.
- **Fading reminders (preview).** The reminder phase moves from on to fading (every other day) to off as automaticity passes 4 and then 5.5. The phase shows with a Preview badge: "Takes effect once notifications ship (Android app)."

## 6. CBT for procrastination

Real: lessons, exercises and logs. Severe or chronic cases need a human, and the app says so.

- **Tiny first step.** "Break it down" in a to-do's menu asks for a first step of two minutes or less, saved in `plan.firstStep`. Tasks shows it as the row's sublabel: "Start: open the doc".
- **Start times, not deadlines.** The when is already a start time. Its label changes from "Due" wording to "Start" wording where it appears.
- **Name the feeling.** When the user skips or postpones a to-do, an optional row of chips asks "What were you avoiding?": bored, anxious, overwhelmed, confused, tired, resentful, other. One tap logs it; ignoring it is fine.
- **Feelings summary.** Coach shows the most common feeling over the last 4 weeks, with the matching tool: overwhelmed → Break it down; anxious → start with 5 minutes; bored → pair it with something; tired → move the start time.
- **Lessons.** Six short static lessons (2 minutes each): tiny first steps; start times beat deadlines; naming the feeling; controlling your environment; being kind to yourself after a lapse; when to get help.
- **Get help.** If the user skipped more than half of their dated to-dos for 3 weeks in a row, Coach shows a calm card: chronic procrastination responds well to CBT, internet-based programmes exist, and a doctor or counsellor can help. It shows fixed text, no diagnosis and no links to specific services.

```ts
interface FeelingLog {
  id: string; at: number;
  todoId?: string;
  feeling: 'bored' | 'anxious' | 'overwhelmed' | 'confused' | 'tired' | 'resentful' | 'other';
  note?: string;
  updatedAt: number;
}
```

## 7. Shaping your environment

- **Set up beforehand** (real). A to-do or habit can carry a short checklist of things to prepare: "phone in another room", "lay out running shoes", "open the textbook at chapter 3". The evening before an occurrence (from 18:00, or 2 hours before for same-day items), it appears in Now as "Set up for: Run".
- **Focus session** (real). From any to-do: a full-screen timer (15, 25, 50 min) showing only the action and its first step. Leaving early asks "Stop now?", once. A note at the bottom: "Tempted? Notice it, wait 10 seconds, keep going."
- **Blocker** (preview). A list of sites and apps to block during focus sessions and set hours, with an on/off switch. Badge: "Needs the browser extension or the Android app." The list is saved.

## 8. Recovery and detachment

- **Off-hours** (real, inside Loci). Days plus start and end times, e.g. weekdays 19:00–08:00 and all weekend. During off-hours, bubbles stop pulsing, the Tasks badge hides, and Tasks shows "Off hours · back at 08:00" with a **Show anyway** link. Task data is unchanged; only display changes.
- **Notification curfew and work-mode shutoff** (preview). The same hours mute all notifications, and a "Work items" switch per locus silences them outside work hours. Badge: "Takes effect once notifications ship (Android app)."
- **Bedtime** (real). A bedtime setting. From an hour before it, starting a Study session shows "It's late. Sleep helps you keep what you learn." with Study anyway and Stop.
- **Burnout check** (real). Monthly, three sliders 0–10: "Exhausted even after rest", "Cynical or detached about it", "Not getting anything done". If two are 7 or above, Coach shows a card: cut demands or get help rather than pushing harder. It offers to push all goal deadlines back by two weeks and halve new-card limits for a fortnight, each with one tap and undo.

```ts
interface WellbeingCheck {
  id: string; at: number;
  exhaustion: number; cynicism: number; inefficacy: number;  // 0..10
  updatedAt: number;
}
```

## 9. Lapse recovery

The gym study's best programme rewarded coming back after a miss. Loci follows it:

- **Weekly targets, not streaks.** Habits count "X of target this week" (see 5). Days beyond the target are grace days and are never shown as failures.
- **Never miss twice.** After a missed or skipped occurrence, the next one shows "Don't miss twice" and sorts as if one level more important.
- **Welcome back.** Completing an occurrence after a miss opens a short celebration sheet ("Welcome back. Coming back is the skill that matters.") and adds one to the habit's **Comebacks** count, shown next to reps.
- **Fresh starts.** On the first day of the week and the first of the month, Tasks and Coach show a banner listing habits with fewer than half their target last week: "New week. Restart Run?" with **Restart** and **Restart smaller** (lowers the weekly target by one, minimum 1).
- **Nothing resets to zero.** Reps, comebacks and challenge counts only grow.

## 10. Becoming more conscientious

- A library of about 30 concrete weekly challenges in three tiers, e.g. easy "Put your keys in the same place every day this week", medium "Plan tomorrow's three tasks each evening", hard "Finish one thing you've been putting off".
- Each week the user picks one, or takes the suggestion (the next untried challenge in their tier). It shows in Now through the week with a tick.
- The weekly review asks whether it was done and offers to move up a tier after two completions in a row.
- The history shows challenges completed over the months. The hard part is staying with it, so the challenge is part of the weekly review rather than a separate thing to remember.

```ts
interface ChallengeWeek {
  id: string; weekStart: number;
  challengeId: string;            // from the built-in library
  status: 'active' | 'done' | 'missed';
  reflection?: string;
  updatedAt: number;
}
```

## 12. Persist or pivot

```ts
interface GoalReviewPlan { at: number; minProgress: number; note?: string }  // "if below 40% at 8 weeks"
// Goal.review?: GoalReviewPlan

interface GoalReview {
  id: string; goalId: string; at: number;
  progress: number;               // 0..1 at the time
  decision: 'persist' | 'rescope' | 'pivot' | 'stop';
  note?: string;
  updatedAt: number;
}
```

- Creating a goal asks for a review date and a criterion: "On [start + 8 weeks], if I'm below [40]%, I'll rescope or switch." Both have defaults; skipping is allowed.
- On the date a **Goal review** task is due in Now. Its sheet brings the data: progress against the criterion, pace, the chart, number of entries, reps and comebacks of linked habits.
- Four choices:
  - **Keep going.** Set the next review date.
  - **Rescope.** Edit targets or the deadline, then set the next review.
  - **Pivot.** Archive this goal and start a revised one with its why and WOOP carried over.
  - **Stop.** Archive it, with an optional note.
- Below the criterion, Rescope and Pivot are listed first with "A revised goal usually beats both grinding on and quitting." The decision stays the user's.
- Every decision is logged and shows in the goal's history.

## The Coach screen

Reached from a new button on the home top bar, next to Tasks. Sections, top to bottom:

1. **Fresh start banner** (when it applies).
2. **Log today.** One-tap ticks for today's habits and counted to-dos.
3. **This week.** Weekly review card (due or done) and this week's challenge.
4. **Habits.** Each habit's week dots, reps, comebacks, day N of ~66.
5. **Procrastination.** Feelings summary, lessons, get-help card when it applies.
6. **Boundaries.** Off-hours, bedtime, notification curfew (preview), burnout check.
7. **Environment.** Focus session, blocker (preview).

### Weekly review

- Day and time are a setting (default the last day of the locale week, 18:00), stored under the `coach` settings key. It produces a **Weekly review** task, active until done or until the next one.
- **Step 1, the data**, gathered automatically:
  - habits X of target
  - goal progress change over the week
  - days studied and items reviewed
  - to-dos done, skipped and missed
  - the challenge
- **Step 2, three prompts:** What went well? What got in the way? One change for next week (offered as a new if-then to-do).
- **Step 3:** the challenge (done or not, pick next week's), then **Share**.

```ts
interface WeeklyReview {
  id: string; weekStart: number;
  stats: Record<string, number>;  // snapshot shown in step 1
  answers: { well?: string; obstacle?: string; change?: string };
  completedAt?: number;
  updatedAt: number;
}
```

## Task model changes

New `Task.kind` values, placed by `sectionOf()`:

| Kind | Produced by | State |
| --- | --- | --- |
| `habitCheck` | Habit, every 2 weeks | due (never overdue) |
| `setup` | To-do with a set-up checklist, the evening before | due |
| `goalReview` | Goal on its review date | due (never overdue) |
| `weeklyReview` | Coach, on the review day | due |
| `challenge` | Coach, through the week | due |
| `wellbeing` | Coach, monthly | due |

Coach-level tasks have no locus. They show in the Tasks screen but pulse no bubble, and the off-hours rule hides all of Now.

## Data model changes

The new tables once every milestone has landed:

```ts
db.version(/* 10+ */).stores({
  recallAttempts:  "id, noteId, at",      // C1
  habitChecks:     "id, todoId, at",      // C3
  goalReviews:     "id, goalId, at",      // C4
  weeklyReviews:   "id, weekStart",       // C5
  challenges:      "id, weekStart",       // C5
  feelingLogs:     "id, at, todoId",      // C5
  wellbeingChecks: "id, at",              // C6
});
```

Each milestone adds only its own tables, so the version goes up once per milestone that needs one.

- New optional fields on existing rows need no migration:
  - `Note.recall?: { srs: Srs; on: boolean }`
  - `Todo.plan?`, `Todo.habit?`, `Todo.setup?: ChecklistItem[]`
  - `Goal.woop?`, `Goal.review?`
  - the deck element's `answerMode`
- Every new table goes into backup (export, parse, merge) and `BACKUP_VERSION` goes up. Element-owned tables (`recallAttempts`, `habitChecks`, `goalReviews`) also go into locus and element deletion and their delete counts.
- Settings keys:
  - `coach`: review day and time, off-hours, bedtime, curfew, blocker list
  - `challengeTier`
- Every new row has `id` and `updatedAt` for import and merge.

## Build order

Each milestone is committed and reviewed before the next starts.

| # | Milestone | Done when |
| --- | --- | --- |
| C0 | This spec | Reviewed |
| C1 | Retrieval | Type mode with `checkAnswer` and derived ratings; "I was right"; notes recall in Study sessions with logged attempts; 28-day spacing strip |
| C2 | If-then plans | Cue and backup plan in the sentence builder; `checkPlan` blocks vague plans with Keep as written; goal why shown; Break it down; "Start:" sublabel |
| C3 | Habits + lapses | Habit mode with anchor picker; reps, week dots, grace days, horizon; SRBAI check-in and chart; never miss twice; welcome back and comebacks; fresh-start banner; reminder phase preview |
| C4 | Goals | WOOP sheet creating a linked if-then to-do; review date and criterion; review sheet with four decisions and log; one-tap check-in buttons; share summary |
| C5 | Coach screen | Route and home button; Log today; weekly review task and flow; challenges library and weekly cycle; feelings log and summary; lessons; get-help card |
| C6 | Boundaries + environment | Off-hours hide Now and pulses; bedtime prompt; burnout check with relief actions; set-up checklists; focus session; curfew and blocker previews |

**Unit tests (Vitest):**

- C1: `checkAnswer` (accents, punctuation, distance scaled to length, multiple answers); notes in the session builder without breaking the time budget.
- C2: `checkPlan` on a table of good and bad plans.
- C3: habit week counting across the 04:00 rollover and DST; the comeback count after a miss; reminder phase thresholds.
- C4: review due logic and the criterion check; pivot carry-over.
- C5: week boundaries for Sunday- and Monday-first locales; challenge suggestion order; weekly stats.
- C6: off-hours intervals crossing midnight and DST; burnout threshold.
