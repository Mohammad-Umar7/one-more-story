import type { MemorySessionView } from "@/lib/shared/types";

interface Pattern {
  state: string;
  baseline: number | null;
  threshold: number | null;
  needed: number;
  streak: number;
}

const clues = (n: number) => `${n} clue${n === 1 ? "" : "s"}`;

/**
 * Plain words instead of charts: how many clues the player usually asks for,
 * the last few rounds as big numbers, and one sentence on what happens next.
 */
export function HelpSummary({
  history,
  familyName,
  recipient,
}: {
  history: { sessions: MemorySessionView[]; pattern: Pattern };
  familyName: string;
  recipient: string | null;
}) {
  const p = history.pattern;
  const rounds = history.sessions
    .filter((s) => s.valid && s.role !== "other-setup")
    .slice(0, 5)
    .reverse();
  const who = recipient ?? "your trusted person";

  const headline =
    p.baseline === null
      ? `Getting to know ${familyName}'s usual: ${p.needed} more round${p.needed === 1 ? "" : "s"} to go.`
      : `${familyName} usually asks for ${clues(p.baseline)} a round.`;

  const streak = Math.min(p.streak, 3);
  const status =
    p.baseline === null
      ? null
      : p.state === "alert"
        ? { tone: "gold", text: `The last 3 rounds needed more help than usual, so ${who} was sent an alert.` }
        : streak > 0
          ? {
              tone: "gold",
              text: `The last ${streak === 1 ? "round" : `${streak} rounds`} needed more help than usual. If ${3 - streak === 1 ? "the next one does" : `${3 - streak} more in a row do`} too, ${who} gets an alert.`,
            }
          : { tone: "sage", text: "Recent rounds look like usual." };

  return (
    <div>
      <p className="font-display text-2xl leading-snug">{headline}</p>
      {rounds.length > 0 && (
        <>
          <p className="mt-4 text-sm font-bold text-navy-600">Clues asked for, most recent last</p>
          <ol className="mt-2 flex gap-2">
            {rounds.map((r) => {
              const more = p.threshold !== null && r.hintCount >= p.threshold && r.role === "compared";
              const day = new Date(r.endedAt ?? r.startedAt).toLocaleDateString("en-GB", { weekday: "short" });
              return (
                <li key={r.id} className="flex shrink-0 flex-col items-center gap-1">
                  <span
                    className={`flex size-12 items-center justify-center rounded-full font-display text-2xl font-semibold ${
                      more ? "bg-gold-400 text-navy-950" : "bg-ivory-100 text-navy-900"
                    }`}
                  >
                    {r.hintCount}
                  </span>
                  <span className="text-xs font-bold text-navy-600">{day}</span>
                </li>
              );
            })}
          </ol>
        </>
      )}
      {status && (
        <p className={`mt-4 rounded-2xl px-4 py-3 text-lg ${status.tone === "gold" ? "bg-gold-100 text-navy-900" : "bg-sage-100 text-sage-700"}`}>
          {status.text}
        </p>
      )}
    </div>
  );
}
