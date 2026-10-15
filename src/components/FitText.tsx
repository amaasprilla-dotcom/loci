import { useLayoutEffect, useRef, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  className?: string;
  largest: number; // rem
  smallest: number; // rem
  widthOnly?: boolean; // only shrink for text that's too wide (for boxes that grow in height)
};

// A box whose text shrinks, step by step, until it fits (no overflow to the
// side or, if the box has a set height, to the bottom). Only if it still
// doesn't fit at the smallest size is it allowed to scroll.
export function FitText({ children, className, largest, smallest, widthOnly = false }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    function fit() {
      if (!box) return;
      let size = largest;
      box.style.fontSize = `${size}rem`;
      const overflowing = () =>
        box.scrollWidth > box.clientWidth + 1 || (!widthOnly && box.scrollHeight > box.clientHeight + 1);
      while (overflowing() && size > smallest) {
        size = Math.round((size - 0.05) * 100) / 100;
        box.style.fontSize = `${size}rem`;
      }
    }
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  });

  return (
    <div className={className} ref={boxRef}>
      {children}
    </div>
  );
}
