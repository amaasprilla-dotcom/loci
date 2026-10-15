# Study App — Spec 2 (v0.2): Study Science + Card-Game Feel

> Builds on **SPEC.md (v0.1)**, which is complete. Read SPEC.md first; everything in it still applies unless this document says otherwise.
> Pitch is unchanged: **the flashcard app where cards can be problems.** v0.2 makes it *feel* like a game and makes the learning science visible.

## Goals for v0.2

1. Put the research we base the app on into the design, not just the marketing.
2. Make studying feel tactile and rewarding, in the spirit of card games like Balatro: chunky cards, satisfying animations, a score that counts up.
3. Show people their progress so the "desirable difficulty" of good studying feels worth it.

## Still out of scope

Accounts, sync, backend, AI, image input, payments, deployment changes. Everything stays in the browser (`localStorage` plus Export/Import).

## Study engine changes

### 2.1 Interleaving rules
- The **Study** button on Home starts a **Mixed session** across all decks with due cards. Picking a single deck is still possible.
- Queue ordering rules, applied when alternatives exist:
  - Never show two cards from the same template back to back.
  - Never show more than 2 cards in a row with the same `topic` tag.
- New problem templates are introduced spread out across the session, not grouped together.

### 2.4 Self-monitoring: confidence and calibration
- Remove the option to self-check an answer, instead offer multiple choices, randomly generated though reasoned, for the solution to a problem, so, in problems that are of quantitative nature, users get option to press and no longer the typing bar.
- Users can also willingly skip a card (this makes sense later), though it will not count it as cleared.

### 2.5 Session sizing and breaks
- Setting: **Session length** = 15 / 30 (default) / 45 / 60 minutes, or "until queue is empty".
- When the time is up, show a calm interstitial: *"Good place to stop. A second short session later beats one long one."* with **Finish** and **Keep going** buttons.
- If "Keep going" is chosen past 60 minutes total, suggest a 10-minute break once.
- End-of-session screen always shows: cards reviewed, problems solved, skipped, accuracy/score, time.

### 2.6 Exam mode (now in scope)
- Per deck: optional **exam date**.
- While an exam date is set:
  - Cap the maximum review interval at `max(1 day, 15% of days remaining)`.
  - Introduce new cards at a pace that finishes introducing all of them by **exam date minus 3 days**.
  - In the final 2 days, every card in the deck comes up at least once.
- After the exam date passes, ask: *"Keep studying this deck for the long term?"* If yes, remove the cap and return to normal FSRS. If no, archive the deck.
- Home shows a countdown chip on decks with an exam date.

---

## Part 3: Look and feel — card-game interface

Direction: the tactile, juicy feel of roguelike card games such as Balatro. Cards are physical objects you pick up, flip and play.

> **IP rule:** use this as a *feel* reference only. Do **not** copy Balatro's art, card designs, logo, name, fonts, sounds or layout. All visuals, fonts and sounds must be original or openly licensed (e.g. Google Fonts pixel fonts, CC0 sound packs such as Kenney's).

### 3.1 Cards
- Cards actually LOOK like cards, right shape, a subtle drop shadow, and rounded corners. Cards are cards.
- **Idle:** a slow gentle float or sway.
- **Flip:** a real 3D flip to reveal the answer.
- **Answering:**
  - Correct: the card "plays" upward into a tray with a small bounce and points popping off it.
  - Wrong: a short shake, then the solution flips in.
- Card faces are color-coded by type: flashcard, formula problem, table problem, strategy card. Each type has its own suit-like icon (original designs).

### 3.2 Decks and packs
- Decks on Home are drawn as physical card **stacks/decks** whose height reflects their card count.
- Decks with due cards are highlighted
- Adding a built-in pack plays a **pack-opening** animation: the pack tears open and its cards fan out. Do not have a separate section for templates, those are available when you make a new deck.
- Change layout of the UI, it should be long horizontal buttons, it should be a sort of slotted layout, you have a plus button to add a deck inside any open slot.
- **Card backs:** each deck has a card-back design. A few are available from the start, and more are unlocked with coins (§4.1).

### 3.3 Typography, color, sound
- One display font from Google Fonts for scores and headings, plus a clean readable font for card content. Math stays in KaTeX.
- Palette: dark felt-table background with saturated card colors. Define colors as CSS variables so they're easy to retune.
- **Sound effects** (CC0 only): flip, play, correct, wrong, score tick, pack open. There's a Settings toggle, on by default at low volume.

### 3.4 Performance and accessibility
- Use CSS transforms and opacity for animations; keep it smooth on mid-range phones.
- Respect `prefers-reduced-motion`, and add a **Calm mode** toggle in Settings that disables float, tilt, shake and particles.
- Text on cards must stay highly readable; style never overrides legibility.

---

## Part 4: Rewards

Principle: **reward showing up and finishing, not gaming the system.** Self-graded flashcards earn points for completion only, never for choosing "Easy", so there's no incentive to lie to yourself. Accuracy-based bonuses apply only to auto-checked problems.

### 4.1 Session score (points × multiplier)
- Each completed card adds **points**:
  - Flashcard: 5
  - Problem answered correctly: 10
  - Strategy card answered correctly: 15
  - Wrong answer: 2, because attempting still counts.
  - All visibly added to your counter with juice
- **Combo multiplier:** each consecutive correct auto-checked answer raises the multiplier by 0.5 (max ×4). A wrong answer resets it to ×1. Flashcards don't affect the multiplier.
- The end screen shows a satisfying count-up: *points × mult = session score*.

### 4.3 Daily completion and companion
- **Daily goal:** clear today's due queue, or study for the chosen session length. (This is only true if there are due cards to begin with, the log in goal should tie to actual retrieval time)

## Part 5: Progress dashboard

New **Progress** screen, built with simple SVG or CSS charts (no chart library unless approved):
1. **Study calendar heatmap**: reviews per day over the past ~4 months.
2. **Retention**: % of reviews (not new cards) answered correctly, last 30 days, with a trend arrow.
3. **Upcoming**: due cards for the next 7 days as a bar chart, with exam dates marked.
4. **Per-deck mastery**:
   - **New** — never reviewed
   - **Learning** — FSRS stability under 21 days
   - **Solid** — stability of 21 days or more
6. **Time studied**: per day and per week.

Each chart has a one-line "what this means" caption in plain language.

---

## Part 6: Data model changes

**Migration (required):** add a `schemaVersion` to stored data. On load, upgrade v0.1 data to v0.2 **without losing anything**. Defaults: empty review log, empty profile, no exam dates. Export/Import must include the review log and profile. Importing a v0.1 export must still work.

---

## Part 6: Milestones (one at a time; stop after each for testing)

1. **Data foundation**: schema version and migration, review log written on every review, Profile storage, Export/Import updated.
   *Done when:* my existing v0.1 data loads untouched, and every review I do appears in the log.
2. **Study engine**:
   *Done when:* a mixed session never clumps one template, Strategy cards appear, and an exam deck caps its intervals.
3. **Card-game look and feel**: card styling, float/tilt/flip/play/shake, deck stacks, pack opening, card backs, fonts, palette, sounds, Calm mode, reduced motion.
   *Done when:* studying feels tactile on both desktop and phone, and Calm mode turns it all off.
4. **Rewards**: points × mult scoring and end-screen count-up, coins, badges and shelf, streak with rest day, companion and cosmetics.
   *Done when:* finishing my daily queue triggers the companion moment, and badges unlock correctly.
5. **Progress dashboard**: all six panels with captions.
   *Done when:* charts match what's in the review log.

## Instructions for the coding assistant

- Read **SPEC.md** and then this file. Build **only the current milestone**, then stop and summarize what changed in plain language.
- **Never break v0.1 features or lose user data.** Test the migration with real v0.1 data before moving on.
- Make a local git commit after each milestone (no GitHub needed), so any milestone can be undone.
- Allowed new dependency: `motion` (animation), only if CSS alone can't do it well. Ask before adding anything else.
- No copied third-party art, fonts or sounds. Use only original or openly licensed assets, and note each asset's license in `ASSETS.md`.
- If something here is ambiguous, ask instead of guessing.
