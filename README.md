# Loci

Your projects as colored bubbles (**loci**) floating on one screen. Each locus holds elements,
starting with flashcard decks that use spaced repetition. [SPEC.md](SPEC.md) is the v1 plan;
[SPEC-v2.md](SPEC-v2.md) is v2 (more element types, FSRS, study sessions, exams), being built now.

Everything runs in the browser and is saved on the device (IndexedDB). There is no server and no
account. Loci replaces Echomathia; the old app is still in this repository's git history.

## Backup, and moving between devices

Your data lives only on the device you use. On the home screen, tap **⋯** (Settings), then Backup:

- **Export backup** saves one file, `loci-backup-<date>.zip`, with everything in it, attached
  files included.
- **Import…** reads such a file (older `.json` backups work too). **Merge** adds what's new and keeps the newer copy of anything that
  is on both sides; nothing on this device is lost (but something you deleted here comes back if
  the file still has it). **Replace everything** wipes this device and restores the file.

To move from phone to computer: export on the phone, send yourself the file (Drive, email, cable),
import it on the computer with Merge. Export now and then as a backup, too.

## Run it on your computer

1. Open the project folder in File Explorer, click the address bar, type `cmd` and press Enter.
2. The first time only, type `npm install` and press Enter.
3. Type `npm run dev` and press Enter.
4. Open http://localhost:5173 in your browser. Keep the black window open while you use the app.

To try it on your phone on the same Wi-Fi, use `npm run dev -- --host` instead and open the
"Network" address it prints. (Windows may ask to allow Node.js through the firewall: allow it on
private networks.)

## Tests

`npm test` runs the unit tests (Vitest): the scheduler, the due count at the 04:00 day boundary,
the daily limits, the review log, tasks, bulk import, backup export/import/merge, and the
upgrade of a v1 database and v1 backups to FSRS, task ranking and sections, links, attachments,
zip backups, number formats and desired retention. Test files sit next to the code they test
(`*.test.ts`).

## Put it online (static site)

`npm run build` creates a `dist` folder: that folder is the whole website. Any static host works.

- **Netlify Drop**: run `npm run build`, then drag the `dist` folder onto
  https://app.netlify.com/drop. You get a public link right away.
- **GitHub Pages**: push this project to a GitHub repository, then in the repository go to
  Settings → Pages and set Source to "GitHub Actions". The workflow in
  `.github/workflows/deploy.yml` then publishes the site on every push to `main`.

Data stays in each visitor's own browser, so a deployed copy starts empty for everyone.

`npm run preview` serves the built `dist` folder at http://localhost:4173, to try the real app
(including offline) before putting it online.

## Install it as an app

Once it's online (an `https://` address; both hosts above give you one):

- **Android**: open the address in Chrome → menu (⋮) → **Install app** (or "Add to Home screen").
  It opens full screen, with its own icon.
- **Windows**: open it in Chrome or Edge → the install icon at the right of the address bar (or
  menu → **Install Loci**).

After the first visit the app works with no connection: every file is kept on the device. When
you publish a new version, it installs itself the next time the app is opened online.

The app icons come from `public/favicon.svg`. After changing it, run `npm run icons` to remake
them.

## Where things are

- `src/main.ts`: app start, and switching between screens
- `src/router.ts`: the screen addresses (`#/`, `#/locus/…`) and the back button
- `src/transition.ts`: the bubble growing into its locus screen, and back
- `src/locus/view.ts`: the locus screen: element tiles, the + menu, rename and delete
- `src/locus/reorder.ts`: dragging tiles into a new order
- `src/elements/registry.ts`: the element types (a new type is one module registered here)
- `src/elements/flashcards/`: the Flashcards type: its tile (`type.ts`), deck screen (`editor.ts`),
  card storage (`store.ts`), bulk import (`import.ts`), the FSRS scheduler and the one-time
  conversion of v1 cards (`srs.ts`), which cards a
  session shows (`session.ts`) and the review screen (`review.ts`)
- `src/tasks/`: every task across all loci, their ranking (score = 3 × importance − difficulty)
  and sections (`tasks.ts`), and the Tasks screen: Now, Goals and exams, Planned, Someday
  (`view.ts`). Active tasks make bubbles pulse and set the badge on home
- `src/levels.ts`: importance and difficulty (four steps each) and their picker
- `src/store/links.ts`: links between any two items; `src/linkedItems.ts`: the Linked items section
  and the Link to… picker; `src/items.ts`: names, colors and destinations for linked items
- `src/sheet.ts`: bottom sheets, and the delete confirmation
- `src/press.ts`: long-press for list rows
- `src/icons.ts`, `src/time.ts`: small icons, and "in 3h"-style times
- `src/types.ts`: the stored data shapes (tags, loci, elements, cards, review log)
- `src/store/db.ts`: the IndexedDB database (Dexie) and the functions that read and write it
- `src/store/backup.ts`: backup files (.zip with data.json and attached files): export, checking a
  file, and import (merge or replace)
- `src/settings/`: the Settings screen (⋯ on home): number format, storage, backup
- `src/store/attachments.ts`: links and files attached to notes, to-dos and goals (files stored as
  Blobs, photos scaled down); `src/attachmentStrip.ts`: the strip that shows and adds them
- `src/locale.ts`: number format (Auto, 1,234.5 or 1.234,5), formatting and reading numbers,
  first day of the week
- `vite.config.ts`: the build, plus the install manifest and offline caching (`vite-plugin-pwa`)
- `src/home/view.ts`: the home screen
- `src/home/field.ts`: the bubble field: animation loop, drag and tap, where new loci are placed
- `src/home/physics.ts`: how bubbles float, wobble and push each other apart (the feel is tuned
  by the constants at the top)
- `src/home/createLocus.ts`: the sheet for creating, editing and deleting a locus (long-press or
  right-click a bubble to edit)
- `src/home/filter.ts`: the tag filter bar
- `src/colors.ts`: the locus color palette
- `src/dom.ts`: a small helper for building page elements
- `src/style.css`: the look (every color is a variable at the top)
- `ASSETS.md`: where every font and design comes from, and its license
