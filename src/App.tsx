import { useState } from "react";
import { useAppData } from "./useAppData";
import { HomeScreen } from "./screens/HomeScreen";
import { DeckScreen } from "./screens/DeckScreen";
import { StudyScreen } from "./screens/StudyScreen";
import { PacksScreen } from "./screens/PacksScreen";
import { SettingsScreen } from "./screens/SettingsScreen";

// Which screen is showing. A plain state variable is enough; no router needed.
type Screen =
  | { name: "home" }
  | { name: "packs" }
  | { name: "settings" }
  | { name: "deck"; deckId: string }
  | { name: "study"; deckIds: string[]; returnTo: Screen };

const NAV_ITEMS: { screen: Screen; label: string }[] = [
  { screen: { name: "home" }, label: "Home" },
  { screen: { name: "packs" }, label: "Packs" },
  { screen: { name: "settings" }, label: "Settings" },
];

export default function App() {
  const app = useAppData();
  const [screen, setScreen] = useState<Screen>({ name: "home" });

  const goHome = () => setScreen({ name: "home" });
  const startStudy = (deckIds: string[]) =>
    setScreen({ name: "study", deckIds, returnTo: screen });

  return (
    <>
      {/* The study screen hides the top bar so you can focus on the card. */}
      {screen.name !== "study" && (
        <header className="topbar">
          <nav>
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
        {screen.name === "home" && (
          <HomeScreen
            app={app}
            onOpenDeck={(deckId) => setScreen({ name: "deck", deckId })}
            onStudy={startStudy}
          />
        )}
        {screen.name === "packs" && <PacksScreen app={app} />}
        {screen.name === "settings" && <SettingsScreen app={app} />}
        {screen.name === "deck" && (
          <DeckScreen app={app} deckId={screen.deckId} onBack={goHome} onStudy={startStudy} />
        )}
        {screen.name === "study" && (
          <StudyScreen
            app={app}
            deckIds={screen.deckIds}
            onExit={() => setScreen(screen.returnTo)}
          />
        )}
      </main>
    </>
  );
}
