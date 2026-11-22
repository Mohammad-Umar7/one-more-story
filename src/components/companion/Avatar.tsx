"use client";

import { useEffect, useRef } from "react";

type LevelSource = () => { level: number; real: boolean; playing: boolean };

/**
 * The companion's face: a big round portrait in a slowly turning ring of
 * gold, that breathes while idle and glows and moves with the voice while it
 * talks. The level is read every frame and written to a CSS variable, so
 * nothing re-renders per frame.
 */
export function Avatar({
  src,
  name,
  speaking,
  listening = false,
  level,
  className = "",
  painting = false,
}: {
  src: string | null | undefined;
  name: string;
  speaking: boolean;
  listening?: boolean;
  level?: LevelSource;
  className?: string;
  painting?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const levelRef = useRef(level);
  useEffect(() => {
    levelRef.current = level;
  });

  useEffect(() => {
    let raf = 0;
    let smooth = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const el = ref.current;
      if (el) {
        const src = levelRef.current?.() ?? { level: 0, real: false, playing: false };
        let target = 0;
        if (src.playing) {
          if (src.real) target = src.level;
          else {
            // No measured level (browser voice, or a browser without capture): a natural speech-like rhythm.
            const t = (now - t0) / 1000;
            target = Math.max(0, 0.32 + 0.28 * Math.sin(t * 8.3) + 0.18 * Math.sin(t * 13.1 + 1.3) + 0.12 * Math.sin(t * 3.1));
          }
        }
        smooth += (target - smooth) * (target > smooth ? 0.45 : 0.18);
        el.style.setProperty("--lvl", smooth.toFixed(3));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div ref={ref} className={`avatar ${className}`} data-speaking={speaking} data-listening={listening} role="img" aria-label={name}>
      <span className="avatar-glow" aria-hidden="true" />
      <span className="avatar-halo" aria-hidden="true" />
      <span className="avatar-halo" aria-hidden="true" />
      <span className="avatar-halo" aria-hidden="true" />
      <span className="avatar-ring" aria-hidden="true" />
      <span className={`avatar-face ${painting ? "shimmer" : ""}`}>
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" draggable={false} />
        ) : (
          <span className="orb" aria-hidden="true" />
        )}
      </span>
    </div>
  );
}
