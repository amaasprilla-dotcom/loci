import { useEffect, useState } from "react";

// The current time. The screen also re-draws every 30 seconds, so
// "due in 5m" labels and due counts stay correct while it is left open.
export function useNow(): Date {
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((tick) => tick + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  // Read the clock on every render (not only every 30 s): a card added a
  // moment ago must already count as due.
  // eslint-disable-next-line react/purity
  return new Date();
}
