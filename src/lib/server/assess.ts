// The daily baseline. After the player finishes the day's games, Claude looks
// at how it went (first-try answers, hints, gentle reveals, response times,
// how much they talked) next to the last week, and decides tomorrow's stage
// and level. Guard rails:
//   - one step per day at most (level 1..5 inside a stage, rolling over into
//     the next stage at the ends), so one bad day never jumps a stage;
//   - if the AI and the simple rule disagree by two steps, stay put;
//   - without the AI, the simple rule decides.
// The family sees the reason in plain words. Nothing here is a diagnosis.

import { getDb, nowIso, uid } from "./db";
import { chatJson, describeAiError } from "./openrouter";
import { getPlan } from "./planner";
import {
  dayMetrics,
  fromScale,
  ruleStep,
  STAGE_LABEL,
  toScale,
  type Baseline,
  type DayMetrics,
  type ItemResult,
  type Level,
  type Stage,
} from "../shared/companion";

interface BaselineRow {
  id: string;
  player_id: string;
  stage: Stage;
  level: number;
  trend: Baseline["trend"];
  reason: string;
  family_note: string;
  decided_by: Baseline["decidedBy"];
  metrics: string | null;
  plan_id: string | null;
  created_at: string;
}

function toBaseline(r: BaselineRow): Baseline {
  return {
    id: r.id,
    stage: r.stage,
    level: r.level as Level,
    trend: r.trend,
    reason: r.reason,
    familyNote: r.family_note,
    decidedBy: r.decided_by,
    createdAt: r.created_at,
  };
}

export function currentBaseline(playerId: string): Baseline | null {
  const r = getDb().prepare("SELECT * FROM baselines WHERE player_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(playerId) as BaselineRow | undefined;
  return r ? toBaseline(r) : null;
}

export function baselineHistory(playerId: string, limit = 30): (Baseline & { metrics: DayMetrics | null; focus: string | null })[] {
  const rows = getDb().prepare("SELECT * FROM baselines WHERE player_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?").all(playerId, limit) as unknown as BaselineRow[];
  return rows.map((r) => {
    let extra: { metrics?: DayMetrics; focus?: string } = {};
    try {
      extra = r.metrics ? JSON.parse(r.metrics) : {};
    } catch {
      extra = {};
    }
    return { ...toBaseline(r), metrics: extra.metrics ?? null, focus: extra.focus ?? null };
  });
}

/** The latest "focus for tomorrow" note, used by the planner. */
export function latestFocus(playerId: string): string | null {
  return baselineHistory(playerId, 1)[0]?.focus ?? null;
}

export function setBaseline(
  playerId: string,
  b: { stage: Stage; level: Level; trend: Baseline["trend"]; reason: string; familyNote?: string; decidedBy: Baseline["decidedBy"]; metrics?: DayMetrics | null; focus?: string | null; planId?: string | null },
): Baseline {
  const id = uid("bl");
  getDb()
    .prepare(
      `INSERT INTO baselines (id, player_id, stage, level, trend, reason, family_note, decided_by, metrics, plan_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      playerId,
      b.stage,
      b.level,
      b.trend,
      b.reason.slice(0, 600),
      (b.familyNote ?? "").slice(0, 600),
      b.decidedBy,
      JSON.stringify({ metrics: b.metrics ?? null, focus: b.focus ?? null }),
      b.planId ?? null,
      nowIso(),
    );
  return currentBaseline(playerId)!;
}

// ---- results ---------------------------------------------------------------------------

export function saveResult(planId: string, r: ItemResult): void {
  getDb()
    .prepare(
      `INSERT INTO game_results (id, plan_id, game_id, item_id, kind, scored, correct, attempts, hints, revealed, response_ms, spoke, words, skipped, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(plan_id, game_id, item_id) DO NOTHING`,
    )
    .run(
      uid("gr"),
      planId,
      r.gameId.slice(0, 20),
      r.itemId.slice(0, 20),
      r.kind,
      r.scored ? 1 : 0,
      r.correct ? 1 : 0,
      Math.max(0, Math.min(20, Math.round(r.attempts))),
      Math.max(0, Math.min(20, Math.round(r.hints))),
      r.revealed ? 1 : 0,
      typeof r.responseMs === "number" && r.responseMs > 0 ? Math.min(600_000, Math.round(r.responseMs)) : null,
      r.spoke ? 1 : 0,
      Math.max(0, Math.min(2000, Math.round(r.words))),
      r.skipped ? 1 : 0,
      nowIso(),
    );
}

export function planResults(planId: string): ItemResult[] {
  const rows = getDb().prepare("SELECT * FROM game_results WHERE plan_id = ? ORDER BY created_at").all(planId) as {
    game_id: string;
    item_id: string;
    kind: ItemResult["kind"];
    scored: number;
    correct: number;
    attempts: number;
    hints: number;
    revealed: number;
    response_ms: number | null;
    spoke: number;
    words: number;
    skipped: number;
  }[];
  return rows.map((r) => ({
    gameId: r.game_id,
    itemId: r.item_id,
    kind: r.kind,
    scored: r.scored === 1,
    correct: r.correct === 1,
    attempts: r.attempts,
    hints: r.hints,
    revealed: r.revealed === 1,
    responseMs: r.response_ms,
    spoke: r.spoke === 1,
    words: r.words,
    skipped: r.skipped === 1,
  }));
}

function planMinutes(planId: string): number {
  const r = getDb().prepare("SELECT started_at, completed_at FROM daily_plans WHERE id = ?").get(planId) as { started_at: string | null; completed_at: string | null } | undefined;
  if (!r?.started_at || !r.completed_at) return 0;
  return Math.max(0, (Date.parse(r.completed_at) - Date.parse(r.started_at)) / 60_000);
}

// ---- the decision ------------------------------------------------------------------------

interface AiDecision {
  step: "more_support" | "stay" | "more_challenge";
  reason: string;
  family_note: string;
  focus_tomorrow: string;
}

function describeMetrics(m: DayMetrics): string {
  return [
    `${m.items} items in ${m.minutes} min`,
    m.scored ? `${m.firstTry}/${m.scored} right on the first try` : "no scored items",
    `${m.hints} hints`,
    `${m.reveals} gentle reveals`,
    m.medianResponseMs ? `median answer time ${(m.medianResponseMs / 1000).toFixed(1)}s` : "",
    `${m.spokenWords} words spoken`,
    `${Math.round(m.voiceShare * 100)}% answered by voice`,
    m.skipped ? `${m.skipped} skipped` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

async function aiDecide(opts: {
  callName: string;
  stage: Stage;
  level: Level;
  today: DayMetrics;
  itemsText: string;
  history: string;
  ruleSuggestion: number;
}): Promise<AiDecision> {
  return chatJson<AiDecision>({
    role: "smart",
    maxTokens: 900,
    timeoutMs: 45_000,
    temperature: 0.2,
    schema: {
      name: "baseline_decision",
      schema: {
        type: "object",
        properties: {
          step: { type: "string", enum: ["more_support", "stay", "more_challenge"] },
          reason: { type: "string" },
          family_note: { type: "string" },
          focus_tomorrow: { type: "string" },
        },
        required: ["step", "reason", "family_note", "focus_tomorrow"],
        additionalProperties: false,
      },
    },
    messages: [
      {
        role: "system",
        content:
          `You set tomorrow's game level for ${opts.callName}, who lives with Alzheimer's and plays a few personal memory games each day. ` +
          "Levels run 1 to 5 inside each stage (early, middle, late); 5 asks the most. step: more_challenge (one level up), stay, or more_support (one level down). " +
          "Aim for games that feel successful most of the time (about 70 to 90 percent right on the first try at early and middle stage). Prefer stability: change only with a clear signal. " +
          "Late stage has no right answers: judge comfort and engagement (talking, finishing, not skipping). " +
          "reason: one or two plain sentences for the family explaining the decision. family_note: two or three warm sentences about today (what went well, what they enjoyed), no jargon, no diagnosis, no percentages. " +
          "focus_tomorrow: one practical sentence for tomorrow's game designer (which kinds or memories worked, what to ease off).",
      },
      {
        role: "user",
        content: [
          `Current: ${STAGE_LABEL[opts.stage]}, level ${opts.level}.`,
          `Today: ${describeMetrics(opts.today)}.`,
          `Items:\n${opts.itemsText}`,
          opts.history ? `Previous days (newest first):\n${opts.history}` : "No previous days yet.",
          `A simple rule would suggest: ${opts.ruleSuggestion > 0 ? "more_challenge" : opts.ruleSuggestion < 0 ? "more_support" : "stay"}.`,
        ].join("\n\n"),
      },
    ],
  });
}

const TREND: Record<-1 | 0 | 1, Baseline["trend"]> = { [-1]: "needs_more_support", 0: "steady", 1: "steadier" };

/** Decide the next baseline after a finished plan (idempotent per plan). */
export async function assessPlan(playerId: string, planId: string, callName: string): Promise<Baseline> {
  const existing = getDb().prepare("SELECT * FROM baselines WHERE plan_id = ?").get(planId) as BaselineRow | undefined;
  if (existing) return toBaseline(existing);
  const plan = getPlan(planId);
  if (!plan) throw new Error("Plan not found");
  const current = currentBaseline(playerId) ?? { stage: plan.stage, level: plan.level };
  const results = planResults(planId);
  const metrics = dayMetrics(results, planMinutes(planId));
  const rule = ruleStep(metrics, current.stage);

  const itemsText = plan.games
    .map((g) => {
      const lines = g.items.map((it) => {
        const r = results.find((x) => x.gameId === g.id && x.itemId === it.id);
        if (!r) return `  - "${it.prompt}": not reached`;
        return `  - "${it.prompt}": ${r.skipped ? "skipped" : r.scored ? (r.correct ? "right first time" : `${r.attempts} tries${r.revealed ? ", answer shown" : ""}`) : "taken part"}${r.hints ? `, ${r.hints} hint` : ""}${r.words ? `, said ${r.words} words` : ""}${r.responseMs ? `, ${(r.responseMs / 1000).toFixed(1)}s` : ""}`;
      });
      return `${g.title} (${g.kind}):\n${lines.join("\n")}`;
    })
    .join("\n");
  const history = baselineHistory(playerId, 7)
    .map((b) => `${b.createdAt.slice(0, 10)} ${STAGE_LABEL[b.stage]} L${b.level}${b.metrics ? `: ${describeMetrics(b.metrics)}` : ` (${b.decidedBy})`}`)
    .join("\n");

  let step: -1 | 0 | 1 = rule;
  let reason = "";
  let familyNote = "";
  let focus: string | null = null;
  let decidedBy: Baseline["decidedBy"] = "rules";
  try {
    const ai = await aiDecide({ callName, stage: current.stage, level: current.level, today: metrics, itemsText, history, ruleSuggestion: rule });
    const s: -1 | 0 | 1 = ai.step === "more_challenge" ? 1 : ai.step === "more_support" ? -1 : 0;
    step = Math.abs(s - rule) >= 2 ? 0 : s;
    reason = ai.reason.trim();
    familyNote = ai.family_note.trim();
    focus = ai.focus_tomorrow.trim() || null;
    decidedBy = "ai";
  } catch (err) {
    console.warn("[assess] AI decision failed, using the rule:", describeAiError(err));
  }
  const next = fromScale(toScale(current.stage, current.level) + step);
  if (!reason) {
    reason =
      step === 1
        ? `Today felt comfortable, so tomorrow's games ask a little more.`
        : step === -1
          ? `Today took more effort, so tomorrow's games give more support.`
          : `Today was about right, so tomorrow stays at the same level.`;
  }
  if (!familyNote) familyNote = `${callName} played ${metrics.items} activities today.`;
  return setBaseline(playerId, { stage: next.stage, level: next.level, trend: TREND[step], reason, familyNote, decidedBy, metrics, focus, planId });
}
