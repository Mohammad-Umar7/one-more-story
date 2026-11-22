// Soft bell tones for the calm games and right answers (Web Audio, no files).
// Notes come from a pentatonic scale, so any sequence sounds pleasant.

const PENTATONIC = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66];

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AC();
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  return ctx;
}

/** Call from a tap so later chimes are allowed on phones. */
export function unlockChime(): void {
  audio();
}

export function chime(step = Math.floor(Math.random() * PENTATONIC.length), volume = 0.18): void {
  const c = audio();
  if (!c) return;
  const now = c.currentTime;
  const freq = PENTATONIC[((step % PENTATONIC.length) + PENTATONIC.length) % PENTATONIC.length];
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(volume, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.6);
  gain.connect(c.destination);
  // A bell: the note plus a quieter, slightly detuned overtone.
  for (const [mult, level] of [
    [1, 1],
    [2.01, 0.35],
    [3.02, 0.12],
  ] as const) {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = "sine";
    osc.frequency.value = freq * mult;
    g.gain.value = level;
    osc.connect(g).connect(gain);
    osc.start(now);
    osc.stop(now + 1.7);
  }
}

/** A short rising arpeggio for a right answer. */
export function sparkleChord(): void {
  [0, 2, 4].forEach((n, i) => setTimeout(() => chime(n + 2, 0.14), i * 90));
}
