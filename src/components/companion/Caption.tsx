"use client";

/** What the companion is saying, in big words that drift in one after another. */
export function Caption({ text, className = "", size = "lg" }: { text: string | null | undefined; className?: string; size?: "xl" | "lg" | "md" }) {
  if (!text) return null;
  const words = text.split(/\s+/).filter(Boolean);
  const sizes = {
    xl: "text-[1.85rem] leading-snug md:text-4xl",
    lg: "text-[1.5rem] leading-snug md:text-3xl",
    md: "text-xl leading-snug md:text-2xl",
  };
  return (
    <p key={text} className={`text-glow font-bold text-ivory-50 ${sizes[size]} ${className}`} aria-live="polite">
      {words.map((w, i) => (
        <span key={i} className="word-in" style={{ animationDelay: `${Math.min(i * 55, 2200)}ms` }}>
          {w}
          {i < words.length - 1 ? " " : ""}
        </span>
      ))}
    </p>
  );
}

const COLORS = ["#f5e1a3", "#ebc96f", "#dcae47", "#e98a6b", "#b48ce0", "#6fc3d1", "#fffdf8"];

/** A burst of gold confetti (drawn once per `burst` value). */
export function Confetti({ burst }: { burst: number }) {
  if (!burst) return null;
  const pieces = Array.from({ length: 42 }, (_, i) => {
    const angle = (i / 42) * Math.PI * 2 + (burst % 7) * 0.3;
    const dist = 160 + ((i * 37 + burst * 13) % 220);
    return {
      x: `${Math.round(Math.cos(angle) * dist)}px`,
      y: `${Math.round(Math.sin(angle) * dist - 120)}px`,
      r: `${(i * 47) % 720 - 360}deg`,
      color: COLORS[i % COLORS.length],
      delay: `${(i % 6) * 20}ms`,
      round: i % 3 === 0,
    };
  });
  return (
    <div key={burst} className="confetti" aria-hidden="true">
      {pieces.map((p, i) => (
        <i
          key={i}
          style={
            {
              background: p.color,
              animationDelay: p.delay,
              borderRadius: p.round ? "9999px" : undefined,
              "--x": p.x,
              "--y": p.y,
              "--r": p.r,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
