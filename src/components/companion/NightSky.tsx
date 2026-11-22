// The calm, moving night sky behind the companion: a slow aurora, rising
// gold bokeh and a few twinkling stars. Positions come from a seeded random
// sequence so the server and the browser draw the same sky.

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const rand = seeded(42);
const BOKEH = Array.from({ length: 16 }, () => ({
  left: `${Math.round(rand() * 100)}%`,
  size: 6 + Math.round(rand() * 22),
  duration: 16 + Math.round(rand() * 18),
  delay: -Math.round(rand() * 30),
  dx: `${Math.round(rand() * 80 - 40)}px`,
  o: (0.25 + rand() * 0.5).toFixed(2),
}));
const STARS = Array.from({ length: 34 }, () => ({
  left: `${(rand() * 100).toFixed(1)}%`,
  top: `${(rand() * 70).toFixed(1)}%`,
  delay: `${(rand() * 4).toFixed(1)}s`,
  scale: 0.6 + rand() * 1.2,
}));

export function NightSky() {
  return (
    <>
      <div className="aurora" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="twinkle" aria-hidden="true">
        {STARS.map((s, i) => (
          <b key={i} style={{ left: s.left, top: s.top, animationDelay: s.delay, transform: `scale(${s.scale})` }} />
        ))}
      </div>
      <div className="bokeh" aria-hidden="true">
        {BOKEH.map((b, i) => (
          <i
            key={i}
            style={
              {
                left: b.left,
                width: b.size,
                height: b.size,
                animationDuration: `${b.duration}s`,
                animationDelay: `${b.delay}s`,
                "--dx": b.dx,
                "--o": b.o,
              } as React.CSSProperties
            }
          />
        ))}
      </div>
    </>
  );
}
