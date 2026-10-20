# Loci v2 — Elements Spec

Oct 20, 2026 · @ANDREW

## Summary

v2 adds four element types on top of the v1 registry: **Problems** (generated quantitative practice), **Notes**, **To-dos** and **Goals**. It switches all spaced repetition to **FSRS**, adds **mixed Study sessions** (flashcards and problems in one queue) and **Test mode** (scheduling toward an exam date), and introduces a general **links** model between items. It upgrades the shared Task model so the Tasks screen separates what needs doing now from what is merely planned. v2 ships on Android and iOS.

Constraints carry over from v1: everything runs on-device, no AI, no paid APIs, no backend. Every library below is free and open-source.

**Out of scope for v2.** Everything that needs a server is v3, because AI requires a backend (API keys can't ship in the app), and a backend brings accounts, sync and payments with it:

- v3: backend, accounts, sync, subscription; AI authoring (templates from pasted or photographed problems, generated phrasings, flashcards from notes); sharing sets and decks; node canvas over the links model; Custom tracker builder.
- v4: Custom rules (trigger, condition and action nodes).
- v2.1: Problems relation mode (one equation, any variable as the unknown). It is specified below so the data model allows it, but it ships after formula mode is stable.

Nothing in v2 should be built speculatively for v3 or v4, except the links model, which is cheap now and expensive to retrofit.

## Core changes

### Task model v2

`getTasks()` stays the single contract between elements and the rest of the app. Tasks now carry state and priority, so screens can split **active** from **inactive** without knowing element internals.

```ts
type Level = 1 | 2 | 3 | 4;   // importance: Low, Medium, High, Critical
                               // difficulty: Easy, Medium, Hard, Very hard

interface Task {
  locusId: string;
  elementId: string;
  itemId?: string;              // the to-do / goal / template inside the element
  kind: "review" | "todo" | "checkin" | "goal";
  state: "overdue" | "due" | "upcoming" | "waiting" | "someday" | "info";
  label: string;                // "Gather receipts", "14 problems due"
  sublabel?: string;            // "Sunday 10:00", "23 days left"
  importance: Level;
  difficulty: Level;
  dueAt?: number;
  progress?: number;            // goals, 0..1
  open(): void;                 // tap
  complete?(): Promise<void>;   // tick, where it makes sense
}

const isActive = (t: Task) => t.state === "overdue" || t.state === "due";
```

- **Bubble pulse** = locus has ≥ 1 active task (unchanged rule, new definition of active).
- Flashcards and Problems produce one combined Study task per locus (see Study sessions), default importance 3, difficulty 2, editable per locus.

### Ordering

Active tasks sort by a score where importance outweighs difficulty but does not fully override it:

```ts
const W_IMPORTANCE = 3;  // tunable
const score = (t: Task) => W_IMPORTANCE * t.importance - t.difficulty;
// sort: score desc → overdue before due → dueAt asc
```

With weight 3, one step of importance beats up to two steps of difficulty. A High/Easy task (8) ties a Critical/Very hard task (8), and the tie goes to the overdue one, then the earlier one. Inactive tasks sort by `dueAt` asc, someday last.

### Tasks screen v2

| Section | Contents | Look |
| --- | --- | --- |
| Now | All active tasks across loci, by score | Full color; overdue gets a red marker |
| Goals and exams | Every open goal (%, time left, pace) and upcoming exam (countdown, readiness) | Full color, never red |
| Planned | Upcoming and waiting to-dos, future check-ins | Greyed; still tickable and editable |
| Someday | To-dos with no when | Greyed, collapsed by default |

The locus view uses the same four groups for its own items. The tag filter still applies.

### Attachments (shared)

Notes, to-dos and goals share one attachment system: links and media (image, audio, video, PDF, any file).

- Files are stored as `Blob`s in IndexedDB (Dexie supports this natively). Images are downscaled to max 2048px long edge with a canvas before saving.
- Links store the URL plus a user-editable title. No link previews: fetching other sites from the browser is blocked by CORS without a server.
- Show storage used via `navigator.storage.estimate()` in settings; warn per file above 25 MB.
- **Export changes from JSON to a .zip** (`data.json` + `blobs/`), since blobs can't live in JSON. Import accepts both the old JSON and the new zip.

### Notifications

Dated to-dos now require real notifications, which a PWA cannot deliver reliably while closed. **This is the point to add the Capacitor Android build** with `@capacitor/local-notifications`.

- Schedule one OS notification per dated to-do occurrence at its due time. Reschedule on every create, edit, complete or delete.
- One "missed" digest at 09:00 the next day listing overdue items.
- Android 13+ needs the runtime notification permission; Android 12+ needs exact-alarm permission for on-time delivery. Ask at the first dated to-do, not at install.
- Browser/desktop: notify via the service worker only while the app is open. Tauri's notification plugin is the desktop fix if ever needed.
- Goal check-ins: notification off by default, opt-in per goal. Someday and waiting items never notify.

**iOS.** Same Capacitor project, adding `@capacitor/ios`. Two constraints:

- iOS keeps at most **64 pending local notifications** per app. Schedule only the 64 soonest; top up on every app open and after every change.
- Building and publishing needs a Mac with Xcode (or a cloud Mac build service) and an Apple Developer Program membership (US$99/year). This is the one unavoidable cost in v2.

### Scheduling: FSRS

All spaced repetition (flashcards and problem templates) moves from SM-2 to **FSRS** via `ts-fsrs`. Do this first, before Problems is built, so templates never need migrating.

```ts
import { fsrs, generatorParameters, createEmptyCard, Rating } from "ts-fsrs";

const f = fsrs(generatorParameters({ request_retention: 0.9, maximum_interval: 365, enable_fuzz: true }));

// Grade buttons: Again = Rating.Again (1) … Easy = Rating.Easy (4)
const preview = f.repeat(item.srs, now);      // all four outcomes → interval labels on the buttons
const { card, log } = f.next(item.srs, now, Rating.Good);
const recall = f.get_retrievability(item.srs, someDate, false); // 0..1, used by Test mode and session ordering
```

- Every reviewable item stores the `ts-fsrs` card object as `srs` (due, stability, difficulty, state, reps, lapses, last\_review and the library's other fields).
- The v1 `schedule()` function is retired.
- **Migration of v1 cards:** where `ReviewLog` rows exist, replay them in time order through `f.next()` (v1 grades 0–3 map to ratings 1–4). Cards without history start in Review state with stability ≈ current interval in days, mid difficulty, due date unchanged. Run once inside the Dexie v2 upgrade.
- Settings: desired retention (default 90%, range 80–95%) per locus.
- Later: personal parameter optimization from review history with the FSRS optimizer package. Not needed for v2.

### Links

Every relationship between two items is a row in one `links` table. Feature tables never store another item's id directly; they reference the link. This keeps one source of truth, and the v3 node canvas reads the same table.

```ts
type ItemRef = { type: "locus" | "element" | "todo" | "goal" | "note" | "card" | "template" | "exam"; id: string };

interface Link {
  id: string;
  from: ItemRef; to: ItemRef;
  kind: "contributes" | "after" | "scope" | "related";
  createdAt: number; updatedAt: number;
}
```

| Kind | From → To | Created by |
| --- | --- | --- |
| contributes | to-do → goal | adding a to-do count contributor |
| after | to-do or goal → to-do | a to-do waiting on another to-do, or on a goal reaching X% |
| scope | deck / problem set → exam | choosing what an exam covers |
| related | any → any | the user, from "Link to…" in any item's menu |

Each item's detail view gets a **Linked items** section listing both directions, with tap-through. Deleting an item deletes its links and warns if a goal or exam loses a contributor.

### Locale and number format

- Default from the device locale (`Intl.NumberFormat().resolvedOptions().locale`). Setting: Auto, `1,234.5`, `1.234,5`.
- Applies everywhere numbers are shown or typed: problem values and options, goal numbers, MathLive input (configure its decimal separator to match).
- Dates and times via `Intl.DateTimeFormat`. First day of week from locale (Sunday in the US), used by date pickers and weekly recurrence chips.

## Problems

A **Problem set** element holds **templates**. A template is a problem with its numbers replaced by variables, plus a formula for the answer. Each time it comes up, the app picks fresh numbers, computes the answer, and builds wrong options from known mistake patterns. The user has to calculate every time; memorizing an answer is impossible.

### What it tests, and its limits

Random numbers alone test **execution**: can you carry out the method correctly. Three features also test **recognition** (knowing which method applies), which is the part that fixed phrasing would otherwise leak:

1. **Interleaving.** Each template counts as its own kind. Sessions mix templates from every set in the locus (across loci only if the user opts into tag-based mixed practice), never the same template twice in a row. The user must identify the problem type each time.
2. **Relation mode.** (v2.1) A template can be an equation (`v = d / t`) instead of a one-way formula. Each instance hides a different variable, so the same relation yields "find v", "find t" and "find d" questions.
3. **Phrasing variants.** Text supports alternatives `{Find|Calculate|Determine}` and multiple full wordings per template, picked at random. In v2 the authoring UI for this stays minimal (an "Add another wording" button); in v3, AI generates wordings when a template is saved.

The hard limit: without an LLM the app cannot invent **new kinds** of problems. Variety is capped by what users author. Template packs (export/import a set as a file) let users share and reuse them.

### Template model

```ts
interface ProblemTemplate {
  id: string; elementId: string;
  title: string;                     // "Average speed"
  texts: string[];                   // wordings; {v} = variable chip, {a|b} = alternative
  vars: VarSpec[];
  mode: "formula" | "relation";
  answer: MathJSON;                  // formula mode: expression for the answer
  relation?: MathJSON;               // relation mode: ["Equal", lhs, rhs]
  askable?: string[];                // relation mode: which vars may be hidden
  derived?: { name: string; expr: MathJSON }[];  // intermediate values, computed in order
  constraints: MathJSON[];           // must all be true, e.g. b^2 - 4ac >= 0
  answerFormat: { decimals?: number; sigFigs?: number; unit?: string };
  customDistractors: { expr: MathJSON; label: string }[];
  answerMode: "choice" | "typed";    // typed = numeric entry with tolerance
  srs: FsrsCard;                     // ts-fsrs card object, same as flashcards
}

interface VarSpec {
  name: string;                      // "d"
  unit?: string;                     // "km"
  source: { kind: "range"; min: number; max: number; step: number }
        | { kind: "list"; values: number[] };
  exclude?: number[];                // e.g. [0]
}
```

Formulas are stored as **MathJSON**, the JSON form that MathLive produces from the visual editor. It is plain nested arrays (`["Divide", "d", "t"]`), which makes both evaluation and mutation into wrong answers simple tree operations.

### Number generation

1. Seed a PRNG (`seedrandom`) per instance and store the seed with the attempt, so any instance can be replayed exactly.
2. Sample each variable from its spec. Ranges snap to `step`, so `min 20, max 200, step 5` gives values like 35, 120, 185.
3. Compute `derived` values, then the answer.
4. Check constraints, plus built-ins: answer is finite and real, no division by zero. On failure, resample. Give up after 200 tries and flag the template as "constraints too tight" in the editor.
5. **Relation mode:** sample the independent variables, compute the dependent one from the relation, then choose a variable from `askable` to hide. Every value stays consistent and no algebraic solving is needed for the correct answer.

### Realistic wrong answers

Each wrong option comes from applying **one mistake rule** to the answer formula, then evaluating it with the same numbers. Every option therefore corresponds to a specific error a student could actually make.

| Rule | Mutation on the formula tree | Example |
| --- | --- | --- |
| Order of operations | Evaluate strictly left to right, ignoring precedence | `a + b·c` → `(a + b)·c` |
| Dropped factor | Remove one factor or constant from a product | `½ m v²` → `m v²` |
| Dropped term | Remove one term from a sum | `v₀ + a t` → `a t` |
| Sign slip | Negate one term | `a − b` → `a + b` |
| Inverted ratio | Swap numerator and denominator | `d / t` → `t / d` |
| Power slip | Drop or misapply an exponent or root | `r²` → `2r`, `√x` → `x` |
| Wrong variable | Swap two variables with the same unit | radius ↔ diameter |
| Unit slip | Multiply or divide by a factor implied by the units present | ×1000 for km↔m, ×60 for min↔s |
| Author-defined | Any formula the author adds, with a label | "Used diameter instead of radius" |
| Fallback | Near-miss: ±10–30% or swapped digits | Only if the rules above produce too few |

In **relation mode**, the rule mutates the relation instead, and the app solves the mutated relation for the hidden variable numerically (bisection or Newton, seeded at the correct value).

**Filtering.** A candidate is kept only if it:

- is finite and real;
- differs from the correct answer and every other option after rounding to the answer format;
- differs from the correct answer by at least 2% (tunable);
- has the same sign as the correct answer, unless it came from the sign-slip rule;
- is within 1000× of the correct answer's magnitude.

Pick 3 survivors (4 options total), preferring author-defined rules, then a random mix of the rest. **All options are formatted identically** (same decimals or sig figs, same unit), so the correct one never stands out by its shape. Shuffle positions.

**Feedback.** Each option remembers which rule produced it. Picking a wrong one shows that rule's explanation ("You added before multiplying") next to the worked answer with the actual numbers substituted. This is the main teaching payoff, and it costs nothing extra.

### Math input and display

- **Input:** MathLive's `<math-field>` everywhere a formula is typed. It is a visual editor (fractions, roots and exponents appear as you type them) with an on-screen math keyboard on phones. It outputs MathJSON directly.
- **Evaluation:** the Compute Engine (same authors as MathLive) evaluates MathJSON with variable values substituted.
- **Display:** KaTeX renders formulas in question text, feedback and notes. It is fast and lightweight for read-only math.
- Users never type syntax like `sqrt(9)` or `{1/2}`.

### Authoring flow (low friction)

The primary path is **create from an example**:

1. User pastes or types a real problem: "A car travels 120 km in 2.5 h. What is its average speed?"
2. The app detects each number and turns it into a variable chip. It suggests a name (from the next word: `km` → `d`, or `a, b, c`) and a range (same decimal places, roughly half to double the original).
3. User writes the answer formula in the math field by tapping chips: `d / t`. Optional: answer unit and rounding.
4. **Preview** shows 5 generated instances with their options. The user can regenerate, tweak ranges, or add a constraint.
5. Save. The template is due immediately.

Advanced users can open the full editor: multiple wordings, relation mode, derived values, custom distractors and constraints.

### Sessions and scheduling

- Each **template** is one FSRS item, reviewed inside the locus's mixed Study session (next section) or on its own from the set's tile.
- Rating is derived, not self-reported. Wrong → Again. Correct but slower than 1.5× the user's own median time on that template → Hard. Correct → Good. Correct in under 0.6× median → Easy. The first 3 attempts have no median and rate correct as Good.
- A missed template returns later in the same session with new numbers.
- Log every attempt (`ProblemAttempt`: seed, chosen option, rule hit, time, correct) for stats and for spotting templates that are always failed via the same rule.

&#91;embedded content: problem generation pipeline · one instance\]

Each wrong option keeps the rule that produced it, so a wrong pick can name the exact mistake.

## Study sessions and Test mode

### One review queue

Flashcards and problem templates share one interface, so the app can review them together:

```ts
interface Reviewable {
  ref: ItemRef;                    // card or template
  srs: FsrsCard;
  estSeconds: number;              // user's median time for this item type, defaults: card 8, problem 60
  present(container: HTMLElement): Promise<Rating>;  // card: self-graded; problem: derived rating
}
```

### Study sessions

- Each locus gets a **Study** button: one session mixing every due card and template in the locus. Each deck or set tile keeps its own Study button for single-element sessions.
- **Length in minutes, not items:** 5, 10, 15 (default), 25 or Until done. The builder fills the time using `estSeconds`, since a card takes seconds and a problem a minute or more.
- **Selection order:** lowest current recall first (`get_retrievability` at now), so the items closest to being forgotten are never cut by the time limit.
- **Ordering within the session:** interleave. No same template twice in a row, avoid two items from the same deck or set back to back, and spread problems evenly between cards instead of clumping them.
- **Tasks:** one task per locus, "Study · 14 cards, 6 problems · \~12 min". A setting splits it into one task per deck or set.

### Test mode (Exams)

An **Exam** is an item inside a locus with a date and a scope (decks and problem sets, linked with `scope` links; default: all of them in the locus). While an exam is upcoming, scheduling for items in scope changes from "remember long-term" to "be strong on exam day".

```ts
interface Exam {
  id: string; locusId: string;
  title: string;                   // "Physics midterm"
  date: number;
  targetRecall: number;            // default 0.9
  status: "upcoming" | "done";
  createdAt: number; updatedAt: number;
}
```

1. **Interval cap.** After each review of an in-scope item, if the new due date falls after `exam.date − 2 days`, check its predicted recall on exam day. If that is below `targetRecall`, move the due date earlier, to the last day before the exam where recall is still at target (minimum: tomorrow).
2. **Final pass.** In the last 2 days, every in-scope item with predicted exam-day recall below target becomes due.
3. **New material pacing.** Unseen items in scope are introduced at `ceil(unseen ÷ max(1, daysLeft − 2))` per day, overriding the deck's normal daily limit if higher. The user sees the number and can lower it.
4. **Readiness.** Mean predicted exam-day recall across all items in scope, with unseen items counting as 0. Shown as a %.
5. **After the exam** (date passed): status → done, caps lift, items keep their FSRS state and continue normally. Nothing resets.

**Display:** exams appear in the Tasks screen's Goals section (rename it **Goals and exams**) with countdown and readiness, never red. Their study load arrives through the locus's Study task. Readiness can later be a goal contributor.

## Notes

A **Notes** element is a notebook: a list of notes inside the locus. Notes never create tasks (`getTasks()` returns `[]`).

- **Editor:** TipTap (MIT core extensions only; skip the paid Pro extensions). Headings, lists, checklists, bold/italic, code, quotes.
- **Math:** a math node that opens MathLive for editing and renders with KaTeX, same as Problems. Inline and block.
- **Attachments:** paste or drop an image to insert it inline; other files and links go in an attachment strip at the bottom of the note. Uses the shared attachment system.
- **Links:** pasted URLs become links. Display domain + optional title; no preview fetch.
- **List view:** title, first line, updated date, pinned notes first. Search by title and text across the notebook. A global search across all loci is a later addition.
- **Storage:** content as ProseMirror JSON, plus a derived `plainText` field for search.
- **Tile in locus view:** notebook title, note count, last edited note.
- Autosave on every change, debounced 500 ms. No save button.

## To-dos

A **To-do list** element holds to-dos written as plans: a **when** plus an **action**, e.g. "Sunday 10:00 · Gather receipts". The when is required in the form; "Someday" is allowed but offered last and discouraged.

### The when model

```ts
type When =
  | { kind: "at"; at: number; hasTime: boolean }                 // Sunday 10:00 / 3 Nov
  | { kind: "repeat"; rrule: string; time?: string; next: number } // every Mon at 07:30
  | { kind: "after" }                                            // after another to-do is done ("after" link)
  | { kind: "goal"; percent: number }                            // when a goal reaches X% ("after" link)
  | { kind: "when"; condition: string; firedAt?: number }        // "when the package arrives"
  | { kind: "someday" };

interface Todo {
  id: string; elementId: string;
  title: string;                 // the action
  why?: string;                  // optional: why it matters
  importance: Level; difficulty: Level;
  when: When;
  status: "open" | "done" | "archived";
  createdAt: number; updatedAt: number;
}

interface TodoCompletion {        // one row per occurrence handled
  id: string; todoId: string;
  occurrenceAt: number;          // the scheduled time it belonged to
  doneAt?: number;               // missing = skipped / missed
  outcome: "done" | "skipped" | "missed";
}
```

**"When X happens" without AI.** The app can't observe the outside world, so conditions come in two flavors:

- **Machine-checkable** (`after`, `goal`): the app fires them itself when the other to-do is ticked or the goal crosses the threshold.
- **Manual** (`when`): the condition is free text. The to-do sits in Planned as "Waiting: when the package arrives" with an **It happened** button. Tapping it sets `firedAt = now` and the to-do becomes due immediately.

### Entry: a sentence builder

The add form reads as one sentence: **\[When chip\] · \[action text\]**, with importance and difficulty as two compact 4-step selectors below, and optional why and attachments behind a "More" toggle.

- The when chip offers, in order: quick picks (Tonight, Tomorrow morning, This weekend, Next week), date + time picker, Repeat…, After a to-do…, When a goal reaches…, When something happens…, and last, Someday.
- **Typed shortcut:** parse the action text with chrono-node. "Sunday 10am gather receipts" becomes when = next Sunday 10:00, title = "Gather receipts". "Every Monday at 7:30 run" becomes a repeat via `rrule`'s text parser. The parsed when shows as a chip the user can tap to correct.
- Choosing Someday shows one line: "To-dos with a when get done far more often. Add one?" with the quick picks. Not a blocker.
- Optional later: a built-in weekly review to-do ("Plan 3 someday items") the user can enable.

### State and the active rule

```ts
function todoState(t: Todo, now: number): Task["state"] {
  if (t.status !== "open") return "info";
  switch (t.when.kind) {
    case "someday": return "someday";
    case "when":    return t.when.firedAt ? "due" : "waiting";
    case "after": case "goal": return "waiting";   // flips to "at now" when fired
    default: {
      const due = t.when.kind === "at" ? t.when.at : t.when.next;
      if (now < due) return "upcoming";
      return now < nextRollover(due) ? "due" : "overdue";  // rollover = next 04:00
    }
  }
}
```

- Date-only to-dos are due from 04:00 that day. Timed to-dos are due from their time. Both turn overdue at the next 04:00.
- Only `due` and `overdue` are active: they pulse the bubble, appear in Now and can notify. Everything else is greyed in Planned or Someday, still editable and tickable.
- When an `after` or `goal` trigger fires, convert it to `{ kind: "at", at: now, hasTime: true }` so it follows the dated rules from then on.

### Recurrence

- Store the rule as an RFC 5545 RRULE string (`FREQ=WEEKLY;BYDAY=SU`) and cache `next`.
- **Done** logs a `TodoCompletion` and advances `next` to the first occurrence after now.
- **Skip** logs `skipped` and advances.
- If several occurrences passed while the app was closed, show only one overdue instance. On resolve, log the rest as `missed` and jump to the next future occurrence. No pile-ups.
- Completions feed Goals (counts, streaks).

## Goals

A **Goals** element holds goals. A goal is a title, an optional deadline, an optional "why it matters" text, and **at least one contributor with an exact target**. Its progress bar is the weighted average of its contributors' progress.

### Contributors

| Type | Linked to | Target the user must set | Progress |
| --- | --- | --- | --- |
| To-do count | A to-do, usually recurring ("Violin session, daily") | Number of completions, e.g. 60 | completions since goal start ÷ target |
| Number check-in | A recurring check-in | Start value and target value, e.g. 80 → 75 kg | (current − start) ÷ (target − start), clamped 0..1 |
| Slider check-in | A recurring check-in | Target on 0–10, e.g. confidence 3 → 8 | same formula on the latest rating |
| Checklist | Milestones listed inside the goal | All, or N of them | ticked ÷ target |
| Problems accuracy (later) | A Problem set | Accuracy % over last 20 attempts | latest accuracy ÷ target |

- A goal **cannot be saved without a contributor**. If the user adds none, the app creates a default: a weekly slider check-in "How far along are you?" (0–100%, target 100).
- A to-do count contributor can link to an existing to-do or create a new recurring one inline.
- To-dos can live in any locus; the connection is a `contributes` link, and the contributor row holds its `linkId`.

### Weights

Each contributor has importance and difficulty (taken from the linked to-do, or set on the check-in):

```ts
const weight = (c: Contributor) => c.weightOverride ?? (2 * c.importance + c.difficulty);
const goalProgress = (cs: Contributor[]) =>
  cs.reduce((s, c) => s + weight(c) * progress(c), 0) / cs.reduce((s, c) => s + weight(c), 0);
```

The detail view shows each contributor's own bar, its target, its current value and its weight (editable). The card shows only the overall %.

### Check-ins

- Each check-in contributor has a schedule (RRULE: daily, weekly, every N days).
- When one is due, `getTasks()` returns a `checkin` task in **Now**: "Check in: Learn violin". Opening it shows a small form per due contributor (number field, slider or checkboxes).
- Each answer is stored as a `GoalEntry { contributorId, at, value }`. Progress always uses the latest entry; history drives the chart.
- Check-ins are active (they pulse the bubble) but **never overdue or red**. A missed check-in simply stays due. Notifications are opt-in per goal.

### Time left and pace

- With a deadline: show "23 days left". Without one: show nothing.
- **Pace:** expected progress if linear = elapsed time ÷ total time. Show "On pace" or "Behind by 12%" as plain text, never an alarm.
- Goals appear in the Tasks screen's **Goals** section always, plus their check-ins in Now when due.
- When the deadline passes: the goal shows "Ended" with three actions: Mark achieved, Extend deadline, Archive.

### Goal card

Title, % bar, time left and pace, and the **why** text shown on the card itself every time (2 lines, tap to expand). Detail view: contributors, a progress-over-time line (draw it in SVG; no chart library needed), attachments, history of entries.

## Data model changes

v2 adds tables and changes one: `cards` gets an `srs` field (the FSRS card object), filled by replaying review history during the upgrade (see Scheduling: FSRS). The old SM-2 fields stay in place, unused, until a later version removes them.

```ts
db.version(2).stores({
  // v1 (cards index changes to the FSRS due date)
  tags: "id, &name", loci: "id", elements: "id, locusId",
  cards: "id, elementId, [elementId+srs.due]", reviews: "id, cardId, at",
  // v2
  problemTemplates: "id, elementId, [elementId+srs.due]",
  problemAttempts:  "id, templateId, at",
  notes:            "id, elementId, updatedAt, pinned",
  todos:            "id, elementId, status, when.kind",
  todoCompletions:  "id, todoId, occurrenceAt",
  goals:            "id, elementId, status, deadline",
  goalContributors: "id, goalId, linkId",
  goalEntries:      "id, contributorId, at",
  exams:            "id, locusId, date, status",
  links:            "id, [from.type+from.id], [to.type+to.id], kind",
  attachments:      "id, [ownerType+ownerId]",
  blobs:            "id",          // { id, data: Blob, mime, size }
  settings:         "key",         // locale/number format, retention, notification prefs
}).upgrade(migrateCardsToFsrs);
```

```ts
interface Attachment {
  id: string;
  ownerType: "note" | "todo" | "goal";
  ownerId: string;
  kind: "link" | "image" | "audio" | "video" | "pdf" | "file";
  name: string;
  url?: string;          // links
  blobId?: string;       // media and files
  mime?: string; size?: number;
  createdAt: number;
}
```

- Every new record has `updatedAt` for import/merge.
- Compound indexes on nested paths (`srs.due`, `from.id`) work in current Dexie; if the installed version objects, mirror them as flat top-level fields (`due`, `fromKey`).
- Deleting a to-do that a goal contributor links to: block with an in-app prompt to unlink or delete the contributor too.
- Deleting a note, to-do or goal deletes its attachments and orphaned blobs.

## Libraries

All free and open-source. Confirm each license before adding; pin exact versions.

| Package | Used for | Element |
| --- | --- | --- |
| `ts-fsrs` | FSRS scheduling, interval previews, predicted recall | Flashcards, Problems, Test mode |
| `mathlive` | Visual math input field + on-screen math keyboard; outputs MathJSON | Problems, Notes |
| `@cortex-js/compute-engine` | Evaluate MathJSON with substituted values | Problems |
| `katex` | Fast read-only math rendering | Problems, Notes |
| `seedrandom` | Seeded random numbers, replayable instances | Problems |
| `@tiptap/core` + free extensions | Rich text editor | Notes |
| `chrono-node` | Parse "Sunday 10am" from typed text | To-dos |
| `rrule` | Recurrence rules, next occurrence, "every Monday" text parsing | To-dos, Goals |
| `jszip` | Zip export/import with media | Core |
| `@capacitor/core`, `@capacitor/android`, `@capacitor/ios`, `@capacitor/local-notifications` | Native builds and scheduled notifications | Core |

No chart library: the goal progress line is a hand-drawn SVG polyline.

**Language note:** chrono-node and rrule's text parser are strongest in English. If the UI is Italian, check chrono's locale support and treat typed parsing as a convenience; the picker is the primary input.

## Build order

Two tracks after a shared start. Track A (notes, to-dos, goals) is sequential because each step depends on the last. Track B (Problems and studying) can run in parallel. B3 carries the most risk. FSRS goes first so nothing is ever built on SM-2 again.

| # | Milestone | Done when |
| --- | --- | --- |
| 0 | Core v2 + FSRS + links | v1 cards migrated to FSRS with history replayed; grade buttons show FSRS intervals; Task model v2; Tasks screen shows Now / Goals and exams / Planned / Someday; ordering by score; links table with Linked items section; attachments + blob storage; zip export/import round-trips everything; locale and number-format setting |
| A1 | Notes | Notebook with rich text, inline images, attachment strip, math nodes, search; autosave |
| A2 | To-dos | Sentence-builder entry with all when kinds; chrono and rrule parsing; active/inactive states; recurrence with done/skip/missed; It happened button; after-link triggers fire |
| A3 | Android notifications | Capacitor Android build; dated to-dos notify on time with the app closed; missed digest; reschedule on edit |
| A4 | Goals | All contributor types except Problems accuracy; required target; default check-in; weights; check-in flow; time left and pace; ended state |
| B1 | Problem engine | Formula mode: variables, ranges, constraints, derived values, seeded sampling; unit tests on 10 sample templates |
| B2 | Math input + authoring | MathLive in the editor with locale decimal separator; create-from-example builds chips; 5-instance preview; simple Add another wording |
| B3 | Wrong-answer engine | All mistake rules as MathJSON mutations; filtering; identical formatting; feedback per rule. Done when 3 plausible distractors appear for every test template across 50 random instances |
| B4 | Study sessions | Reviewable interface; FSRS per template with derived ratings; locus Study button mixing cards and problems; minutes-based length; lowest-recall-first selection; interleaving rules; one Study task per locus |
| B5 | Test mode | Exams with scope links; interval cap; final pass; new-material pacing; readiness %; caps lift after the date |
| L | iOS + launch | Capacitor iOS build; 64-notification top-up; App Store and Play Store listings; tested on a real iPhone and Android phone |
| 2.1 | Relation mode + Goals ↔ Problems | Relation mode with numeric solving for distractors; Problems accuracy and exam readiness as goal contributors |

**Unit tests (Vitest):** `todoState()` around the 04:00 rollover and DST changes; RRULE next-occurrence and missed-occurrence collapse; goal progress and weights; every mistake rule on a fixed template; distractor filtering (duplicates, sign, magnitude); constraint resampling limit; FSRS migration replay against a known log; Test mode interval cap and readiness on a fixed set of items and dates; session builder never exceeds its time budget and never repeats a template back to back.
