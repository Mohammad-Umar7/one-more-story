// The contract between a game screen, the voice engine and the interpreter.
// A screen describes what is on it and which actions are valid *right now*;
// Claude (or the local matcher when Claude is unavailable) maps the player's
// words to exactly one of those actions. Taps call the same screen actions.

import { contentWords, labelMatchScore, normalize, words } from "./text";

export type GameId = "home" | "memory_room" | "tell_the_story" | "show_me_your_street" | "companion" | "onboarding";

export interface ActionTarget {
  id: string;
  label: string;
  aliases?: string[];
}

export interface ActionSpec {
  name: string;
  description: string;
  targets?: ActionTarget[];
  phrases?: string[];
}

export interface ScreenContext {
  game: GameId;
  screen: string;
  /** Changes whenever the question changes; stale replies are dropped. */
  version: string;
  scene: string;
  question?: string;
  facts?: string[];
  actions: ActionSpec[];
  /** "conversation" screens treat free talk as content, not as a miss. */
  mode?: "commands" | "conversation";
  /** Action to use when the player is simply talking on a conversation screen. */
  talkAction?: string;
}

export interface ConversationTurn {
  role: "assistant" | "player";
  text: string;
}

export interface AgentRequest {
  context: ScreenContext;
  utterance: string;
  history: ConversationTurn[];
  playerName: string;
  /** How many clarifications were already asked for the current question. */
  clarifications: number;
}

export interface AgentDecision {
  action: string;
  target: string | null;
  say: string;
  needsClarification: boolean;
  source: "claude" | "local" | "fast-path";
  latencyMs?: number;
  note?: string;
}

export const GLOBAL_ACTIONS: ActionSpec[] = [
  {
    name: "pause",
    description: "The player wants a break, to wait, or to pause the game.",
    phrases: ["pause", "take a break", "hold on", "wait a minute", "give me a minute", "need a rest"],
  },
  {
    name: "end_session",
    description: "The player wants to stop for today, e.g. \"I'm done\", \"goodbye\", \"that's enough for today\".",
    phrases: ["i'm done", "i am done", "goodbye", "that's enough for today", "stop the game", "we're done"],
  },
  {
    name: "repeat",
    description: "The player asks to hear the last question again, or did not hear it.",
    phrases: ["say that again", "repeat", "what did you say", "pardon", "come again", "didn't hear"],
  },
  {
    name: "go_home",
    description: "The player wants the main screen or a different game.",
    phrases: ["go home", "main menu", "home screen", "different game", "another game"],
  },
  {
    name: "ignore",
    description:
      "Only when the words are plainly addressed to another person (they call someone else by name to ask them something) or they are on a phone call. Do nothing and say nothing. Never use this for talk about the picture, a memory, the game, or anything unclear.",
  },
  {
    name: "none",
    description:
      "No game action. Just reply: a short friendly answer, conversation, or one gentle clarifying question.",
  },
];

export function allActions(context: ScreenContext): ActionSpec[] {
  const own = context.actions.filter((a) => !GLOBAL_ACTIONS.some((g) => g.name === a.name));
  const globals = GLOBAL_ACTIONS.filter((g) => !(context.game === "home" && g.name === "go_home"));
  return [...own, ...globals];
}

// ---------------------------------------------------------------------------
// Fast path: a handful of safety commands are handled on the device instantly,
// without a network round trip ("I'm done" must always work).

const END_RE =
  /\b(i'?m|i am|we'?re|we are) (all )?(done|finished)( now| for (today|now|the day))?\b|\bgood ?bye\b|\bbye bye\b|\bthat'?s enough for today\b|\bstop the game\b|\bend the game\b/;
const PAUSE_RE = /^(please )?(pause|pause (it|the game|please)|wait|hold on|one moment|just a moment|give me a (minute|moment|second)|let me rest|i need a (break|rest)|take a break)\b/;
const REPEAT_RE = /\b(say (that|it) again|repeat (that|the question|it)|can you repeat|what did you say|pardon|come again|i didn'?t (hear|catch) (that|you))\b/;
const HOME_RE = /\b(go (back )?home|main menu|home screen|back to the start)\b/;

export function matchGlobalCommand(utterance: string, context: ScreenContext): AgentDecision | null {
  const text = normalize(utterance);
  const n = words(text).length;
  if (!text) return null;
  const make = (action: string): AgentDecision => ({
    action,
    target: null,
    say: "",
    needsClarification: false,
    source: "fast-path",
  });
  if (END_RE.test(text) && n <= 9) return make("end_session");
  if (PAUSE_RE.test(text) && n <= 6) return make("pause");
  if (REPEAT_RE.test(text) && n <= 8) return make("repeat");
  if (context.game !== "home" && HOME_RE.test(text) && n <= 7) return make("go_home");
  return null;
}

/** Words that should stop the agent mid-sentence even if they sound like echo. */
const INTERRUPT_RE = /^(stop|stop (it|talking|please)|please stop|quiet|be quiet|shh+|wait|hold on|enough|okay okay|ok ok|pause|i'?m done|i am done)$/;

export function isInterruptCommand(utterance: string): boolean {
  return INTERRUPT_RE.test(normalize(utterance));
}

// ---------------------------------------------------------------------------
// Validation: whatever the interpreter returns, only valid actions get through.

export function validateDecision(decision: AgentDecision, context: ScreenContext): AgentDecision {
  const specs = allActions(context);
  const spec = specs.find((a) => a.name === decision.action);
  if (!spec) {
    return { ...decision, action: "none", target: null, needsClarification: true, note: "invalid action" };
  }
  if (spec.targets && spec.targets.length > 0) {
    const ok = spec.targets.some((t) => t.id === decision.target);
    if (!ok) {
      return { ...decision, action: "none", target: null, needsClarification: true, note: "invalid target" };
    }
    return decision;
  }
  return { ...decision, target: null };
}

// ---------------------------------------------------------------------------
// Local interpreter: used when Claude is not configured, slow, or failing, so
// the game keeps working. Deliberately conservative: when unsure it asks.

const STORY_FOLLOW_UPS = [
  "What do you remember most about that?",
  "Who else was there with you?",
  "What was that like for you?",
  "Tell me a little more about that.",
  "What made that day special?",
];

const STREET_REPLIES = [
  "That sounds lovely. Tell me more about this place.",
  "I like hearing that. What else happened here?",
  "Thank you for showing me. What do you remember about it?",
];

function phraseScore(utterance: string, phrases: string[] = []): number {
  const text = normalize(utterance);
  let best = 0;
  for (const p of phrases) {
    const np = normalize(p);
    if (!np) continue;
    if (` ${text} `.includes(` ${np} `)) best = Math.max(best, 1);
    else {
      const pw = contentWords(np);
      if (pw.length > 0 && pw.every((w) => contentWords(text).includes(w))) best = Math.max(best, 0.85);
    }
  }
  return best;
}

function offerChoices(targets: ActionTarget[]): string {
  // Names ("My Memory Room") stay as they are; places get "the" ("the blue bowl").
  const labels = targets
    .slice(0, 3)
    .map((t) => (/^[A-Z]/.test(t.label) ? t.label : `the ${t.label.replace(/^the /i, "")}`));
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`;
}

const GREETING_RE = /^(hi|hello|hey|salaam|salam|assalamu alaikum|as salaam alaikum|good (morning|afternoon|evening)|how are you|how're you|how are things|thank you|thanks)\b/;

/** Small talk gets a warm reply, then the question again. Never a "sorry, I didn't catch that". */
function smallTalk(utterance: string, context: ScreenContext): AgentDecision | null {
  const text = normalize(utterance);
  if (!GREETING_RE.test(text) || words(text).length > 8) return null;
  const reply = /how are|how're/.test(text)
    ? "I'm very well, thank you for asking."
    : /thank/.test(text)
      ? "You're very welcome."
      : /salaam|salam|alaikum/.test(text)
        ? "Wa alaikum assalam. It's lovely to hear from you."
        : "Hello! It's lovely to hear from you.";
  return {
    action: "none",
    target: null,
    say: context.question ? `${reply} ${context.question}` : reply,
    needsClarification: false,
    source: "local",
  };
}

export function interpretLocally(req: AgentRequest): AgentDecision {
  const { context, utterance } = req;
  const fast = matchGlobalCommand(utterance, context);
  if (fast) return { ...fast, source: "local" };
  const chat = smallTalk(utterance, context);
  if (chat) return chat;

  type Candidate = { action: string; target: string | null; score: number; label?: string };
  const candidates: Candidate[] = [];
  const ambiguous: ActionTarget[] = [];

  for (const spec of context.actions) {
    if (spec.targets && spec.targets.length > 0) {
      const scored = spec.targets
        .map((t) => ({ t, s: labelMatchScore(utterance, t.label, t.aliases) }))
        .sort((a, b) => b.s - a.s);
      const top = scored[0];
      if (top && top.s >= 0.7) {
        const runnerUp = scored[1];
        if (runnerUp && runnerUp.s >= 0.7 && top.s - runnerUp.s < 0.1) {
          ambiguous.push(top.t, runnerUp.t);
        } else {
          candidates.push({ action: spec.name, target: top.t.id, score: top.s, label: top.t.label });
        }
      }
      const ps = phraseScore(utterance, spec.phrases);
      if (ps > 0 && spec.targets.length === 1) {
        candidates.push({ action: spec.name, target: spec.targets[0].id, score: ps * 0.9 });
      }
    } else {
      const ps = phraseScore(utterance, spec.phrases);
      if (ps > 0) candidates.push({ action: spec.name, target: null, score: ps });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  if (best && best.score >= 0.7 && ambiguous.length === 0) {
    return { action: best.action, target: best.target, say: "", needsClarification: false, source: "local" };
  }

  if (ambiguous.length >= 2) {
    return {
      action: "none",
      target: null,
      say: `Sorry, I want to get this right. Did you mean ${offerChoices(ambiguous)}?`,
      needsClarification: true,
      source: "local",
    };
  }

  // Conversation screens: the player is sharing, which is exactly the point.
  if (context.mode === "conversation") {
    const turnCount = req.history.filter((h) => h.role === "player").length;
    if (context.game === "tell_the_story") {
      return {
        action: context.talkAction ?? "none",
        target: null,
        say: STORY_FOLLOW_UPS[turnCount % STORY_FOLLOW_UPS.length],
        needsClarification: false,
        source: "local",
      };
    }
    const go = context.actions.find((a) => a.name === "go");
    const where = go?.targets?.length ? ` Which way shall we go next: ${offerChoices(go.targets)}?` : "";
    return {
      action: context.talkAction ?? "none",
      target: null,
      say: turnCount % 2 === 1 && where ? `That's lovely.${where}` : STREET_REPLIES[turnCount % STREET_REPLIES.length],
      needsClarification: false,
      source: "local",
    };
  }

  const targeted = context.actions.find((a) => a.targets && a.targets.length > 0);
  const offer = targeted?.targets ? offerChoices(targeted.targets) : "";
  const say =
    req.clarifications >= 1
      ? "That's all right. You can also tap your answer on the screen."
      : offer
        ? `Sorry, I didn't quite catch that. Was it ${offer}? You can tap it too.`
        : "Sorry, I didn't quite catch that. Could you say it once more?";
  return { action: "none", target: null, say, needsClarification: true, source: "local" };
}
