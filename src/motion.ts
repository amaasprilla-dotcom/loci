// Calm mode: no float, tilt, shake or particles; cards fade instead of flying.
// It's on when the user turns it on in Settings. The CSS reacts to a `calm`
// class on <body>.

import { useEffect } from "react";

export function useCalmMode(calmSetting: boolean) {
  useEffect(() => {
    document.body.classList.toggle("calm", calmSetting);
  }, [calmSetting]);
}

// For code that times animations (only call it from event handlers).
export function isCalm(): boolean {
  return document.body.classList.contains("calm");
}
