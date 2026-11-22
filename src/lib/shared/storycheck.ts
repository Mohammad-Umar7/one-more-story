// The story game's starting point (baseline) and how later games compare.
//
// The first finished story game is the player's own starting point: how many
// things about the photo they remembered without help. Every later story game
// is compared with it, in plain words for the family. No medical inference.

export interface StoryAnswer {
  /** Short label of what was asked, e.g. "where we were". */
  topic: string;
  right: boolean;
  words: number;
}

export interface StoryComparison {
  verdict: "more" | "same" | "fewer" | "much_fewer";
  /** Remembered now minus remembered at the starting point (scaled to this game's questions). */
  diff: number;
  sentence: string;
}

export interface StoryCheckView {
  id: string;
  createdAt: string;
  total: number;
  correct: number;
  answers: StoryAnswer[];
  isBaseline: boolean;
  /** Compared with the starting point (null for the starting point itself). */
  comparison: StoryComparison | null;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** "Remembered 3 of 4 things about the photo, and needed a little help with 1." */
export function summarizeCheck(c: { correct: number; total: number }): string {
  const help = c.total - c.correct;
  const base = `Remembered ${c.correct} of ${c.total} ${plural(c.total, "thing", "things")} about the photo`;
  return help > 0 ? `${base}, and needed a little help with ${help}.` : `${base}, with no help needed.`;
}

/** How a later game compares with the starting point. */
export function compareWithBaseline(
  baseline: { correct: number; total: number },
  check: { correct: number; total: number },
): StoryComparison {
  const scaled = baseline.total > 0 ? Math.round((baseline.correct / baseline.total) * check.total) : check.correct;
  const diff = check.correct - scaled;
  const now = `Remembered ${check.correct} of ${check.total}`;
  const start = `the starting point (${scaled} of ${check.total})`;
  if (diff > 0) return { verdict: "more", diff, sentence: `${now}: ${diff} more than ${start}.` };
  if (diff === 0) return { verdict: "same", diff, sentence: `${now}, the same as the starting point.` };
  if (diff === -1) return { verdict: "fewer", diff, sentence: `${now}: one fewer than ${start}.` };
  return { verdict: "much_fewer", diff, sentence: `${now}: ${-diff} fewer than ${start}. Needed more help than usual.` };
}

/** The family's notification when the starting point is first set. */
export function baselineMessage(familyName: string, c: { correct: number; total: number }): { title: string; body: string } {
  return {
    title: `${familyName}'s starting point is set`,
    body: `After today's story game: ${summarizeCheck(c).replace(/^Remembered/, "remembered")} From the next story game, each one is compared with this.`,
  };
}
