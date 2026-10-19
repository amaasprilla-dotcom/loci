# Loci — Technical Spec

Oct 19, 2026 · @ANDREW

## Summary

Loci is an offline-first study and project app. The home screen shows each project as a colored bubble (a **locus**) floating in a liquid-like field. Tapping a bubble opens its contents: **elements** such as a flashcard deck. Any element with work due makes its bubble pulse, and a Tasks screen lists everything due across all loci.

Version 1 ships one element type, **Flashcards** with spaced repetition. Everything runs locally: no backend, no AI, no paid APIs, no third-party services.

**Targets:** Android phone and Windows PC, from one codebase.

## Platform and stack

Build it as a **web app, installable as a PWA**. One codebase runs in the browser on Windows and installs to the Android home screen, full-screen and offline. Native wrappers come later only if needed, and reuse the same code.

| Layer | Choice | Notes |
| --- | --- | --- |
| Language | TypeScript | Plain JS is acceptable; TS pays off once element types multiply |
| Build / dev server | Vite | `npm run dev -- --host` to test on the phone over local Wi-Fi |
| UI | Vanilla TS or Svelte | Framework optional. Bubble field is a hand-written render loop either way |
| Rendering of bubbles | DOM elements + CSS transforms | Easy hit-testing, CSS effects. Switch to `<canvas>` only past \~200 bubbles |
| Storage | IndexedDB via Dexie | `localStorage` is fine for the first prototype |
| Spaced repetition | SM-2 (own code), later `ts-fsrs` | Both free; `ts-fsrs` is MIT |
| Offline / install | `vite-plugin-pwa` | Generates manifest + service worker |
| Android APK (later) | Capacitor | Needed only for reliable background notifications |
| Windows .exe (later) | Tauri | Optional; the installed PWA already works on Windows |
| Hosting | GitHub Pages, Netlify or Cloudflare Pages | Free static hosting; HTTPS is required for PWA install |

**Known limitation:** a PWA cannot reliably notify "cards due" while the app is closed on Android. Version 1 shows due state when the app is opened. Background notifications are the trigger for adding the Capacitor build with `@capacitor/local-notifications`.

## Architecture

Elements are **plug-in types** behind one interface, registered in a central registry. The home screen, the bubble pulse and the Tasks screen never know about flashcards specifically. They only call `getTasks()`. Adding a new element type later (to-do list, timer, reading list) means writing one module and registering it.

&#91;embedded content: app architecture · screens, registry, element types, storage\]

Dashed boxes are future element types; they plug in at the registry without touching the screens.

```ts
interface ElementType<TData = unknown> {
  type: string;                       // "flashcards"
  label: string;                      // shown in the "+" menu
  icon: string;
  createDefault(): TData;             // data for a new instance
  renderCard(el: Element<TData>): HTMLElement;   // tile inside the locus view
  open(el: Element<TData>): void;     // full screen for this element
  getTasks(el: Element<TData>, now: number): Promise<Task[]>;
}

interface Task {
  locusId: string;
  elementId: string;
  label: string;        // "12 cards due"
  count?: number;
  dueAt: number;        // for sorting on the Tasks screen
  action(): void;       // e.g. start the review session
}

const registry = new Map<string, ElementType>();
registry.set("flashcards", flashcardsType);
```

**Derived state, never stored:** whether a locus is active, and the Tasks list, are computed from `getTasks()`. Recompute on app start, on return to the home screen, after any review, and on a 60-second timer while the app is open (cards become due as time passes).

**Suggested source layout:**

```
src/
  main.ts              app boot, router
  store/db.ts          Dexie schema, export/import
  home/field.ts        bubble physics + render loop
  home/filter.ts       tag chips
  home/createLocus.ts  create/edit locus sheet
  locus/view.ts        locus screen, "+" menu
  tasks/view.ts        Tasks screen
  elements/registry.ts
  elements/flashcards/ type.ts, editor.ts, review.ts, srs.ts
```

## Data model

Five stored tables. IDs are `crypto.randomUUID()`. Timestamps are epoch milliseconds.

```ts
interface Tag     { id: string; name: string }              // name unique, case-insensitive

interface Locus {
  id: string;
  name: string;
  color: string;        // hex, from a fixed palette + custom picker
  tagIds: string[];
  x: number; y: number; // home position, normalized 0..1 of the field
  radius: number;       // default 48px; optional later: scale with content
  createdAt: number;
}

interface Element<TData = unknown> {
  id: string;
  locusId: string;
  type: string;         // key into the registry
  title: string;        // "Spanish verbs"
  order: number;        // position inside the locus view
  data: TData;          // type-specific settings
}

interface Card {
  id: string;
  elementId: string;    // the flashcard deck
  front: string;
  back: string;
  due: number;          // next review time
  interval: number;     // days
  ease: number;         // SM-2 ease factor, starts 2.5
  reps: number;         // consecutive successful reviews
  lapses: number;
  createdAt: number;
}

interface ReviewLog { id: string; cardId: string; at: number; grade: 0|1|2|3; prevInterval: number }
```

**Dexie schema (indexes):**

```ts
db.version(1).stores({
  tags:     "id, &name",
  loci:     "id",
  elements: "id, locusId",
  cards:    "id, elementId, [elementId+due]",
  reviews:  "id, cardId, at",
});
```

The `[elementId+due]` compound index makes "count due cards in this deck" a single cheap query. `ReviewLog` is optional for v1 but cheap to add now, and it is what a future switch to FSRS or a stats screen will need.

Deleting a locus cascades to its elements and their cards; ask for confirmation in-app.

## Home screen

A full-screen field of bubbles, a tag chip bar at the top, a **+** button to create a locus, and an entry to the Tasks screen with a badge showing the total task count.

### Bubble physics

No physics engine needed. Each bubble runs a damped spring toward its home point, plus a small random drift, plus circle-circle separation. This reads as "balls in liquid seen from above". Run it in one `requestAnimationFrame` loop and write `transform` on each bubble's div.

```ts
type Body = { id: string; x: number; y: number; vx: number; vy: number;
              hx: number; hy: number; r: number; phase: number; held: boolean };

const K = 0.015, DAMP = 0.90, DRIFT = 0.04;

function step(bodies: Body[], t: number) {
  for (const b of bodies) {
    if (b.held) continue;
    b.vx += (b.hx - b.x) * K + (Math.random() - 0.5) * DRIFT;
    b.vy += (b.hy - b.y) * K + (Math.random() - 0.5) * DRIFT;
    b.vx *= DAMP; b.vy *= DAMP;
    b.x += b.vx;  b.y += b.vy;
  }
  for (let i = 0; i < bodies.length; i++)          // separation
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i], c = bodies[j];
      const dx = c.x - a.x, dy = c.y - a.y, d = Math.hypot(dx, dy) || 0.01;
      const overlap = a.r + c.r + 6 - d;             // 6px breathing gap
      if (overlap > 0) {
        const nx = dx / d, ny = dy / d, push = overlap / 2;
        if (!a.held) { a.x -= nx * push; a.y -= ny * push; }
        if (!c.held) { c.x += nx * push; c.y += ny * push; }
      }
    }
  for (const b of bodies) {                          // wobble = gentle squash
    const s = 0.03 * Math.sin(t / 600 + b.phase);
    el(b.id).style.transform =
      `translate(${b.x - b.r}px, ${b.y - b.r}px) scale(${1 + s}, ${1 - s})`;
  }
}
```

- Constants are starting values; tune by feel. Give each bubble a random `phase` so they don't wobble in sync.
- Keep bubbles inside the field: clamp `x/y` to `[r, width - r]` / `[r, height - r]`.
- Pause the loop when the tab is hidden (`document.visibilityState`) to save battery.
- Honor `prefers-reduced-motion`: drop drift and wobble, keep separation.
- O(n²) separation is fine below \~200 bubbles.

### Drag vs tap

Use Pointer Events (`pointerdown / pointermove / pointerup` + `setPointerCapture`) so mouse and touch share one code path.

- On `pointerdown`: record start point, set `held = true`.
- On `pointermove`: if moved more than **8px** from start, it is a drag. Bubble follows the pointer; others get pushed by the separation step.
- On `pointerup`: if it was a drag, set home `hx/hy` to the drop point and persist `x/y` (normalized 0..1) to the locus. If it was not a drag, it is a **tap** → open the locus.
- Set `touch-action: none` on the field so the browser doesn't scroll while dragging.

On first load or for new loci with no saved position, place them on a loose spiral from the center.

### Active pulse (shockwave)

A bubble whose locus has ≥ 1 task gets class `active`. A pseudo-element copies the circle, grows and fades out, on loop:

```css
.bubble { position: absolute; border-radius: 50%; background: var(--c); }
.bubble.active::after {
  content: ""; position: absolute; inset: 0; border-radius: 50%;
  background: var(--c); opacity: .55; pointer-events: none;
  animation: wave 2.2s ease-out infinite;
}
@keyframes wave { from { transform: scale(1); opacity: .55 } to { transform: scale(1.9); opacity: 0 } }
```

Set each bubble's color as `--c`. For a stronger effect use two pseudo-elements (`::before`, `::after`) with staggered `animation-delay`.

### Tag filter

- Chip bar lists all tags. Tapping one selects it; tapping again clears it. (Single-select in v1; multi-select with AND/OR is a later option.)
- Bubbles whose locus does not carry the selected tag get class `dimmed`: `filter: grayscale(1); opacity: .3;`. They stay in place and keep their physics.
- Selected filter is remembered in `localStorage`.

### Create / edit locus

A bottom sheet with:

- **Name** (required)
- **Color**: 10–12 preset swatches + custom color input
- **Tags**: existing tags shown as tappable chips (toggle on/off), plus a text field that creates a new tag on Enter. Match existing tags case-insensitively so "Math" and "math" don't both exist.

Long-press a bubble (≥ 500ms without moving) to edit or delete it.

## Locus view and navigation

**Routes** (hash-based, so the Android back button and browser back work for free):

| Route | Screen |
| --- | --- |
| `#/` | Home (bubble field) |
| `#/locus/:id` | Locus view |
| `#/locus/:id/el/:elementId` | Element screen (deck editor) |
| `#/review/:elementId` | Review session |
| `#/tasks` | Tasks screen |

**Locus view layout:** header tinted in the locus color with name, tags and a back button. Below it, a grid of element tiles, each from `renderCard()`. A floating **+** button opens a menu listing every registered element type (v1: only Flashcards). Choosing one creates the element and asks for its title.

**Flashcard tile shows:** title, total cards, cards due now (highlighted if > 0), next due time when nothing is due ("next in 3h"). Tile tap → deck screen. A **Study** button on the tile goes straight to review when cards are due.

**Transition:** on tap, animate the bubble from its position to fill the screen (scale up with `transform`, using its color), then fade the locus view in on top. Reverse on back. Skip under `prefers-reduced-motion`.

Tiles can be reordered by drag (writes `order`). Long-press a tile to rename or delete it.

## Flashcards element

### Deck screen

- List of cards (front, back preview, next due). Search box once a deck passes \~50 cards.
- **Add card**: front + back text fields, "Save & add another" keeps the sheet open.
- Tap a card to edit; swipe or long-press to delete.
- **Bulk import**: paste lines `front<TAB>back` (Anki's plain-text export format), one card per line.
- Deck settings in `Element.data`: `newPerDay` (default 20), `maxReviewsPerDay` (default 200).

### Review session

1. Build the queue: cards with `due <= now`, oldest first, capped by `maxReviewsPerDay`, plus up to `newPerDay` never-reviewed cards (`reps === 0 && lapses === 0`) not yet introduced today.
2. Show the front. **Show answer** reveals the back.
3. Four grade buttons: **Again / Hard / Good / Easy**. Each button shows the interval it will produce ("10m", "3d", "6d", "8d"), computed by running the scheduler on a copy of the card.
4. On grade: update the card, write a `ReviewLog`, save. A card graded Again goes back into the session queue and is re-shown once its 10-minute step is up (or at the end if the queue runs out).
5. End screen: cards reviewed, time spent, next due time for the deck.

Keyboard shortcuts on desktop: Space = show answer, 1–4 = grade.

### Scheduling algorithm (SM-2, Anki-style grades)

This is the whole scheduler. It is deterministic math with no external service.

```ts
const MIN = 60_000, DAY = 86_400_000;
type Grade = 0 | 1 | 2 | 3;              // Again, Hard, Good, Easy

export function schedule(card: Card, grade: Grade, now = Date.now()): Card {
  const c = { ...card };
  if (grade === 0) {                          // forgot
    c.lapses += 1;
    c.reps = 0;
    c.interval = 0;
    c.ease = Math.max(1.3, c.ease - 0.2);
    c.due = now + 10 * MIN;
    return c;
  }
  c.reps += 1;
  if (c.reps === 1)      c.interval = grade === 3 ? 4 : 1;
  else if (c.reps === 2) c.interval = grade === 1 ? 3 : grade === 3 ? 8 : 6;
  else {
    const mult = grade === 1 ? 1.2 : grade === 3 ? c.ease * 1.3 : c.ease;
    c.interval = Math.max(c.interval + 1, Math.round(c.interval * mult));
  }
  c.ease = Math.max(1.3, c.ease + [0, -0.15, 0, 0.15][grade]);
  c.interval = Math.round(c.interval * (0.95 + Math.random() * 0.1)) || 1; // ±5% fuzz
  c.due = startOfDay(now) + c.interval * DAY + 4 * 60 * MIN;  // due at 04:00 local
  return c;
}
```

**New card defaults:** `ease 2.5, interval 0, reps 0, lapses 0, due = now`.

**Why due at 04:00:** same as Anki's day rollover, so cards don't become due mid-evening and a late-night session counts toward "today".

**Upgrade path:** FSRS (the algorithm modern Anki uses) schedules more accurately. The `ts-fsrs` package (MIT) can replace `schedule()` without UI changes; it needs `stability` and `difficulty` fields on `Card`, and benefits from the `ReviewLog` history kept from day one.

### getTasks for flashcards

```ts
async getTasks(el, now) {
  const due = await db.cards
    .where("[elementId+due]").between([el.id, 0], [el.id, now], true, true).count();
  return due > 0
    ? [{ locusId: el.locusId, elementId: el.id, label: `${due} cards due`,
         count: due, dueAt: now, action: () => go(`#/review/${el.id}`) }]
    : [];
}
```

Decide with the product owner whether unseen new cards alone should make a bubble pulse. Recommended: no, only due reviews and relearning cards trigger it.

## Tasks screen

One list of every task from every element in every locus, built by calling `getTasks()` across the registry.

```ts
async function allTasks(now = Date.now()): Promise<Task[]> {
  const elements = await db.elements.toArray();
  const lists = await Promise.all(
    elements.map(el => registry.get(el.type)!.getTasks(el, now)));
  return lists.flat().sort((a, b) => a.dueAt - b.dueAt);
}
```

- Group rows by locus: a small dot in the locus color, the locus name, then each task ("Spanish verbs · 12 cards due").
- Tapping a task runs its `action()` (starts the review directly).
- The tag filter from the home screen applies here too, if one is selected.
- Empty state: "Nothing due. Next: Spanish verbs in 3h."
- The same `allTasks()` result drives the home-screen badge count and the set of `active` bubbles, so compute it once per refresh and share it.

## Persistence, backup and install

**Local only.** All data lives in IndexedDB on each device. Call `navigator.storage.persist()` on first run so the browser doesn't evict it under storage pressure.

**Export / Import (required in v1).** There is no server, so this is both the backup and the way to move data between phone and PC.

- Export: one JSON file `{ version, exportedAt, tags, loci, elements, cards, reviews }`.
- Import: validate `version`, then either replace all data or merge by `id` (newer `updatedAt` wins). Show a confirmation step in-app before replacing.
- Add an `updatedAt` field to every record now; merging needs it.

**Sync (out of scope for v1).** Automatic phone↔PC sync needs a server. Free options later: a self-hosted PocketBase instance, or syncing the export file through a folder the user already syncs (Google Drive, Syncthing).

**PWA install.**

- `vite-plugin-pwa` with `registerType: "autoUpdate"` generates the manifest and service worker.
- Manifest: name "Loci", `display: "standalone"`, theme color, 192px and 512px icons (plus a maskable icon for Android).
- Deploy the `dist/` folder to GitHub Pages, Netlify or Cloudflare Pages (all free, HTTPS by default).
- Android: open the URL in Chrome → menu → **Install app**. Windows: Chrome or Edge → install icon in the address bar.

## Build order

Each milestone is usable and testable on its own. Do them in order; 2 and 6 carry most of the risk.

| # | Milestone | Done when |
| --- | --- | --- |
| 1 | Project setup + storage | Vite + TS app runs on PC and on the phone over Wi-Fi; Dexie schema in place; loci can be created and survive a reload |
| 2 | Bubble field | Bubbles drift, wobble and separate; drag moves them and positions persist; tap vs drag is reliable on touch |
| 3 | Navigation | Tap opens locus view with the grow transition; back (button and Android back) returns home |
| 4 | Tags + filter | Create locus with existing-tag chips and new tags; selecting a tag greys out non-matching bubbles |
| 5 | Element registry + Flashcards deck | **+** in locus view adds a Flashcards element; cards can be added, edited, deleted, bulk-imported |
| 6 | Review + scheduler | Full review session with four grades; `schedule()` unit-tested against fixed inputs; review log written |
| 7 | Tasks | Due decks make their bubble pulse; Tasks screen lists all due work; badge count correct; refresh every 60s |
| 8 | Backup + PWA | Export/import round-trips all data; app installs on Android and Windows and works offline |

**Unit tests (Vitest)** for: `schedule()` (each grade from new, from review, after lapse; ease floor at 1.3), due-count query at the 04:00 boundary, import/merge.
