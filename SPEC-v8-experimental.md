# Loci v8 — Tag threads and Experimental Mode

## Summary

Two additions, asked for on Nov 6:

1. **Tag threads.** Loci that share a tag are joined by a faint line and move together.
2. **Experimental Mode.** A switch when making a locus. An experimental locus is a different kind of place: no tiles, decks, study or exams. It holds **weekly targets** (ranges), **work blocks** (timed, reminded, optionally distraction-free) and a **weekly review**, with a rule for when the targets may change.

The aim is a system for a plan of several months ("count the week, pick next week's topic, change one thing only if something clearly failed") that makes keeping to it as effortless as possible. Loci isn't built around that one plan, though: the pieces are general, and the plan is set up with them. In a normal locus the same thing meant wiring to-dos, goals and check-ins together by hand.

## Tag threads

- **Lines.** Each tag joins its loci with the fewest, shortest lines: a tree, not every pair. A pair of loci sharing several tags gets one line. Lines run center to center under the bubbles, in the ink color at 9%.
- **Selecting a tag** in the filter brings its lines up to 20% and takes other tags' lines down to 4%. That's a little more noticeable, not much more.
- **Dragging moves the group.** With no tag selected, dragging a locus moves every locus sharing a tag with it, keeping their distances. A throw carries them all, and each is saved where it comes to rest.
- **With a tag selected, a locus moves on its own.** Otherwise loci in a group could never be arranged among themselves. This is my own call; the request didn't cover it.
- Which loci the lines join is worked out when the home screen is drawn and after each drop, not every frame, so lines don't swap partners while bubbles drift.

## Experimental Mode

### Making one
The New locus sheet has an **Experimental mode** switch. It's chosen when the locus is made and can't be switched later, since the two kinds hold different things. Editing an experimental locus hides the study settings. On home, its bubble has a quiet dashed ring inside.

### Weekly targets
- Each target is a **range**: a **minimum**, which counts as a full win, and a **good week**.
- Targets are counted **Monday to Sunday**, on Loci's day (04:00 to 04:00), so 1 a.m. on Sunday night still counts for Sunday. Monday starts again with the same targets.
- **A count** is the +1s by hand, plus the finished sessions of any blocks the target counts from. Tapping the number takes one off.
- **Showing a target:**
  - a bar with the range marked from minimum to good week;
  - **Win** or **Good week**;
  - eight weeks of dots: filled for a win, ringed for a good week.
- **Each week remembers the numbers it was held to**, so changing a target doesn't rewrite past weeks.

### When the targets can change
The rule is set with the targets (Targets and rules, the header button). It covers the targets and the rules themselves, so loosening the rules goes through it too.
- **After a wait** (the default, 24 h; also 12 h or 3 days):
  - Outside review day, a change opens with "Did something clearly fail, or is this just a hard week?" and your review steps.
  - **Why change it now?** must be filled in.
  - The change is held. When the wait is over, it shows your reason again with **Apply** or **Drop it**.
  - While a change is held, no second one can be asked for.
- **Review day only:** on other days the button says when changes open.
- **Any time.**

Whatever the rule, changes apply at once on review day, and during first setup (no targets yet).

### Weekly review
- On the review day (default Sunday), a **Weekly review** card shows:
  - this week's tally;
  - your review steps, in your own words, as a checklist;
  - **Change targets…** and **Review done**.
- In the Android app, a reminder comes at the review time (default 18:00).
- The review is also a Now card and Tasks item until done. So is a change ready to confirm, and, in the last two days of the week, any target still under its minimum.

### Work blocks
- A block is a repeating to-do with a **work block**. It reads as an if-then plan: "When **I finish lunch**, I will **open this week's video where I left it**".
- A block has:
  - a reminder time and days;
  - a length;
  - in the Android app, **Block all distractions**;
  - the targets it counts toward.
- Because a block is a to-do, its reminder, Done on the notification, the Now card and Tasks all work as for any to-do. Its row shows **Start**, or **Done today**.
- **Any to-do can have a work block now**, not just in experimental loci: the to-do sheet has a Work block row (None, 25, 45, 60, 90, 120 min).
- **The focus timer** runs for the block's length and shows the if-then line and first step.
  - With **Block all distractions**, it waits on a **Start**, so opening it by mistake doesn't lock the phone. Start blocks distracting apps until the block's end, using the blocker's Block now.
  - If the blocker was off, switching that option on turns it on, with no blocks of its own.
  - **Done** ends the block early, except in Strict.
  - **Stop here** ends it only in Gentle: in Firm the way out stays Wellbeing's End early, as for any block.
- **A block's notification opens its timer directly**, so the phone goes straight into the block.

## How it works

- `Locus.mode = 'experimental'`.
- Every experimental locus holds two elements, made with it (and again if missing):
  - a hidden **`weekly`** element, whose data holds the targets, the hand counts by week, each week's numbers, the rules, the weeks reviewed, and any held change;
  - a **Blocks** to-do list.
- Nothing new is stored elsewhere: sync, backup and the server needed no change.
- `Todo.block = { minutes, noDistractions }`.
- No new app: blocking uses Block now and End early, which app 1.6 already has. A manual Block now running at the same time is ended by a block's Done too, since they're the same block on the phone.
- Code:
  - `src/home/threads.ts`: lines and groups;
  - `src/elements/weekly/`: model, storage, element type, sheet;
  - `src/locus/experiment.ts`: the screen;
  - `src/elements/todos/block.ts` and `blockField.ts`;
  - `src/now/focus.ts`.

## Out of scope

- Turning an existing locus experimental, or back.
- Blocks starting the blocker on their own at their time. A block starts when you tap Start, because "after lunch" isn't a fixed time.
- Holding changes to blocks behind the change rule. Only targets and rules are held.
