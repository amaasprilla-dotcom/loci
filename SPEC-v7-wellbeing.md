# Loci v7 — Wellbeing and the Distraction Blocker

## Summary

The Android app's timer and sleep mode (SPEC-v6-android.md) move out of Settings → Phone onto their own **Wellbeing** screen, and a **distraction blocker** joins them: apps you mark as distracting can't be used while a block is on.

Asked for on Nov 3, after the first days of use: the wellbeing parts were hard to manage among the phone settings, and the timer only shows the time, it never stops you. This reverses v6's "Blocking stays out".

## Decisions

- **One list of distracting apps** for the timer and the blocker. What v6 called "social apps" becomes "distracting apps"; it starts as the same list (social apps on by default) and any app can be added. The timer counts time in them; blocks block them. A block can't pick its own apps (out of scope for now), so one list is all there is to manage.
- **Loci, the phone, and the home screen are never blocked**, and can't be added to the list. Loci has to stay open to end a block, see why it's on, or tick off the to-do it waits for.
- **Blocks are rules, and several can be on.** An app is blocked while any of them is. Kinds:
  1. **Block now:** for 15 min, 30 min, 1 h, 2 h, or until a time you pick.
  2. **Hours:** a start and end time on chosen days, e.g. weekdays 09:00–12:00. There can be several.
  3. **Daily limit:** after a set time in distracting apps today (e.g. 1 h), they're blocked until midnight. It counts the timer's total, so it works with the timer off too.
  4. **Bedtime:** from bedtime to wake time, as set in sleep mode, on its nights (and during Sleep now).
  5. **Until a to-do is done:** started from the to-do's sheet. It ends when the to-do is ticked, in Loci or from its notification. A to-do ticked on another device ends it when Loci next opens on the phone.
  6. **During a to-do:** while its focus timer runs (the Focus screen). The phone is told when the session ends, so the block can't outlive it if the page goes.
- **How firm a block is** is one setting:
  - **Gentle:** the blocked screen has **5 more minutes**, up to 3 times a day.
  - **Firm** (the default): no way past the blocked screen. A running block ends early only from Wellbeing, after a 30-second wait with the reason in front of you.
  - **Strict:** a running block can't be ended, edited, or switched off until it's over.

  Android always lets you switch Loci's accessibility service off (and uninstall it). Loci can't stop that; the watchdog notices and says so.
- **The cutoff shows coming.** In the 5 minutes before a block starts (hours, bedtime, or the daily limit running out) the timer pill turns red and counts down: `Instagram · 4:59 left`. It shows only in a distracting app and only while the timer is on. With the timer off there's no pill, so no warning.
- **The blocked screen covers the app**, which can't be used under it. It has the reason and when it ends, and **Close app** (to the home screen). A block that starts while you're in a distracting app covers it at once.
- **Kept on the phone, never synced**, like the rest of the phone settings. Only Until done and During a to-do look at to-dos, and they hold the to-do's id and title.

## What the user sees

### Wellbeing

A screen of its own, only in the Android app. Home shows a **Wellbeing** pill beside Tasks and Notes. Settings → Phone keeps permissions, reminders and Problems, with a line pointing to Wellbeing.

From the top:

- **Today:** time in distracting apps today, large, and under it the block in force ("Blocked until 12:00 · Morning") or the next one ("Next: Bedtime at 23:30").
- **Blocker:** on/off, how firm, Block now, the list of blocks (each with its switch, and tap to edit), Add a block. The ones running now show "Now · until 12:00", with End early unless Strict.
- **Timer:** on/off, pill size.
- **Sleep mode:** as in Settings → Phone today, its status line and Sleep now / I'm up first.
- **Distracting apps:** the list with icons and switches.

Each part is a glass card. Its options fold away while it's off. A part that needs a permission it doesn't have shows that line in its card, not in a list elsewhere.

### The blocked screen

A full-screen card over the app, in Loci's look: the app's icon and name, "is blocked", the reason ("Until 12:00 · Morning", "Until you finish Gather receipts", "Daily limit: 1 h today"), and **Close app**. Gentle adds **5 more minutes (2 left today)**.

### To-dos

The to-do sheet gets **Block distractions until done**. The Focus screen gets a switch, **Block distractions**, remembered between sessions. Both show only in the app with the blocker on.

## How it works

- `Blocker.kt`, driven by `WatchService` alongside the timer and sleep mode. It's asked whether an app is blocked, and when the next block starts or ends, and computes this from the rules each time (no alarms), as sleep mode does. The service rechecks on every app change, on the screen turning on, and once a second while a distracting app is in front (the timer's tick).
- **Hearing which app is open** got firmer in 1.5. Android sometimes reports the home screen after the app it opened. So while the home screen seems to be in front, an app changing on screen counts as opened too. It's still only the app's name, never what it shows. The blocker depends on this more than the timer did, so it's the first thing to check on the phone.
- The blocked screen is a touchable `TYPE_ACCESSIBILITY_OVERLAY`. Close app is `performGlobalAction(GLOBAL_ACTION_HOME)`.
- The rules sit in the phone prefs (`blocker` beside `timer` and `sleep`). The one-off state (Block now's end, Gentle's extra minutes, Until done's to-do, the focus session's end) sits in the native "blocker" prefs. Bridge messages `blockerState`, `blockNow`, `endBlock`, `blockUntilDone`, `focusBlock`.
- The web side ends Until done when the to-do is completed. On every open it also checks the to-do is still there and not done (sync may have brought the tick).

## Milestones

Each is committed and reviewed before the next starts.

| # | Ships |
| --- | --- |
| **W0 — Spec** | This file. Also, before it: the to-do's Why renamed Details, and the timer noticing an opened app more reliably (app 1.5). |
| **W1 — Wellbeing screen** | The screen and its home pill, the timer and sleep mode moved onto it, distracting apps as the shared list, Today. No blocker yet. |
| **W2 — Blocker** | Blocks by hours, daily limit, bedtime and Block now; the blocked screen; Gentle/Firm/Strict; the red countdown on the pill. App 1.6. |
| **W3 — To-do blocks** | Until done (the to-do sheet) and During a to-do (the Focus screen). |

## Out of scope

- Apps chosen per block. There's one list.
- Blocking websites in a browser. Loci only hears the app's name, not the page.
- Stopping the accessibility service from being switched off.
- History of time in apps beyond today, and charts.
