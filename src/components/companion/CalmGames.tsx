"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { chime } from "@/lib/client/chime";

/**
 * Catch the stars: glowing stars appear one at a time; touching one plays a
 * soft bell and the next appears. Nothing can go wrong.
 */
export function SparkleGame({ count = 6, onDone, onTouch }: { count?: number; onDone: (touches: number) => void; onTouch?: (n: number) => void }) {
  const spots = useMemo(() => {
    // Spread out over the play area, never at the very edges.
    const pts = [
      [22, 30],
      [72, 22],
      [50, 58],
      [24, 74],
      [78, 66],
      [48, 18],
      [30, 48],
      [70, 44],
    ];
    return pts.slice(0, count).map(([x, y]) => ({ x, y }));
  }, [count]);
  const [caught, setCaught] = useState(0);
  const [bursts, setBursts] = useState<{ id: number; x: number; y: number }[]>([]);
  const finished = useRef(false);

  const touch = (i: number) => {
    if (i !== caught || finished.current) return;
    chime(i);
    setBursts((b) => [...b.slice(-3), { id: Date.now(), ...spots[i] }]);
    const n = caught + 1;
    setCaught(n);
    onTouch?.(n);
    if (n >= spots.length) {
      finished.current = true;
      setTimeout(() => onDone(n), 900);
    }
  };

  return (
    <div className="relative mx-auto h-[46dvh] w-full max-w-md" aria-label="Touch the glowing star">
      {spots.map((s, i) =>
        i === caught ? (
          <button
            key={i}
            type="button"
            onClick={() => touch(i)}
            className="star-btn flex size-28 items-center justify-center"
            style={{ left: `${s.x}%`, top: `${s.y}%` }}
            aria-label="Star"
          >
            <span className="absolute inset-0 animate-ripple rounded-full bg-gold-300/40" aria-hidden="true" />
            <svg viewBox="0 0 24 24" className="relative size-20 drop-shadow-[0_0_18px_rgb(245_225_163/0.9)]" aria-hidden="true">
              <path
                d="M12 2.5l2.6 6.2 6.7.5-5.1 4.4 1.6 6.5L12 16.6 6.2 20.1l1.6-6.5L2.7 9.2l6.7-.5L12 2.5z"
                fill="url(#starfill)"
                stroke="#fff6d6"
                strokeWidth="0.6"
              />
              <defs>
                <radialGradient id="starfill" cx="50%" cy="40%" r="60%">
                  <stop offset="0%" stopColor="#fffbea" />
                  <stop offset="60%" stopColor="#f5e1a3" />
                  <stop offset="100%" stopColor="#dcae47" />
                </radialGradient>
              </defs>
            </svg>
          </button>
        ) : i < caught ? (
          <span key={i} className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gold-200 shadow-[0_0_12px_4px_rgb(245_225_163/0.6)]" style={{ left: `${s.x}%`, top: `${s.y}%` }} aria-hidden="true" />
        ) : null,
      )}
      {bursts.map((b) => (
        <span key={b.id} className="pointer-events-none absolute size-40 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-gold-200/70 animate-ripple" style={{ left: `${b.x}%`, top: `${b.y}%` }} aria-hidden="true" />
      ))}
      <p className="absolute inset-x-0 bottom-0 text-center text-lg font-bold text-ivory-200" aria-live="polite">
        {caught} of {spots.length}
      </p>
    </div>
  );
}

/**
 * Breathe with me: a glowing circle grows (breathe in) and shrinks (breathe
 * out) on a ten-second rhythm; the companion counts along.
 */
export function BreatheGame({ cycles = 3, onPhase, onDone }: { cycles?: number; onPhase: (phase: "in" | "out", cycle: number) => void; onDone: () => void }) {
  const [label, setLabel] = useState("Breathe in");
  const cb = useRef({ onPhase, onDone });
  useEffect(() => {
    cb.current = { onPhase, onDone };
  });

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let c = 0; c < cycles; c++) {
      timers.push(
        setTimeout(() => {
          setLabel("Breathe in");
          cb.current.onPhase("in", c);
        }, c * 10_000),
      );
      timers.push(
        setTimeout(() => {
          setLabel("And out");
          cb.current.onPhase("out", c);
        }, c * 10_000 + 5_000),
      );
    }
    timers.push(setTimeout(() => cb.current.onDone(), cycles * 10_000));
    return () => timers.forEach(clearTimeout);
  }, [cycles]);

  return (
    <div className="flex h-[46dvh] w-full flex-col items-center justify-center">
      <div className="relative flex size-64 items-center justify-center md:size-80">
        <span className="breath absolute inset-0 rounded-full bg-[radial-gradient(circle,rgb(245_225_163/0.55),rgb(180_140_224/0.35)_55%,transparent_72%)]" aria-hidden="true" />
        <span className="breath absolute inset-[18%] rounded-full border-2 border-gold-200/70 shadow-[0_0_60px_10px_rgb(245_225_163/0.35)]" aria-hidden="true" />
        <span className="relative text-3xl font-bold text-ivory-50 text-glow" aria-live="polite">
          {label}
        </span>
      </div>
    </div>
  );
}
