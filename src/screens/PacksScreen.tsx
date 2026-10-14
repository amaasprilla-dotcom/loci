import { PackList } from "../components/PackList";
import type { AppActions } from "../useAppData";

export function PacksScreen({ app }: { app: AppActions }) {
  return (
    <div className="screen">
      <h1>Packs</h1>
      <p className="muted">
        Ready-made decks. Adding one creates a new deck you can study right away.
      </p>
      <PackList app={app} />
    </div>
  );
}
