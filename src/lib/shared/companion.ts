// The companion: a familiar face and voice that leads the player through a
// few personal games every day. Shapes and rules shared by the server (plan
// generation, validation, baselines) and the client (the player's screen).

export type Stage = "early" | "middle" | "late";
export const STAGES: Stage[] = ["early", "middle", "late"];

export const STAGE_LABEL: Record<Stage, string> = {
  early: "Early stage",
  middle: "Middle stage",
  late: "Late stage",
};

/** Level 1..5 inside a stage; 5 asks the most of the player. */
export type Level = 1 | 2 | 3 | 4 | 5;

export interface Baseline {
  id: string;
  stage: Stage;
  level: Level;
  trend: "first" | "steadier" | "steady" | "needs_more_support";
  reason: string; // plain words for the family
  familyNote: string; // short note about today
  decidedBy: "onboarding" | "ai" | "rules" | "family";
  createdAt: string;
}

/**
 * One continuous scale across stages, so a daily change of one step can roll
 * over from "early, level 1" to "middle, level 5". 15 = early level 5 (asks
 * the most), 1 = late level 1 (the most support).
 */
export function toScale(stage: Stage, level: Level): number {
  const base = stage === "early" ? 10 : stage === "middle" ? 5 : 0;
  return base + level;
}

export function fromScale(n: number): { stage: Stage; level: Level } {
  const v = Math.max(1, Math.min(15, Math.round(n)));
  if (v > 10) return { stage: "early", level: (v - 10) as Level };
  if (v > 5) return { stage: "middle", level: (v - 5) as Level };
  return { stage: "late", level: v as Level };
}

// ---- life story -------------------------------------------------------------

export type MemoryKind = "person" | "place" | "event" | "favorite" | "routine" | "gentle";

/** A question the family's own words can answer, with believable wrong options. */
export interface MemoryFact {
  prompt: string; // "Where did you and Amina get married?"
  answer: string; // "Lahore"
  distractors: string[]; // ["Karachi", "Dubai", "London"]
}

export interface Memory {
  id: string;
  kind: MemoryKind;
  title: string;
  detail: string;
  people: string[];
  place: string | null;
  era: string | null;
  facts: MemoryFact[];
  photo: { id: string; url: string } | null;
  art: { id: string; url: string } | null;
  artStatus: "none" | "working" | "ready" | "failed";
  clip: { id: string; url: string; durationMs: number | null; by: string | null } | null;
  source: "interview" | "family" | "patient";
  addedBy: string | null;
  createdAt: string;
}

// ---- the companion's face and voice ---------------------------------------

export const VOICE_LINES = [
  { key: "hello", label: "Saying hello", template: "Hello {call}, it's me, {member}!" },
  { key: "lets_play", label: "Starting a game", template: "Let's play a little game together." },
  { key: "well_done", label: "Praise", template: "Well done, {call}! I'm so proud of you." },
  { key: "take_time", label: "Reassurance", template: "Take your time. There's no rush." },
  { key: "its_okay", label: "When it's hard", template: "That's okay. Let's try another one." },
  { key: "love_you", label: "Goodbye", template: "I love you, {call}. See you tomorrow." },
] as const;

export type VoiceLineKey = (typeof VOICE_LINES)[number]["key"];

export function fillLine(template: string, call: string, member: string): string {
  return template.replace(/\{call\}/g, call).replace(/\{member\}/g, member);
}

export interface Companion {
  memberId: string;
  name: string; // "Ahmed"
  relation: string; // "Son"
  avatarUrl: string | null; // AI avatar, or the real photo if the family chose it
  photoUrl: string | null;
  avatarStatus: "none" | "working" | "ready" | "failed";
  lines: Partial<Record<VoiceLineKey, { url: string; text: string }>>;
  voice: { name: string | null; summary: string | null; cloned: boolean };
}

// ---- daily games -----------------------------------------------------------

export type GameKind =
  | "who_is_this" // a face or a picture, pick the name
  | "story_recall" // hear a short story, answer one question about it
  | "finish_memory" // finish a sentence from their life
  | "sequence" // put three moments in order (early stage only)
  | "favorites" // which of these do you love? (gentle, personal)
  | "reminisce" // look, listen, talk: no right or wrong
  | "sparkle" // touch the glowing stars: calm, errorless
  | "breathe"; // breathe with the circle: calm, errorless

export const KIND_LABEL: Record<GameKind, string> = {
  who_is_this: "Who is this?",
  story_recall: "Story time",
  finish_memory: "Finish the memory",
  sequence: "In order",
  favorites: "Things you love",
  reminisce: "Remember when",
  sparkle: "Catch the stars",
  breathe: "Breathe with me",
};

export interface GameChoice {
  id: string;
  label: string;
  emoji: string | null;
  imageUrl: string | null;
}

export interface GameItem {
  id: string;
  prompt: string; // spoken and shown: "Who is this?"
  narration: string | null; // spoken first (a short story)
  clipUrl: string | null; // a real family recording played first
  clipBy: string | null; // who recorded it
  imageUrl: string | null; // the main picture
  choices: GameChoice[]; // empty for reminisce / sparkle / breathe
  answerId: string | null; // the right choice (null when there is no right answer)
  order: string[] | null; // sequence: choice ids in the right order
  hint: string; // spoken when they ask for help or after a miss
  praise: string; // spoken after a right answer
  reveal: string; // spoken after the second miss, kindly
  memoryId: string | null;
}

export interface Game {
  id: string;
  kind: GameKind;
  title: string;
  intro: string; // one line said before the first item
  items: GameItem[];
}

export interface DailyPlan {
  id: string;
  day: string; // YYYY-MM-DD (local to the server)
  stage: Stage;
  level: Level;
  greeting: string;
  closing: string;
  games: Game[];
  source: "ai" | "fallback";
  status: "ready" | "playing" | "done";
  createdAt: string;
}

/** What the player did on one item. */
export interface ItemResult {
  gameId: string;
  itemId: string;
  kind: GameKind;
  scored: boolean;
  correct: boolean; // right on the first try
  attempts: number;
  hints: number;
  revealed: boolean;
  responseMs: number | null; // from the end of the question to the first answer
  spoke: boolean; // answered or talked by voice
  words: number; // words spoken (reminisce)
  skipped: boolean;
}

export interface DayMetrics {
  items: number;
  scored: number;
  firstTry: number;
  accuracy: number | null; // firstTry / scored
  hints: number;
  reveals: number;
  medianResponseMs: number | null;
  spokenWords: number;
  voiceShare: number; // share of items answered by voice
  skipped: number;
  minutes: number;
}

// ---- how each stage plays ----------------------------------------------------

export interface StageRules {
  games: [number, number]; // min, max games per day
  items: [number, number]; // per game
  choices: [number, number]; // per scored item
  kinds: GameKind[]; // allowed kinds
  scoredKinds: GameKind[];
  summary: string; // for the plan prompt
}

export const STAGE_RULES: Record<Stage, StageRules> = {
  early: {
    games: [3, 3],
    items: [3, 4],
    choices: [3, 4],
    kinds: ["who_is_this", "story_recall", "finish_memory", "sequence", "favorites", "reminisce"],
    scoredKinds: ["who_is_this", "story_recall", "finish_memory", "sequence"],
    summary:
      "Early stage: they can recall with a little effort. Use real recall (story_recall, finish_memory, sequence, who_is_this) with 3 or 4 choices whose distractors are believable. Keep one reminisce or favorites game for warmth.",
  },
  middle: {
    games: [3, 3],
    items: [3, 3],
    choices: [2, 3],
    kinds: ["who_is_this", "story_recall", "finish_memory", "favorites", "reminisce", "sparkle"],
    scoredKinds: ["who_is_this", "story_recall", "finish_memory"],
    summary:
      "Middle stage: recognition, not recall. Pictures first, 2 or 3 clearly different choices, short sentences, generous hints. No sequence games. Mix one recognition game, one story game and one warm reminisce or favorites game.",
  },
  late: {
    games: [2, 3],
    items: [2, 3],
    choices: [1, 2],
    kinds: ["who_is_this", "favorites", "reminisce", "sparkle", "breathe"],
    scoredKinds: [],
    summary:
      "Late stage: comfort, not testing. Errorless games only: one or two choices where any answer is celebrated, the family's voice and pictures, slow calm pacing. Use reminisce, sparkle and breathe; who_is_this only with one or two pictures and the answer said out loud first.",
  },
};

/** Level fine-tunes inside a stage: higher levels ask a little more. */
export function choicesFor(stage: Stage, level: Level): number {
  const [lo, hi] = STAGE_RULES[stage].choices;
  return level >= 4 ? hi : level <= 2 ? lo : Math.round((lo + hi) / 2);
}

export function isScored(stage: Stage, kind: GameKind): boolean {
  return STAGE_RULES[stage].scoredKinds.includes(kind);
}

/** Calm kinds have no items to answer: the player just takes part. */
export function isCalmKind(kind: GameKind): boolean {
  return kind === "sparkle" || kind === "breathe";
}

// ---- metrics ------------------------------------------------------------------

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export function dayMetrics(results: ItemResult[], minutes: number): DayMetrics {
  const scored = results.filter((r) => r.scored && !r.skipped);
  const firstTry = scored.filter((r) => r.correct).length;
  const times = results.map((r) => r.responseMs).filter((v): v is number => typeof v === "number" && v > 0);
  return {
    items: results.length,
    scored: scored.length,
    firstTry,
    accuracy: scored.length ? Math.round((firstTry / scored.length) * 100) / 100 : null,
    hints: results.reduce((n, r) => n + r.hints, 0),
    reveals: results.filter((r) => r.revealed).length,
    medianResponseMs: median(times),
    spokenWords: results.reduce((n, r) => n + r.words, 0),
    voiceShare: results.length ? Math.round((results.filter((r) => r.spoke).length / results.length) * 100) / 100 : 0,
    skipped: results.filter((r) => r.skipped).length,
    minutes: Math.round(minutes * 10) / 10,
  };
}

/**
 * The rule-based step used when the AI can't be reached (and as a guard on
 * the AI's own decision): +1 when today was comfortable, -1 when it was a
 * struggle, otherwise stay.
 */
export function ruleStep(m: DayMetrics, stage: Stage): -1 | 0 | 1 {
  if (m.items === 0) return 0;
  if (stage === "late" || m.scored === 0) {
    // No right or wrong answers: engagement is the signal.
    if (m.skipped >= Math.ceil(m.items / 2)) return -1;
    if (m.spokenWords >= 25 && m.skipped === 0) return 1;
    return 0;
  }
  const acc = m.accuracy ?? 0;
  const revealRate = m.reveals / Math.max(1, m.scored);
  if (acc >= 0.85 && revealRate === 0 && m.hints <= Math.floor(m.scored / 4)) return 1;
  if (acc < 0.5 || revealRate >= 0.34) return -1;
  return 0;
}

// ---- onboarding: the stage check --------------------------------------------

export const STAGE_CHECK = [
  { key: "faces", question: "Do they recognise close family members?" },
  { key: "conversation", question: "Can they follow and join in a conversation?" },
  { key: "today", question: "Do they remember things from earlier today?" },
  { key: "reading", question: "Can they read a short sentence and understand it?" },
  { key: "daily", question: "Do they manage dressing, eating and washing on their own?" },
] as const;

export const STAGE_CHECK_SCALE = ["Always", "Usually", "Sometimes", "Rarely"] as const;

export type DoctorSaid = Stage | "unsure";

/** 0..15 from the five answers (0 = always, 3 = rarely), plus what the doctor said. */
export function initialBaseline(answers: number[], doctor: DoctorSaid): { stage: Stage; level: Level } {
  const score = answers.slice(0, 5).reduce((n, a) => n + Math.max(0, Math.min(3, Math.round(a))), 0);
  // Map 0..15 onto the 15-step scale, high score = more support.
  const fromAnswers = 15 - score;
  if (doctor === "unsure") return fromScale(fromAnswers);
  // The doctor's stage wins; the answers place the level inside it.
  const inStage = fromScale(fromAnswers);
  if (inStage.stage === doctor) return inStage;
  const order = STAGES.indexOf(doctor) - STAGES.indexOf(inStage.stage);
  return { stage: doctor, level: order > 0 ? 5 : 1 };
}
