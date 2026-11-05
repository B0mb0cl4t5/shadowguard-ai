"use client";

import { useEffect, useRef, useState } from "react";

const ROLL_MS = 700;

/** Fast at first, then settling, like a counter with weight. */
const settle = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

/** The header's animations button and the system setting both switch rolling off. */
function motionAllowed(): boolean {
  return (
    !document.documentElement.classList.contains("reduce-motion") && !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * A figure that rolls to its new value when a poll changes it, so a change is seen rather
 * than swapped in. It renders the real value first, so nothing rolls on page load, and a
 * second change mid-roll carries on from the figure on screen.
 */
export function AnimatedNumber({ value, format = (n) => String(Math.round(n)) }: { value: number; format?: (n: number) => string }) {
  const [shown, setShown] = useState(value);
  const onScreen = useRef(value);

  useEffect(() => {
    const from = onScreen.current;
    if (from === value || !motionAllowed()) {
      onScreen.current = value;
      setShown(value);
      return;
    }
    let frame = 0;
    const began = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - began) / ROLL_MS);
      onScreen.current = from + (value - from) * settle(p);
      setShown(onScreen.current);
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return <>{format(shown)}</>;
}
