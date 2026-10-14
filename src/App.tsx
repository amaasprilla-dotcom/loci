import { useState } from "react";
import { useAppData } from "./useAppData";
import { HomeScreen } from "./screens/HomeScreen";
import { DeckScreen } from "./screens/DeckScreen";
import { StudyScreen } from "./screens/StudyScreen";

// Which screen is showing. A plain state variable is enough; no router needed.
type Screen =
  | { name: "home" }
  | { name: "deck"; deckId: string }
  | { name: "study"; deckIds: string[]; returnTo: Screen };

export default function App() {
  const app = useAppData();
  const [screen, setScreen] = useState<Screen>({ name: "home" });

  const goHome = () => setScreen({ name: "home" });
  const startStudy = (deckIds: string[]) =>
    setScreen({ name: "study", deckIds, returnTo: screen });

  return (
    <main className="app">
      {screen.name === "home" && (
        <HomeScreen
          app={app}
          onOpenDeck={(deckId) => setScreen({ name: "deck", deckId })}
          onStudy={startStudy}
        />
      )}
      {screen.name === "deck" && (
        <DeckScreen app={app} deckId={screen.deckId} onBack={goHome} onStudy={startStudy} />
      )}
      {screen.name === "study" && (
        <StudyScreen app={app} deckIds={screen.deckIds} onExit={() => setScreen(screen.returnTo)} />
      )}
    </main>
  );
}
