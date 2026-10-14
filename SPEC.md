# Study App — MVP Spec (v0.1)

> Working name: TBD. One-line pitch: **the flashcard app where cards can be problems.**

## What this is

A web app for spaced-repetition studying where a deck can hold two kinds of cards:

1. **Flashcards**: normal front/back cards (like Anki).
2. **Problem cards**: a *template* that generates a fresh variant every time it comes up for review (new numbers, new verb, new angle), with the answer computed or looked up automatically.

Both card types live in the same deck and are scheduled in the same review queue.

## Hard constraints (do not break these)

- **No backend, no accounts, no AI, no image upload, no payments.** Everything runs in the browser.
- Data is saved in `localStorage`. Because that can be wiped, the app must offer **Export (JSON download)** and **Import (JSON upload)**.
- Must work well on a phone browser as well as desktop.
- Keep the code simple and readable. The owner is learning; prefer clarity over cleverness.
- Starting a study session must take **two clicks or fewer** from opening the app.

## Tech stack

- Vite + React + TypeScript
- `ts-fsrs` for scheduling (FSRS algorithm)
- `mathjs` to evaluate answer formulas safely (never use `eval`)
- `katex` to render math in cards (inline `$...$` syntax)
- Plain CSS or CSS modules. No UI framework needed.

## Data model

```ts
type Deck = { id: string; name: string; cardIds: string[] };

type Flashcard = {
  id: string; type: "flashcard";
  front: string; back: string;        // may contain $math$
};

type FormulaProblem = {
  id: string; type: "formula";
  prompt: string;                      // "A car travels {d} km in {t} h. Average speed in km/h?"
  vars: Record<string, { min: number; max: number; step: number }>;
  answer: string;                      // mathjs expression, e.g. "d / t"
  tolerance?: number;                  // default 0.01 (absolute)
  decimals?: number;                   // how to display the answer, default 2
  solution?: string;                   // "v = {d} / {t} = {answer}"
};

type TableProblem = {
  id: string; type: "table";
  prompt: string;                      // "Conjugate {verb} for {person}" or "sin({angle})"
  rowKey: string; colKey: string;      // names used in the prompt, e.g. "verb", "person"
  rows: string[]; cols: string[];
  cells: string[][];                   // cells[row][col] = correct answer
  mode: "typed" | "choice";            // choice = 4 options, distractors taken from other cells
};

type Card = Flashcard | FormulaProblem | TableProblem;
// Each card also stores its FSRS state (from ts-fsrs) keyed by card id.
```

## Review behavior

- The study queue mixes all due cards from the selected deck(s) (interleaving is intentional).
- **Flashcard:** show front → "Show answer" → user rates Again / Hard / Good / Easy.
- **Formula problem:** pick random values for each variable, render the prompt, user types a number.
  - Correct (within tolerance) → preselect **Good**, user can change to Hard/Easy.
  - Wrong → show the correct answer and solution, rate **Again**.
- **Table problem:** pick a random row and column, render the prompt.
  - `typed`: compare after normalizing (trim, lowercase, ignore accents only if the pack says so).
  - `choice`: show 4 options (correct + 3 other distinct cells from the same column).
  - Same rating behavior as formula problems.
- FSRS schedules the *template*, not the individual variant.
- Always allow a "Show answer / I'll self-grade" fallback on problem cards.

## Screens

1. **Home**: cards due today, streak (consecutive days with ≥1 review), big "Study" button, list of decks.
2. **Study**: one card at a time, progress indicator, rating buttons. End screen with a short summary.
3. **Deck**: list of cards, "Add flashcard" form (front/back with live math preview), delete card.
4. **Packs**: built-in packs the user can add to their collection with one click.
5. **Settings**: Export / Import JSON, reset data.

Problem templates are authored as JSON packs in v1. A template editor UI is **out of scope** for the MVP.

## Built-in packs (v1)

Stored as JSON files in `src/packs/`.

1. **Trigonometry**: unit circle exact values (table, choice mode), right-triangle side/angle problems (formula), core identities (flashcards).
2. **Kinematics**: v = d/t, a = Δv/t, suvat problems (formula), definitions (flashcards).
3. **Language: present-tense conjugation**: one language, ~10 verbs (table, typed mode), plus vocabulary flashcards.

## Out of scope for the MVP

Accounts, sync, AI, image/screenshot input, exam-date mode, stats dashboards, sharing, mobile app, payments, template editor.

## Milestones (build one at a time, stop after each so the owner can test)

1. **Foundation**: project setup, decks, flashcards, FSRS scheduler, study screen, localStorage.
   *Done when:* I can make a deck, add cards, review them, and see them reappear on schedule.
2. **Formula problems** + KaTeX rendering.
   *Done when:* a kinematics template shows new numbers each time and checks my answer.
3. **Table problems** (typed and choice modes).
   *Done when:* conjugation and unit-circle cards work.
4. **Packs, Home screen, streak, Export/Import.**
   *Done when:* a new user can open the app, add a pack and start studying in two clicks.
5. **Polish and deploy**: mobile layout, empty states, basic styling, deploy as a static site.

## Instructions for the coding assistant

- Read this whole file first. Build **only the current milestone**, then stop and summarize what changed in plain language.
- After each milestone, make a git commit with a clear message.
- If something in this spec is ambiguous, ask instead of guessing.
- Don't add libraries beyond the ones listed without asking.
