import { describe, expect, it } from "vitest";
import { choicesFor, dayMetrics, fromScale, initialBaseline, ruleStep, toScale, type ItemResult, type Memory } from "../src/lib/shared/companion";
import { fallbackPlan, validatePlan, type PlanContext } from "../src/lib/server/planner";

const r = (p: Partial<ItemResult>): ItemResult => ({
  gameId: "g1",
  itemId: "i1",
  kind: "finish_memory",
  scored: true,
  correct: true,
  attempts: 1,
  hints: 0,
  revealed: false,
  responseMs: 4000,
  spoke: true,
  words: 0,
  skipped: false,
  ...p,
});

describe("the 15-step scale", () => {
  it("round-trips every stage and level", () => {
    for (const stage of ["early", "middle", "late"] as const)
      for (const level of [1, 2, 3, 4, 5] as const) expect(fromScale(toScale(stage, level))).toEqual({ stage, level });
  });
  it("rolls over between stages and clamps at the ends", () => {
    expect(fromScale(toScale("early", 1) - 1)).toEqual({ stage: "middle", level: 5 });
    expect(fromScale(toScale("middle", 5) + 1)).toEqual({ stage: "early", level: 1 });
    expect(fromScale(99)).toEqual({ stage: "early", level: 5 });
    expect(fromScale(-3)).toEqual({ stage: "late", level: 1 });
  });
});

describe("the starting baseline", () => {
  it("follows the answers when the doctor is unsure", () => {
    expect(initialBaseline([0, 0, 0, 0, 0], "unsure")).toEqual({ stage: "early", level: 5 });
    expect(initialBaseline([3, 3, 3, 3, 3], "unsure")).toEqual({ stage: "late", level: 1 });
  });
  it("keeps the doctor's stage and places the level inside it", () => {
    // Answers alone say middle (score 5): the doctor says early, so the gentlest early level.
    expect(initialBaseline([0, 1, 2, 1, 1], "early")).toEqual({ stage: "early", level: 1 });
    // Answers alone say late: the doctor says middle, so the gentlest middle level.
    expect(initialBaseline([3, 3, 3, 3, 2], "middle")).toEqual({ stage: "middle", level: 1 });
    // Answers say early: the doctor says middle, so the top middle level.
    expect(initialBaseline([0, 0, 0, 0, 0], "middle")).toEqual({ stage: "middle", level: 5 });
  });
});

describe("the daily rule", () => {
  it("asks a little more after a comfortable day", () => {
    const m = dayMetrics([r({}), r({}), r({}), r({}), r({}), r({})], 8);
    expect(m.accuracy).toBe(1);
    expect(ruleStep(m, "early")).toBe(1);
  });
  it("gives more support after a hard day", () => {
    const m = dayMetrics([r({ correct: false, attempts: 2, revealed: true }), r({ correct: false, attempts: 2, revealed: true }), r({})], 8);
    expect(ruleStep(m, "middle")).toBe(-1);
  });
  it("stays put on an ordinary day", () => {
    const m = dayMetrics([r({}), r({ correct: false, attempts: 2, hints: 1 }), r({}), r({})], 8);
    expect(ruleStep(m, "early")).toBe(0);
  });
  it("judges late stage by taking part, not by answers", () => {
    const talk = dayMetrics([r({ kind: "reminisce", scored: false, words: 30 })], 5);
    expect(ruleStep(talk, "late")).toBe(1);
    const skipped = dayMetrics([r({ scored: false, skipped: true }), r({ scored: false, skipped: true })], 2);
    expect(ruleStep(skipped, "late")).toBe(-1);
  });
  it("offers fewer choices at gentler levels", () => {
    expect(choicesFor("early", 5)).toBe(4);
    expect(choicesFor("early", 1)).toBe(3);
    expect(choicesFor("middle", 1)).toBe(2);
    expect(choicesFor("late", 1)).toBe(1);
  });
});

const memory = (id: string, p: Partial<Memory> = {}): Memory => ({
  id,
  kind: "event",
  title: "Wedding in Lahore",
  detail: "They married in Lahore in 1974.",
  people: ["Amina"],
  place: "Lahore",
  era: "1974",
  facts: [{ prompt: "Where did you get married?", answer: "Lahore", distractors: ["Karachi", "Dubai", "London"] }],
  photo: null,
  art: { id: "a", url: `/api/media/${id}` },
  artStatus: "ready",
  clip: null,
  source: "interview",
  addedBy: "Omar",
  createdAt: "2026-11-22T00:00:00Z",
  ...p,
});

const ctx = (stage: PlanContext["stage"], level: PlanContext["level"]): PlanContext => ({
  playerId: "p",
  playerName: "Yusuf",
  callName: "Baba",
  pronoun: "he",
  companion: null,
  stage,
  level,
  focus: null,
});

const item = (over: Record<string, unknown> = {}) => ({
  memory_id: "m1",
  prompt: "Where did you get married?",
  narration: "",
  use_clip: false,
  picture: "memory" as const,
  choices: [
    { label: "Lahore", emoji: "🕌", memory_id: "" },
    { label: "Karachi", emoji: "", memory_id: "" },
    { label: "Dubai", emoji: "", memory_id: "" },
    { label: "London", emoji: "", memory_id: "" },
  ],
  answer_index: 0,
  order: [],
  hint: "It was in his home town.",
  praise: "Yes, Lahore.",
  reveal: "It was Lahore.",
  ...over,
});

describe("plan validation", () => {
  const mems = [memory("m1")];
  it("keeps the right answer among the choices and trims to the level", () => {
    const plan = validatePlan({ greeting: "Hi", closing: "Bye", games: [{ kind: "finish_memory", title: "T", intro: "I", items: [item()] }] }, ctx("middle", 1), mems)!;
    const it = plan.games[0].items[0];
    expect(it.choices).toHaveLength(2);
    expect(it.choices.some((c) => c.id === it.answerId && c.label === "Lahore")).toBe(true);
    expect(it.imageUrl).toBe("/api/media/m1");
  });
  it("drops kinds the stage doesn't allow and items whose answer is missing", () => {
    const plan = validatePlan(
      {
        greeting: "",
        closing: "",
        games: [
          { kind: "sequence", title: "Order", intro: "", items: [item()] },
          { kind: "finish_memory", title: "T", intro: "", items: [item({ answer_index: 9 }), item()] },
        ],
      },
      ctx("late", 3),
      mems,
    );
    // Late stage allows neither sequence nor finish_memory.
    expect(plan).toBeNull();
  });
  it("adds a calm item when a calm game comes without one", () => {
    const plan = validatePlan({ greeting: "", closing: "", games: [{ kind: "sparkle", title: "", intro: "", items: [] }] }, ctx("late", 1), mems)!;
    expect(plan.games[0].items).toHaveLength(1);
    expect(plan.games[0].title).toBe("Catch the stars");
  });
  it("builds a rule-based plan from the facts without the AI", () => {
    const plan = fallbackPlan(ctx("early", 3), mems);
    const fact = plan.games.find((g) => g.kind === "finish_memory")!;
    expect(fact.items[0].choices.find((c) => c.id === fact.items[0].answerId)?.label).toBe("Lahore");
    expect(plan.games.length).toBeGreaterThan(0);
  });
});
