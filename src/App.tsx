import { useEffect, useState } from "react";
import { useAppData } from "./useAppData";
import { useCalmMode } from "./motion";
import { setSoundOn } from "./sound";
import { HomeScreen } from "./screens/HomeScreen";
import { DeckScreen } from "./screens/DeckScreen";
import { StudyScreen } from "./screens/StudyScreen";
import { SettingsScreen } from "./screens/SettingsScreen";

// Which screen is showing. A plain state variable is enough; no router needed.
type Screen =
  | { name: "home" }
  | { name: "settings" }
  | { name: "deck"; deckId: string }
  | { name: "study"; deckIds: string[]; practice: boolean; returnTo: Screen };

const NAV_ITEMS: { screen: Screen; label: string }[] = [
  { screen: { name: "home" }, label: "Decks" },
  { screen: { name: "settings" }, label: "Settings" },
];

export default function App() {
  const app = useAppData();
  const [screen, setScreen] = useState<Screen>({ name: "home" });
  const settings = app.data.profile.settings;

  useCalmMode(settings.calmMode);
  useEffect(() => setSoundOn(settings.sound), [settings.sound]);

  const goHome = () => setScreen({ name: "home" });
  const startStudy = (deckIds: string[], practice = false) =>
    setScreen({ name: "study", deckIds, practice, returnTo: screen });

  return (
    <>
      {/* The study screen hides the top bar so you can focus on the card. */}
      {screen.name !== "study" && (
        <header className="topbar">
          <nav>
            <span className="brand">Study App</span>
            {NAV_ITEMS.map((item) => (
              <button
                key={item.label}
                className={screen.name === item.screen.name ? "active" : ""}
                onClick={() => setScreen(item.screen)}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </header>
      )}

      <main className="app">
        {app.saveFailed && (
          <p className="notice warning">
            Your latest changes could not be saved: this browser's storage may be full. Go to
            Settings and Export a backup now.
          </p>
        )}
        {screen.name === "home" && (
          <HomeScreen
            app={app}
            onOpenDeck={(deckId) => setScreen({ name: "deck", deckId })}
            onStudy={startStudy}
          />
        )}
        {screen.name === "settings" && <SettingsScreen app={app} />}
        {screen.name === "deck" && (
          <DeckScreen app={app} deckId={screen.deckId} onBack={goHome} onStudy={startStudy} />
        )}
        {screen.name === "study" && (
          <StudyScreen
            app={app}
            deckIds={screen.deckIds}
            practice={screen.practice}
            onExit={() => setScreen(screen.returnTo)}
          />
        )}
      </main>
    </>
  );
}
