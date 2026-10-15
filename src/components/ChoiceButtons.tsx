import { useEffect } from "react";
import { MathText } from "./MathText";

type Props = {
  options: string[];
  answer: string;
  picked: string | null; // null until the user picks one
  onPick: (option: string) => void;
};

const KEYS = "ABCD";

// The 2 x 2 grid of answer options. After a pick, the right answer turns
// green and a wrong pick turns red. Keys A-D also pick on a keyboard.
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

  return (
    <div className="options">
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
            <MathText text={option} />
          </button>
        );
      })}
    </div>
  );
}
