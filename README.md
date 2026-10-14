# Study App

The flashcard app where cards can be problems. See [SPEC.md](SPEC.md) for the plan.

Everything runs in the browser and is saved in `localStorage`. Use Settings → Export now and
then to keep a backup file.

## Run it on your computer

1. Open the project folder in File Explorer, click the address bar, type `cmd` and press Enter.
2. The first time only, type `npm install` and press Enter.
3. Type `npm run dev` and press Enter.
4. Open http://localhost:5173 in your browser. Keep the black window open while you use the app.

To try it on your phone on the same Wi-Fi, use `npm run dev -- --host` instead and open the
"Network" address it prints.

## Put it online (static site)

`npm run build` creates a `dist` folder: that folder is the whole website. Any static host works.
Two easy options:

- **Netlify Drop** (no account setup beyond signing in): run `npm run build`, then drag the
  `dist` folder onto https://app.netlify.com/drop. You get a public link right away.
- **GitHub Pages**: push this project to a GitHub repository, then in the repository go to
  Settings → Pages and set Source to "GitHub Actions". The workflow in
  `.github/workflows/deploy.yml` then publishes the site on every push to `main`.

Data stays in each visitor's own browser, so a deployed copy starts empty for everyone.

## Where things are

- `src/types.ts`: the data shapes (decks, flashcards, formula and table problems)
- `src/storage.ts`: saving to `localStorage`, backup export/import
- `src/scheduler.ts`: spaced-repetition scheduling (wraps `ts-fsrs`)
- `src/formula.ts`: making and checking formula problems (uses `mathjs`)
- `src/table.ts`: making and checking table problems
- `src/streak.ts`: the day streak
- `src/useAppData.ts`: all app data plus the actions that change it
- `src/packs/`: built-in packs as JSON files (add a pack by adding a file and listing it in `index.ts`)
- `src/screens/`: one file per screen (Home, Deck, Study, Packs, Settings)
- `src/components/`: pieces shared between screens (math text, rating buttons, card reviews)
