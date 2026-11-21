import { describe, expect, it } from "vitest";
import {
  alertMessage,
  evaluatePattern,
  median,
  roundSignature,
  type SessionFacts,
} from "../src/lib/shared/baseline";

const SIG = roundSignature("standard", [
  { id: "obj_glasses", spotId: "spot_bowl" },
  { id: "obj_keys", spotId: "spot_hooks" },
  { id: "obj_wallet", spotId: "spot_drawer" },
  { id: "obj_beads", spotId: "spot_window" },
]);

let n = 0;
function session(hints: number, over: Partial<SessionFacts> = {}): SessionFacts {
  n++;
  const t = new Date(Date.UTC(2026, 10, 1, 6, n)).toISOString();
  return {
    id: `s${String(n).padStart(3, "0")}`,
    signature: SIG,
    status: "completed",
    objectCount: 4,
    hintCount: hints,
    micFailures: 0,
    playbackFailures: 0,
    startedAt: t,
    endedAt: t,
    ...over,
  };
}

function history(counts: number[]): SessionFacts[] {
  return counts.map((c) => session(c));
}

describe("median", () => {
  it("takes the middle value", () => {
    expect(median([1, 0, 1, 2, 1])).toBe(1);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe("hackathon alert rule", () => {
  it("needs five valid sessions before there is a baseline", () => {
    const p = evaluatePattern(history([1, 0, 1, 2]), SIG);
    expect(p.state).toBe("building");
    if (p.state === "building") expect(p.needed).toBe(1);
  });

  it("baseline is the median of the first five: 1, 0, 1, 2, 1 -> 1", () => {
    const p = evaluatePattern(history([1, 0, 1, 2, 1]), SIG);
    expect(p.state).toBe("watching");
    if (p.state !== "building") {
      expect(p.baseline).toBe(1);
      expect(p.threshold).toBe(3);
    }
  });

  it("the demo: two seeded 3-hint rounds do not alert, the judge's third one does", () => {
    const seeded = history([1, 0, 1, 2, 1, 3, 3]);
    const before = evaluatePattern(seeded, SIG);
    expect(before.state).toBe("watching");
    if (before.state !== "building") expect(before.streak).toHaveLength(2);

    const judge = session(3);
    const after = evaluatePattern([...seeded, judge], SIG);
    expect(after.state).toBe("alert");
    if (after.state === "alert") {
      expect(after.alertSessions.map((s) => s.hintCount)).toEqual([3, 3, 3]);
      expect(after.patternKey).toContain(seeded[5].id);
    }
  });

  it("only rounds at least two hints above baseline count", () => {
    const p = evaluatePattern(history([1, 0, 1, 2, 1, 2, 3, 3]), SIG);
    expect(p.state).toBe("watching"); // the 2 breaks the run; only two elevated rounds follow
  });

  it("the same continuing pattern keeps the same key (no duplicate alert)", () => {
    const base = history([1, 0, 1, 2, 1, 3, 3, 3]);
    const first = evaluatePattern(base, SIG);
    const fourth = evaluatePattern([...base, session(4)], SIG);
    expect(first.state).toBe("alert");
    expect(fourth.state).toBe("alert");
    if (first.state === "alert" && fourth.state === "alert") {
      expect(fourth.patternKey).toBe(first.patternKey);
    }
  });

  it("a new streak after the pattern breaks gets a new key", () => {
    const base = history([1, 0, 1, 2, 1, 3, 3, 3]);
    const first = evaluatePattern(base, SIG);
    const later = [...base, session(1), session(3), session(4), session(3)];
    const second = evaluatePattern(later, SIG);
    expect(second.state).toBe("alert");
    if (first.state === "alert" && second.state === "alert") {
      expect(second.patternKey).not.toBe(first.patternKey);
    }
  });

  it("excludes interrupted rounds and rounds with mic or playback failures", () => {
    const seeded = history([1, 0, 1, 2, 1, 3, 3]);
    const interrupted = session(3, { status: "interrupted" });
    const micFail = session(5, { micFailures: 1 });
    const playFail = session(4, { playbackFailures: 1 });
    const p = evaluatePattern([...seeded, interrupted, micFail, playFail], SIG);
    expect(p.state).toBe("watching"); // still only two comparable elevated rounds
    // and they don't break the streak either
    const q = evaluatePattern([...seeded, interrupted, micFail, session(3)], SIG);
    expect(q.state).toBe("alert");
  });

  it("excluded rounds are not part of the baseline", () => {
    const p = evaluatePattern(
      [session(9, { micFailures: 2 }), session(8, { status: "interrupted" }), ...history([1, 0, 1, 2, 1])],
      SIG,
    );
    expect(p.state).toBe("watching");
    if (p.state !== "building") expect(p.baseline).toBe(1);
  });

  it("only compares rounds with the same objects and difficulty", () => {
    const other = roundSignature("gentle", [{ id: "obj_glasses", spotId: "spot_bowl" }]);
    const p = evaluatePattern(
      [...history([1, 0, 1, 2, 1, 3, 3]), session(3, { signature: other })],
      SIG,
    );
    expect(p.state).toBe("watching");
  });

  it("only four-object rounds are valid", () => {
    const p = evaluatePattern(history([1, 0, 1, 2]).concat(session(1, { objectCount: 3 })), SIG);
    expect(p.state).toBe("building");
  });
});

describe("alert wording", () => {
  it("matches the brief exactly", () => {
    expect(alertMessage("Dad", "he", 1, [3, 3, 3])).toBe(
      "Dad usually uses 1 hint per round. In his last 3 sessions, he used 3 hints each time.",
    );
  });
  it("lists counts when they differ, and handles other pronouns", () => {
    expect(alertMessage("Mum", "she", 0, [2, 3, 2])).toBe(
      "Mum usually uses 0 hints per round. In her last 3 sessions, she used 2, 3 and 2 hints.",
    );
    expect(alertMessage("Sam", "they", 2, [4, 4, 4])).toBe(
      "Sam usually uses 2 hints per round. In their last 3 sessions, they used 4 hints each time.",
    );
  });
});
