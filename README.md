# Loci

Your projects as colored bubbles (**loci**) floating on one screen. Each locus holds elements,
starting with flashcard decks that use spaced repetition. See [SPEC.md](SPEC.md) for the plan
and the build order.

Everything runs in the browser and is saved on the device (IndexedDB). There is no server and no
account. Loci replaces Echomathia; the old app is still in this repository's git history.

## Run it on your computer

1. Open the project folder in File Explorer, click the address bar, type `cmd` and press Enter.
2. The first time only, type `npm install` and press Enter.
3. Type `npm run dev` and press Enter.
4. Open http://localhost:5173 in your browser. Keep the black window open while you use the app.

To try it on your phone on the same Wi-Fi, use `npm run dev -- --host` instead and open the
"Network" address it prints. (Windows may ask to allow Node.js through the firewall: allow it on
private networks.)

## Put it online (static site)

`npm run build` creates a `dist` folder: that folder is the whole website. Any static host works.

- **Netlify Drop**: run `npm run build`, then drag the `dist` folder onto
  https://app.netlify.com/drop. You get a public link right away.
- **GitHub Pages**: push this project to a GitHub repository, then in the repository go to
  Settings → Pages and set Source to "GitHub Actions". The workflow in
  `.github/workflows/deploy.yml` then publishes the site on every push to `main`.

Data stays in each visitor's own browser, so a deployed copy starts empty for everyone.

## Where things are

- `src/main.ts`: app start
- `src/types.ts`: the stored data shapes (tags, loci, elements, cards, review log)
- `src/store/db.ts`: the IndexedDB database (Dexie) and the functions that read and write it
- `src/home/view.ts`: the home screen
- `src/home/field.ts`: the bubble field, and where new loci are placed
- `src/home/createLocus.ts`: the "New locus" sheet
- `src/colors.ts`: the locus color palette
- `src/dom.ts`: a small helper for building page elements
- `src/style.css`: the look (every color is a variable at the top)
- `ASSETS.md`: where every font and design comes from, and its license
