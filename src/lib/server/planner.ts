// Today's games. Every day Claude writes a fresh set of personal games from
// the life story, at the player's current stage and level, steering clear of
// anything the family marked as gentle. The server then checks every game
// against the stage rules (how many games, items and choices; which kinds are
// allowed; the right answer really is one of the choices) and fills in the
// pictures and real family recordings. If the AI can't be reached, a
// rule-based plan is built from the same memories, so the games always work.

import crypto from "node:crypto";
import { getDb, nowIso, uid } from "./db";
import { chatJson, describeAiError } from "./openrouter";
import { lifeDigest, listMemories } from "./life";
import {
  choicesFor,
  isCalmKind,

  KIND_LABEL,
  STAGE_RULES,
  type Companion,
  type DailyPlan,
  type Game,
  type GameChoice,
  type GameItem,
  type GameKind,
  type Level,
  type Memory,
  type Stage,
} from "../shared/companion";

export interface PlanContext {
  playerId: string;
  playerName: string;
  callName: string;
  pronoun: string;
  companion: Companion | null;
  stage: Stage;
  level: Level;
  focus: string | null;
}

/** YYYY-MM-DD in the server's local time zone. */
export function localDay(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function tomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return localDay(d);
}

// ---- storage ---------------------------------------------------------------------

interface PlanRow {
  id: string;
  player_id: string;
  day: string;
  stage: Stage;
  level: number;
  plan: string;
  source: "ai" | "fallback";
  status: DailyPlan["status"];
  created_at: string;
}

function toPlan(r: PlanRow): DailyPlan {
  const body = JSON.parse(r.plan) as Pick<DailyPlan, "greeting" | "closing" | "games">;
  return {
    id: r.id,
    day: r.day,
    stage: r.stage,
    level: r.level as Level,
    greeting: body.greeting,
    closing: body.closing,
    games: body.games,
    source: r.source,
    status: r.status,
    createdAt: r.created_at,
  };
}

export function getPlan(id: string): DailyPlan | null {
  const r = getDb().prepare("SELECT * FROM daily_plans WHERE id = ?").get(id) as PlanRow | undefined;
  return r ? toPlan(r) : null;
}

/** The newest plan for a day (any status). */
export function latestPlanFor(playerId: string, day: string): DailyPlan | null {
  const r = getDb()
    .prepare("SELECT * FROM daily_plans WHERE player_id = ? AND day = ? ORDER BY created_at DESC LIMIT 1")
    .get(playerId, day) as PlanRow | undefined;
  return r ? toPlan(r) : null;
}

export function recentPlans(playerId: string, limit = 5): DailyPlan[] {
  const rows = getDb()
    .prepare("SELECT * FROM daily_plans WHERE player_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(playerId, limit) as unknown as PlanRow[];
  return rows.map(toPlan);
}

function savePlan(playerId: string, day: string, stage: Stage, level: Level, body: Pick<DailyPlan, "greeting" | "closing" | "games">, source: "ai" | "fallback"): DailyPlan {
  const id = uid("plan");
  getDb()
    .prepare("INSERT INTO daily_plans (id, player_id, day, stage, level, plan, source, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?)")
    .run(id, playerId, day, stage, level, JSON.stringify(body), source, nowIso());
  return getPlan(id)!;
}

export function markPlan(id: string, status: "playing" | "done"): void {
  if (status === "playing") getDb().prepare("UPDATE daily_plans SET status = 'playing', started_at = COALESCE(started_at, ?) WHERE id = ? AND status = 'ready'").run(nowIso(), id);
  else getDb().prepare("UPDATE daily_plans SET status = 'done', completed_at = COALESCE(completed_at, ?) WHERE id = ?").run(nowIso(), id);
}

// ---- helpers -------------------------------------------------------------------------

const short = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pictureOf(m: Memory | undefined): string | null {
  return m?.photo?.url ?? m?.art?.url ?? null;
}

function firstSentence(text: string): string {
  const i = text.search(/[.!?]\s/);
  return i === -1 ? text : text.slice(0, i + 1);
}

function cid(): string {
  return `c${crypto.randomBytes(4).toString("hex")}`;
}

// ---- validation: whatever the AI wrote, the player gets a fair, safe game ----------

interface RawChoice {
  label: string;
  emoji: string;
  memory_id: string;
}

interface RawItem {
  memory_id: string;
  prompt: string;
  narration: string;
  use_clip: boolean;
  picture: "memory" | "companion_photo" | "none";
  choices: RawChoice[];
  answer_index: number;
  order: number[];
  hint: string;
  praise: string;
  reveal: string;
}

interface RawGame {
  kind: GameKind;
  title: string;
  intro: string;
  items: RawItem[];
}

interface RawPlan {
  greeting: string;
  closing: string;
  games: RawGame[];
}

export function validatePlan(raw: RawPlan, ctx: PlanContext, memories: Memory[]): Pick<DailyPlan, "greeting" | "closing" | "games"> | null {
  const rules = STAGE_RULES[ctx.stage];
  const byId = new Map(memories.map((m) => [m.id, m]));
  const maxChoices = choicesFor(ctx.stage, ctx.level);
  const games: Game[] = [];
  const companionPhoto = ctx.companion?.photoUrl ?? ctx.companion?.avatarUrl ?? null;

  for (const g of (raw.games ?? []).slice(0, rules.games[1] + 1)) {
    if (!rules.kinds.includes(g.kind)) continue;
    if (games.length >= rules.games[1]) break;
    const items: GameItem[] = [];

    for (const it of (g.items ?? []).slice(0, isCalmKind(g.kind) ? 1 : rules.items[1])) {
      const mem = it.memory_id ? byId.get(it.memory_id) : undefined;
      const prompt = short(it.prompt, 160);
      if (!prompt) continue;
      let imageUrl: string | null = null;
      if (it.picture === "companion_photo") imageUrl = companionPhoto;
      else if (it.picture === "memory") imageUrl = pictureOf(mem);

      let choices: GameChoice[] = [];
      let answerId: string | null = null;
      let order: string[] | null = null;

      if (!isCalmKind(g.kind) && g.kind !== "reminisce") {
        const seen = new Set<string>();
        const all = (it.choices ?? [])
          .map((c, i) => ({
            i,
            choice: {
              id: cid(),
              label: short(c.label, 48),
              emoji: short(c.emoji, 8) || null,
              imageUrl: c.memory_id ? pictureOf(byId.get(c.memory_id)) : null,
            } satisfies GameChoice,
          }))
          .filter(({ choice }) => {
            const k = choice.label.toLowerCase();
            if (!k || seen.has(k)) return false;
            seen.add(k);
            return true;
          });
        if (g.kind === "sequence") {
          // Three moments in time; the AI gives the right order as indexes.
          const okOrder = Array.isArray(it.order) && it.order.length === all.length && new Set(it.order).size === all.length && it.order.every((n) => all.some((a) => a.i === n));
          if (!okOrder || all.length < 3) continue;
          const kept = all.slice(0, 3);
          if (!it.order.slice(0, 3).every((n) => kept.some((k) => k.i === n))) continue;
          order = it.order.slice(0, 3).map((n) => kept.find((k) => k.i === n)!.choice.id);
          choices = shuffle(kept.map((k) => k.choice));
        } else {
          const answer = all.find((a) => a.i === it.answer_index);
          const minChoices = ctx.stage === "late" ? 1 : 2;
          if (!answer || all.length < minChoices) continue;
          const others = shuffle(all.filter((a) => a !== answer)).slice(0, Math.max(0, maxChoices - 1));
          choices = shuffle([answer, ...others].map((a) => a.choice));
          answerId = answer.choice.id;
        }
      }

      items.push({
        id: `i${items.length + 1}`,
        prompt,
        narration: short(it.narration, 420) || null,
        clipUrl: it.use_clip && mem?.clip && (mem.clip.durationMs ?? 0) <= 120_000 ? mem.clip.url : null,
        clipBy: it.use_clip && mem?.clip ? mem.clip.by : null,
        imageUrl,
        choices,
        answerId,
        order,
        hint: short(it.hint, 200) || "Take your time. Have a good look.",
        praise: short(it.praise, 200) || "Yes, that's it. Lovely.",
        reveal: short(it.reveal, 220) || "Let me show you. Here it is.",
        memoryId: mem?.id ?? null,
      });
    }
    if (!items.length && !isCalmKind(g.kind)) continue;
    if (isCalmKind(g.kind) && !items.length) {
      items.push(calmItem(g.kind, ctx));
    }
    games.push({
      id: `g${games.length + 1}`,
      kind: g.kind,
      title: short(g.title, 40) || KIND_LABEL[g.kind],
      intro: short(g.intro, 200) || "Here's our next game.",
      items,
    });
  }
  if (!games.length) return null;
  return {
    greeting: short(raw.greeting, 260) || `Good to see you, ${ctx.callName}.`,
    closing: short(raw.closing, 260) || `That was lovely, ${ctx.callName}. Thank you for playing with me.`,
    games,
  };
}

function calmItem(kind: GameKind, ctx: PlanContext): GameItem {
  return {
    id: "i1",
    prompt: kind === "sparkle" ? "Touch the stars as they glow." : "Breathe in slowly as the circle grows, and out as it gets smaller.",
    narration: null,
    clipUrl: null,
    clipBy: null,
    imageUrl: null,
    choices: [],
    answerId: null,
    order: null,
    hint: kind === "sparkle" ? "Look for the brightest star and touch it." : "Just follow the circle. In, and out.",
    praise: kind === "sparkle" ? `Beautiful, ${ctx.callName}. You caught them all.` : "Lovely. Nice and calm.",
    reveal: "",
    memoryId: null,
  };
}

// ---- the AI planner ---------------------------------------------------------------

const CHOICE_SCHEMA = {
  type: "object",
  properties: {
    label: { type: "string" },
    emoji: { type: "string" },
    memory_id: { type: "string" },
  },
  required: ["label", "emoji", "memory_id"],
  additionalProperties: false,
};

const ITEM_SCHEMA = {
  type: "object",
  properties: {
    memory_id: { type: "string" },
    prompt: { type: "string" },
    narration: { type: "string" },
    use_clip: { type: "boolean" },
    picture: { type: "string", enum: ["memory", "companion_photo", "none"] },
    choices: { type: "array", items: CHOICE_SCHEMA },
    answer_index: { type: "integer" },
    order: { type: "array", items: { type: "integer" } },
    hint: { type: "string" },
    praise: { type: "string" },
    reveal: { type: "string" },
  },
  required: ["memory_id", "prompt", "narration", "use_clip", "picture", "choices", "answer_index", "order", "hint", "praise", "reveal"],
  additionalProperties: false,
};

function planSchema(kinds: GameKind[]) {
  return {
    type: "object",
    properties: {
      greeting: { type: "string" },
      closing: { type: "string" },
      games: {
        type: "array",
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: kinds },
            title: { type: "string" },
            intro: { type: "string" },
            items: { type: "array", items: ITEM_SCHEMA },
          },
          required: ["kind", "title", "intro", "items"],
          additionalProperties: false,
        },
      },
    },
    required: ["greeting", "closing", "games"],
    additionalProperties: false,
  };
}

const KIND_GUIDE = `Game kinds
- who_is_this: show a picture, ask who or what it is. With picture "companion_photo" the answer is the companion's own name (the photo is the real person). With picture "memory" use the memory's picture. Choices are names or short labels.
- story_recall: narration is a short story (2 to 4 sentences) told from one memory, or use_clip true to play the family's own recording of it (only when that memory has a recording). Then ONE question about the story, with choices.
- finish_memory: prompt is a sentence from their life with the end missing, said naturally ("You grew up in a house near the..."). Choices finish it. Use the memory facts.
- sequence: three moments from their life (choices) to put in order; order lists the choice indexes from earliest to latest. Early stage only, only with clear dates or life order.
- favorites: "Which of these do you love?" with things they love plus friendly alternatives; the answer is the real favourite. Warm, never a test in tone.
- reminisce: show a memory's picture, narration tells it warmly in a few sentences, prompt is ONE open question inviting them to talk ("What do you remember about that day?"). No choices, answer_index -1.
- sparkle / breathe: calm moments. One item with a gentle prompt, no choices, answer_index -1.`;

function systemPrompt(ctx: PlanContext): string {
  const rules = STAGE_RULES[ctx.stage];
  const who = ctx.companion ? `${ctx.companion.name} (${ctx.callName}'s ${ctx.companion.relation.toLowerCase()})` : "a warm family companion";
  return `You design today's personal memory games for ${ctx.playerName}, called "${ctx.callName}" by the family (pronoun ${ctx.pronoun}), who lives with Alzheimer's.
The games are spoken aloud by ${who}, whose face and voice the player sees and hears. Everything you write is said out loud by them, so write it the way they would talk to ${ctx.callName}: warm, simple, adult, never childish.

Today: ${rules.summary}
Level ${ctx.level} of 5 inside this stage (5 asks the most). Exactly ${rules.games[0] === rules.games[1] ? rules.games[0] : `${rules.games[0]} to ${rules.games[1]}`} games, ${rules.items[0]} to ${rules.items[1]} items each (sparkle and breathe have one item). Each scored item has ${choicesFor(ctx.stage, ctx.level)} choices (give one more as a spare).
${ctx.focus ? `Focus from yesterday's review: ${ctx.focus}\n` : ""}
${KIND_GUIDE}

Writing rules
- Build everything from the life story below. Use memory ids exactly as given (memory_id, and on choices when that choice IS a memory with a picture), "" when none.
- Never invent facts about their life. Right answers must come from the life story. Wrong choices must be clearly wrong but believable, and must never be the names of real family members in a way that could confuse who is who.
- Never touch anything in the gentle list. Never mention illness, memory loss, tests, scores or mistakes.
- Prompts: one short sentence, under 14 words. Narration: under 60 words. Hint: a gentle clue that helps without giving the answer away. Praise: specific and warm, under 18 words. Reveal: kindly says the answer with a warm detail, under 25 words, never "wrong".
- Emoji: one fitting emoji per choice ("" if nothing fits).
- greeting: one or two sentences to open the day (the date and a warm word, no question). closing: one or two warm sentences to end.
- Vary the games: avoid repeating yesterday's kinds and memories when possible.`;
}

async function aiPlan(ctx: PlanContext, memories: Memory[], gentle: Memory[]): Promise<RawPlan> {
  const recent = recentPlans(ctx.playerId, 2)
    .map((p) => `${p.day}: ${p.games.map((g) => `${g.kind}(${g.items.map((i) => i.memoryId).filter(Boolean).join(",")})`).join(" ")}`)
    .join("\n");
  const today = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  return chatJson<RawPlan>({
    role: "smart",
    maxTokens: 7000,
    timeoutMs: 120_000,
    temperature: 0.7,
    schema: { name: "daily_plan", schema: planSchema(STAGE_RULES[ctx.stage].kinds) },
    messages: [
      { role: "system", content: systemPrompt(ctx) },
      {
        role: "user",
        content: [
          `Today is ${today}.`,
          ctx.companion ? `Companion: ${ctx.companion.name}, ${ctx.companion.relation}. Their real photo is available (picture "companion_photo").` : "",
          "Life story (id, kind, title, detail, extras):",
          lifeDigest(memories) || "(very little yet: lean on reminisce, favorites and calm games)",
          gentle.length ? `Gentle list (never mention): ${gentle.map((g) => `${g.title}: ${g.detail}`).join(" | ")}` : "",
          recent ? `Recent days:\n${recent}` : "",
          "Write today's plan.",
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
  });
}

// ---- the rule-based plan (no AI needed) -------------------------------------------

export function fallbackPlan(ctx: PlanContext, memories: Memory[]): Pick<DailyPlan, "greeting" | "closing" | "games"> {
  const rules = STAGE_RULES[ctx.stage];
  const n = choicesFor(ctx.stage, ctx.level);
  const games: Game[] = [];
  const name = ctx.companion?.name ?? "your family";
  const withFacts = shuffle(memories.filter((m) => m.facts.length));
  const pictured = shuffle(memories.filter((m) => m.art || m.photo));

  const factItem = (m: Memory, idx: number): GameItem => {
    const f = m.facts[0];
    const options = shuffle([f.answer, ...shuffle(f.distractors).slice(0, Math.max(0, n - 1))]);
    const choices = options.map((label) => ({ id: cid(), label, emoji: null, imageUrl: null }));
    return {
      id: `i${idx + 1}`,
      prompt: f.prompt,
      narration: null,
      clipUrl: null,
      clipBy: null,
      imageUrl: pictureOf(m),
      choices,
      answerId: choices.find((c) => c.label === f.answer)!.id,
      order: null,
      hint: `Think about ${m.title.toLowerCase()}.`,
      praise: `Yes, ${f.answer}. That's right.`,
      reveal: `It was ${f.answer}. ${firstSentence(m.detail)}`,
      memoryId: m.id,
    };
  };

  if (ctx.stage !== "late" && withFacts.length) {
    games.push({
      id: "g1",
      kind: "finish_memory",
      title: "Your story",
      intro: "Let's remember a few things from your life together.",
      items: withFacts.slice(0, rules.items[1]).map(factItem),
    });
  }

  const people = Array.from(new Set(memories.flatMap((m) => m.people))).filter((p) => p !== ctx.companion?.name);
  if (ctx.companion?.photoUrl && (ctx.stage === "late" || people.length >= 1)) {
    const names = ctx.stage === "late" ? [ctx.companion.name] : shuffle([ctx.companion.name, ...people.slice(0, n - 1)]);
    const choices = names.map((label) => ({ id: cid(), label, emoji: null, imageUrl: null }));
    games.push({
      id: `g${games.length + 1}`,
      kind: "who_is_this",
      title: "Who is this?",
      intro: "Have a look at this photo.",
      items: [
        {
          id: "i1",
          prompt: ctx.stage === "late" ? `This is ${ctx.companion.name}. Touch the name to say hello.` : "Who is this?",
          narration: null,
          clipUrl: null,
          clipBy: null,
          imageUrl: ctx.companion.photoUrl,
          choices,
          answerId: choices.find((c) => c.label === ctx.companion!.name)!.id,
          order: null,
          hint: `It's your ${ctx.companion.relation.toLowerCase()}.`,
          praise: `Yes! It's me, ${ctx.companion.name}.`,
          reveal: `It's me, ${ctx.companion.name}, your ${ctx.companion.relation.toLowerCase()}.`,
          memoryId: null,
        },
      ],
    });
  }

  if (pictured.length) {
    games.push({
      id: `g${games.length + 1}`,
      kind: "reminisce",
      title: "Remember when",
      intro: `${name} told me some lovely stories about you.`,
      items: pictured.slice(0, Math.min(2, rules.items[1])).map((m, i) => ({
        id: `i${i + 1}`,
        prompt: "What do you remember about that?",
        narration: m.detail,
        clipUrl: m.clip && (m.clip.durationMs ?? 0) <= 90_000 && ctx.stage !== "late" ? m.clip.url : null,
        clipBy: m.clip?.by ?? null,
        imageUrl: pictureOf(m),
        choices: [],
        answerId: null,
        order: null,
        hint: "Anything at all. There's no wrong answer.",
        praise: "Thank you for telling me. I love hearing about it.",
        reveal: "",
        memoryId: m.id,
      })),
    });
  }

  const calm: GameKind = ctx.stage === "late" ? "breathe" : "sparkle";
  if (games.length < rules.games[1] && rules.kinds.includes(calm)) {
    games.push({ id: `g${games.length + 1}`, kind: calm, title: KIND_LABEL[calm], intro: "Let's take a calm moment together.", items: [calmItem(calm, ctx)] });
  }
  if (!games.length) {
    games.push({ id: "g1", kind: "sparkle", title: KIND_LABEL.sparkle, intro: "Let's start with something gentle.", items: [calmItem("sparkle", ctx)] });
  }
  return {
    greeting: `Hello ${ctx.callName}. It's lovely to be with you today.`,
    closing: `That was wonderful, ${ctx.callName}. Thank you for spending this time with me.`,
    games: games.slice(0, rules.games[1]),
  };
}

// ---- entry point --------------------------------------------------------------------

type GlobalPlans = typeof globalThis & { __omsPlanning?: Map<string, Promise<DailyPlan>> };

function inflight(): Map<string, Promise<DailyPlan>> {
  const g = globalThis as GlobalPlans;
  g.__omsPlanning ??= new Map();
  return g.__omsPlanning;
}

/** Make a new plan for `day` (one at a time per player and day). */
export function makePlan(ctx: PlanContext, day = localDay()): Promise<DailyPlan> {
  const key = `${ctx.playerId}|${day}`;
  const running = inflight().get(key);
  if (running) return running;
  const p = (async () => {
    const all = listMemories(ctx.playerId);
    const gentle = all.filter((m) => m.kind === "gentle");
    const memories = all.filter((m) => m.kind !== "gentle");
    try {
      const raw = await aiPlan(ctx, memories, gentle);
      const body = validatePlan(raw, ctx, memories);
      if (body) return savePlan(ctx.playerId, day, ctx.stage, ctx.level, body, "ai");
      console.warn("[planner] the AI plan had no usable games; using the rule-based plan");
    } catch (err) {
      console.warn("[planner] AI plan failed:", describeAiError(err));
    }
    return savePlan(ctx.playerId, day, ctx.stage, ctx.level, fallbackPlan(ctx, memories), "fallback");
  })().finally(() => inflight().delete(key));
  inflight().set(key, p);
  return p;
}

export function isPlanning(playerId: string, day = localDay()): boolean {
  return inflight().has(`${playerId}|${day}`);
}
