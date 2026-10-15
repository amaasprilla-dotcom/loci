import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FitText } from "./FitText";
import { MathText } from "./MathText";

type Props = {
  options: string[];
  answer: string;
  picked: string | null; // null until the user picks one
  onPick: (option: string) => void;
};

const KEYS = "ABCD";

// Options longer than this (in visible characters) are listed one per row
// instead of in a 2 x 2 grid, so long answers line up and stay readable.
const LONG_OPTION = 32;
const LARGEST = 1.1; // rem: the normal option text size

// The answer options. After a pick, the right answer turns green and a wrong
// pick turns red. Keys A-D also pick on a keyboard.
export function ChoiceButtons({ options, answer, picked, onPick }: Props) {
  useEffect(() => {
    if (picked !== null) return;
    function onKey(event: KeyboardEvent) {
      const index = KEYS.indexOf(event.key.toUpperCase());
      if (index >= 0 && index < options.length) onPick(options[index]);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picked, options, onPick]);

  // One per row if any answer is long, or if one didn't fit side by side
  // (then it would have had to shrink; a full row is easier to read).
  const [tooWide, setTooWide] = useState(false);
  const stacked = tooWide || options.some((option) => visibleLength(option) > LONG_OPTION);
  const gridRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (stacked || !gridRef.current) return;
    const texts = [...gridRef.current.querySelectorAll<HTMLElement>(".option-text")];
    // Measuring the rendered layout is the point here, so setting state is intended.
    // eslint-disable-next-line react/set-state-in-effect
    if (texts.some((text) => text.style.fontSize !== `${LARGEST}rem`)) setTooWide(true);
  }, [stacked, options]);

  return (
    <div className={`options${stacked ? " stacked" : ""}`} ref={gridRef}>
      {options.map((option, i) => {
        let className = "option";
        if (picked !== null && option === answer) className += " correct";
        else if (option === picked) className += " wrong";
        return (
          <button
            key={option}
            className={className}
            disabled={picked !== null}
            onClick={() => onPick(option)}
          >
            <span className="option-key">{KEYS[i]}</span>
            {/* Text that's too wide for the button gets smaller instead of pushing it out */}
            <FitText className="option-text" largest={LARGEST} smallest={0.7} widthOnly>
              <MathText text={option} />
            </FitText>
          </button>
        );
      })}
    </div>
  );
}

// Roughly how many characters show on screen: math commands like \frac count as one.
function visibleLength(text: string): number {
  return text.replace(/\$/g, "").replace(/\\[a-zA-Z]+/g, "x").replace(/[{}^_]/g, "").length;
}
