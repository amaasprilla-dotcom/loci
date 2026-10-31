# Loci v5 — Now Card & Priority Engine Spec

Source: "Loci — Build Spec v1: Now Card & Priority Engine" (Oct 31, 2026). This file is that spec as the repo's v5, with the decisions made while building P0 recorded under **Decisions**.

## Summary

v5 replaces the due-list as the entry point with one ranked **Now card**, ties goals and exams into that ranking, and cuts input per item to one required field. Everything else stays as it is unless a section says otherwise.

- Constraints: browser PWA, offline, no account, no AI, no paid APIs. Everything runs on local data with rules.
- Out of scope: human-in-the-loop features, anything that needs an LLM, OS-level blocking until the Android app exists.
- Success metric: goal progress per minute spent in the app. Proxy: share of Now cards started within 10 minutes of being shown.
- Hard rules for every screen: app open to started work in 2 taps or fewer; adding an item needs 1 required field; no counts of what wasn't done.

## Decisions (made while building P0)

- **Red stays outside the signals.** The spec's "no red anywhere" is not applied to Delete buttons, form errors, wrong answers, the sync-error dot or the bubble colour palette. Only the overdue marker changes (see Signals), because the Signals table replaces it.
- **To-do Start opens a new minimal focus timer** (25 min). Loci had none. P1 adds the 2- and 5-minute timers and breadcrumbs to it.
- **Off-hours, welcome-back and notifications** are not in the code yet, so their card states wait for the phase that builds them (P1 for the notification budget).
- **Scheduler:** Loci is already on FSRS (ts-fsrs), so P2 skips the migration.
- **Empty state:** the card stays empty ("Nothing due.") apart from "Study anyway".
- **Undated captures** (P1) go to Someday, as the spec's default says.

## Build order

| Phase | Ships | Depends on |
| --- | --- | --- |
| P0 — Decide | Priority score, Now card with why-line and "Something else", event log, signal changes (badge dot, single pulse) | Existing tasks |
| P1 — Start | Silent defaults on capture with `!n` / `~n` tokens, difficulty-as-presentation, firstStep, resume breadcrumb, minimal goals, notification budget | P0 |
| P2 — Learn | CSV import, cloze from notes, Anki .apkg import (FSRS already in) | Independent |
| P3 — Trim | Coach consolidation, habit display change, Coach defaults off | P1 |

Build P0 and live with it for 2 weeks before P1. Each milestone is committed and reviewed before the next starts.

## Priority score

```
priority = 3I + 4U + 2B + 1.5N − 3S
```

Candidates (recomputed on app open, on any item change, and every 15 min while open): every active item (due or overdue) — to-dos, repeats, goal check-ins; one study candidate per bubble with due cards, problems or recall notes ("Study · Bubble name"). Excluded: Planned, Someday, anything during off-hours.

| Term | Range | Definition |
| --- | --- | --- |
| I — importance | 1–4 | The item's rating. A study candidate uses the bubble's study default (3). |
| U — urgency | 0–1 | Dated item: `min(1, hours past overdue ÷ 168)`. Due but not yet overdue = 0. Repeats use the most recent occurrence. Study: `min(1, due count ÷ 100)`. Check-ins: 0. |
| B — goal and exam pace | 0–1 | Max over linked goals of `min(1, behind% ÷ 20)`. On pace, ahead, or no deadline = 0. A study candidate whose bubble has an exam ≤ 14 days away: `min(1, max(0, (0.90 − readiness) ÷ 0.20))`. The larger applies. |
| N — missed repeats | 0–1 | `min(1, missed occurrences ÷ 3)`. Missed = passed with neither Done nor Skip. Skip never counts. Non-repeating = 0. |
| S — recently passed over | 0 or 1 | 1 if this was the top card and you tapped "Something else" in the last 24 h. |

Tie-break, in order: overdue first, earlier due time, has a breadcrumb (P1), item id.

All weights are invented starting values. One importance step (3 points) is worth about 5 days overdue; goal pace (max 2) nudges but cannot beat a full importance step. Difficulty leaves the ranking.

### Test vectors

Expected order, highest first:

| # | Candidate | I | U | B | N | S | Score |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T3 | Study bubble, 50 due, exam in 10 days, readiness 0.75 | 3 | 0.50 | 0.75 | 0 | 0 | 12.50 |
| T1 | Critical to-do, due today, not overdue | 4 | 0 | 0 | 0 | 0 | 12.00 |
| T2 | Medium to-do, 84 h overdue | 2 | 0.50 | 0 | 0 | 0 | 8.00 |
| T4 | Weekly laundry, latest occurrence 24 h overdue, 2 missed | 2 | 0.143 | 0 | 0.667 | 0 | 7.57 |
| T6 | Medium to-do due today, linked goal behind 12% | 2 | 0 | 0.60 | 0 | 0 | 7.20 |
| T5 | T2, passed over 3 h ago | 2 | 0.50 | 0 | 0 | 1 | 5.00 |

## Now card

One card sits at the top of the home screen, above the bubbles, showing the highest-scoring candidate. Anatomy: action text, a why-line, a primary button, a "Something else" link. Nothing else.

Why-line: built from the largest weighted term other than I (4U, 2B, 1.5N). If all are 0, the importance label. Factual tone, no exclamation marks.

| Largest term | Template | Example |
| --- | --- | --- |
| B (exam) | Exam in {d} days · readiness {r}% | Exam in 10 days · readiness 75% |
| B (goal) | Moves "{goal}" · {behind}% behind pace | Moves "B2 Spanish" · 12% behind pace |
| U (dated) | {d} days late | 3 days late |
| U (study) | {n} due | 50 due |
| N | {interval} · last done {date} | Weekly · last done Oct 16 |
| I only | {importance label} | Critical |

| Type | Primary | Secondary |
| --- | --- | --- |
| Study | Start: opens a study session with the last-used length (default 25 min) | — |
| To-do | Start: focus timer on this task | Done |
| Repeat | Start | Done, Skip |
| Goal check-in | Check in: opens the existing input | — |

**Something else:** the first tap shows candidates #2 and #3 inline on the card. Picking one sets S = 1 on the former top. A second tap goes to the Tasks screen.

States: *Nothing active* — "Nothing due." plus "Study anyway" if any bubble has unstarted new cards. *After Done* — the next candidate replaces the card in place; no celebration. (*Off-hours* and *back after 3+ days* wait for the phases that build them.)

Tasks screen: structure stays. Its "Now" section is renamed **Due** and sorted by the new score.

## Signals

| Signal | Before | v5 |
| --- | --- | --- |
| Tasks badge | Count of active items | A dot when there is at least 1 active item. No number. |
| Overdue marker | Red | Secondary-colour text: "3 days late". |
| Bubble pulse | Every bubble with an active item | Only the bubble behind the Now card pulses. Other bubbles with active items get a static thin ring. |
| Notifications | Per active item | P1: budget of up to 3 a day, default 1, showing the current Now card. |

## Event log

IndexedDB store `events`, append-only, kept 180 days, exportable as CSV from Settings. Local to the device: not synced, not in backups.

Record shape: `{ts, type, key, itemId | bubbleId, candidateType, rank, score, terms: {I, U, B, N, S}, meta}`.

| type | When | meta |
| --- | --- | --- |
| card_shown | A new candidate becomes the top card; once per candidate per app open | — |
| alt_shown | Something else reveals #2 and #3 | the ids shown |
| pass | The top card is passed over | the id picked instead |
| start | Any Start | — |
| timer_end | A 2- or 5-minute timer finishes (P1) | {timerMin} |
| session_end | A study session or focus timer ends | {minutes, …} |
| done, skip | Done, or Skip on a repeat | — |
| capture | Item saved (P1) | {tokens, dated} |
| notif_sent, notif_opened | Notifications (P1) | {slot} |

Success metric: starts within 10 min of a `card_shown` for the same candidate ÷ all `card_shown`. Shown weekly in Settings → Stats, not on the home screen.

## P1–P3 (not built yet)

Kept in the source PDF: silent capture defaults and tokens (`!1`–`!4`, `~1`–`~4`, `@bubble`), difficulty-as-presentation (first step / Start 2 minutes), repeated-skip shrinking, resume breadcrumbs, minimal goals, notification budget (P1); CSV, cloze and Anki import (P2); Coach consolidation and the habit display change (P3).

## Numeric defaults

All score weights and saturation points (3 / 4 / 2 / 1.5 / −3; 168 h; 100 due; 20% behind; 14 days; 3 missed) are **invented** — tune against the event log. Sourced: FSRS desired retention 0.90; the 18–254 day habit range (Lally et al. 2009). Adapted: session length 25 min default.

## Acceptance criteria — P0

- The six test vectors produce the stated scores (± 0.01) in the stated order.
- Home shows exactly one card, and Something else reveals exactly two more.
- The Tasks badge never shows a digit.
- At most one bubble pulses at any moment.
- `card_shown`, `pass`, `start` and `done` each write one event.
