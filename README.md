# Study App

The flashcard app where cards can be problems. See [SPEC.md](SPEC.md) for the plan.

## Run it

```bash
npm install
npm run dev
```

Then open the address it prints (usually http://localhost:5173).
To try it on your phone on the same Wi-Fi, run `npm run dev -- --host` and open the "Network" address.

## Where things are

- `src/types.ts`: the data shapes (decks, cards)
- `src/scheduler.ts`: spaced-repetition scheduling (wraps `ts-fsrs`)
- `src/storage.ts`: saving and loading from `localStorage`
- `src/useAppData.ts`: all app data plus the actions that change it
- `src/screens/`: one file per screen (Home, Deck, Study)
