import { useEffect, useRef } from "react";
import { sounds } from "../sound";

type Props = {
  packName: string;
  onDone: () => void;
};

const FAN = [-2, -1, 0, 1, 2]; // five cards, from left to right
const DURATION_MS = 2100;

// The moment a pack is added: the pack's flap lifts off and its cards fan out.
// Tap anywhere to skip. (The timing lives in decks.css.)
export function PackOpening({ packName, onDone }: Props) {
  // Keep the latest onDone without restarting the timers.
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });

  useEffect(() => {
    const soundTimer = window.setTimeout(sounds.packOpen, 380);
    const doneTimer = window.setTimeout(() => done.current(), DURATION_MS);
    return () => {
      window.clearTimeout(soundTimer);
      window.clearTimeout(doneTimer);
    };
  }, []);

  return (
    <div className="pack-opening" role="dialog" aria-label={`Opening ${packName}`} onClick={onDone}>
      <div className="fan">
        {FAN.map((i) => {
          const style = { "--i": i, "--lift": `${Math.abs(i) * 12 - 40}px` } as React.CSSProperties;
          return <span key={i} className="fan-card" style={style} />;
        })}
      </div>
      <div className="foil-pack">
        <div className="foil-top" />
        <div className="foil-body">
          <span>{packName}</span>
        </div>
      </div>
      <p className="pack-hint">Tap to skip</p>
    </div>
  );
}
