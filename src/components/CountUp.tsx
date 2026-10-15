import { useEffect, useRef, useState } from "react";
import { isCalm } from "../motion";
import { sounds } from "../sound";

type Props = {
  value: number;
  durationMs?: number;
  delayMs?: number; // wait before starting (for count-ups that happen one after another)
  from?: number; // start here the first time (default: 0)
};

const TICK_EVERY_MS = 70;

// A number that counts up (or down) to its new value, ticking as it goes.
// In Calm mode it just shows the new value.
export function CountUp({ value, durationMs = 500, delayMs = 0, from = 0 }: Props) {
  const [shown, setShown] = useState(from);
  const shownRef = useRef(from);

  useEffect(() => {
    const start = shownRef.current;
    if (start === value) return;
    let frame = 0;
    let lastTick = 0;
    const timer = window.setTimeout(() => {
      const startedAt = performance.now();
      const calm = isCalm();
      function step(now: number) {
        const progress = calm ? 1 : Math.min(1, (now - startedAt) / durationMs);
        const eased = 1 - (1 - progress) ** 3; // fast at first, then settles
        const current = Math.round(start + (value - start) * eased);
        shownRef.current = current;
        setShown(current);
        if (!calm && now - lastTick > TICK_EVERY_MS) {
          sounds.tick();
          lastTick = now;
        }
        if (progress < 1) frame = requestAnimationFrame(step);
      }
      frame = requestAnimationFrame(step);
    }, delayMs);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [value, durationMs, delayMs]);

  return <>{shown.toLocaleString()}</>;
}
