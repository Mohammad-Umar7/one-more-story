import Anthropic from "@anthropic-ai/sdk";
import { allActions, type AgentDecision, type AgentRequest } from "../shared/agent";
import { chatJson, isOpenRouterConfigured, modelFor } from "./openrouter";

// Conversation and game actions go to Claude: directly with an Anthropic key
// when there is one, otherwise through OpenRouter (Claude Sonnet 5.5 by
// default). The reply is constrained to a JSON schema whose enums only
// contain the actions and targets that are valid on the current screen.

const DEFAULT_MODEL = "claude-opus-5-5";

export function claudeModel(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
}

export function isClaudeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

/** The model that answers voice turns when there is no direct Anthropic key. */
export function agentModelViaOpenRouter(): string {
  return process.env.OPENROUTER_AGENT_MODEL?.trim() || modelFor("smart");
}

/** Is any conversation model available (direct Anthropic or OpenRouter)? */
export function isAgentConfigured(): boolean {
  return isClaudeConfigured() || isOpenRouterConfigured();
}

export function agentModel(): string {
  return isClaudeConfigured() ? claudeModel() : agentModelViaOpenRouter();
}

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

function effort(): Effort {
  const e = process.env.ANTHROPIC_EFFORT?.trim().toLowerCase();
  return e === "medium" || e === "high" || e === "xhigh" || e === "max" ? e : "low";
}

// Models that accept server-side refusal fallbacks (`fallbacks: "default"`).
const SERVER_FALLBACK_MODELS = /^claude-(fable-5(-[12])?|mythos-5(-[12])?|opus-5(-5)?|sonnet-5-5)$/;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      // Voice turns must stay snappy; the route falls back to the local
      // matcher if Claude is slow or unavailable.
      timeout: 9_000,
      maxRetries: 1,
    });
  }
  return client;
}

const SYSTEM_PROMPT = `You are the voice of "One More Story", a gentle game companion on a tablet for an older adult living with Alzheimer's disease. Their family set up the games with photos and places from their own life. Latency-sensitive: decide quickly and begin your visible answer immediately.

Each turn you receive the current game screen (what is on it, the question just asked, and the only actions allowed right now), the recent conversation, and the player's latest words from speech recognition. Reply with one JSON object:
- action: exactly one of the allowed actions.
- target: the id of the chosen choice when the action takes one (a place, a direction, a game); otherwise "".
- say: the words you will speak next, or "" when the game speaks for itself (see below).
- needs_clarification: true only when you are asking a clarifying question because you could not tell what they meant.

Choosing the action
- Other people may be in the room. If the words are clearly meant for someone else (a name that is not yours, "can you bring the tea", "hello? yes I'm on the phone", talk that has nothing to do with the screen or your last question), choose "ignore" with say "". Never answer talk that wasn't meant for you. When in doubt between ignore and a real answer to your question, it is a real answer.
- Speech recognition makes mistakes. Map near-sounding or partial words to the choices on screen ("the bull" or "the ball" means "blue bowl"; "by the door" means the hooks by the door; "the left one" means the left direction).
- Choose a game action only when the meaning is clear. If they hesitate between two choices or the words fit nothing on screen, use "none" with needs_clarification true and ask ONE short question naming two or three likely choices, for example "Did you mean the blue bowl, or the drawer?". Unclear words are never a wrong answer.
- If a clarification was already asked for this question and it is still unclear, use "none" and kindly say they can also tap their answer on the screen.
- If they say something unrelated (a comment, a worry, a memory), use "none", answer briefly and warmly, then gently come back to the question.
- If they sound tired or upset, use "none" and offer a pause. Use "pause" or "end_session" when they ask for it.

How to speak
- Warm, calm, respectful and adult. Never childish or patronising.
- Short: one or two sentences, under 25 words, with at most ONE question.
- Plain spoken words only: no lists, markdown, emoji or stage directions.
- Never test, quiz or correct their memories. Never say "wrong" or "incorrect". Never mention memory loss, illness, scores, hint counts or alerts.
- Let the player supply the facts. Never invent or assume names, dates, places, relationships or events. Use only details the player said, or the visible facts listed for the screen.

Per game
- My Memory Room: never reveal where an object is and never say whether a choice is right; the game says that. For choose_spot and play_clue, set say to "".
- Tell the Story: when they share something, choose the talk action and reply with genuine interest plus ONE open follow-up question built on their own words. Example: they say "That was my cricket team" and you ask "What did you enjoy about playing with them?". If they say they don't remember, reassure them there is no right answer and ask what they notice in the photo.
- Show Me Your Street: the player is the tour guide and you are a curious visitor. When they describe a place, respond with interest and one short follow-up, or ask which way to go next. When they choose a way ("let's take the lane on the left"), choose the go action with that direction and set say to "", because the game will describe the new place.
- Home: help them pick one of the three games.
- Today's games (game "companion"): the companion leads and the player never has to choose what to do next. For a question with choices on screen, map their words to one choice with the choose action and set say to "" (the game praises or encourages). If they talk about a memory instead, use the talk action when it is allowed (say ""), otherwise use "none" and reply warmly in one sentence, then repeat the question. If they ask for help, use the hint action when it is allowed.`;

function renderTurn(req: AgentRequest): string {
  const ctx = req.context;
  const actions = allActions(ctx)
    .map((a) => {
      const head = `- ${a.name}: ${a.description}`;
      if (!a.targets?.length) return head;
      const targets = a.targets
        .map((t) => `    ${t.id} = "${t.label}"${t.aliases?.length ? ` (also: ${t.aliases.join(", ")})` : ""}`)
        .join("\n");
      return `${head} Target is one of:\n${targets}`;
    })
    .join("\n");
  const history = req.history
    .slice(-10)
    .map((h) => `${h.role === "assistant" ? "Companion" : "Player"}: ${h.text}`)
    .join("\n");
  return [
    `Player's name: ${req.playerName}`,
    "<screen>",
    `game: ${ctx.game}`,
    `screen: ${ctx.screen}`,
    `on screen: ${ctx.scene}`,
    ctx.question ? `question just asked: "${ctx.question}"` : "",
    ctx.facts?.length ? `visible facts you may mention:\n${ctx.facts.map((f) => `- ${f}`).join("\n")}` : "",
    ctx.mode === "conversation"
      ? `This is a conversation screen: when the player is simply talking or sharing, use the "${ctx.talkAction ?? "none"}" action.`
      : "",
    "allowed actions:",
    actions,
    "</screen>",
    `clarifications already asked for this question: ${req.clarifications}`,
    "<conversation>",
    history || "(none yet)",
    "</conversation>",
    `Player's latest words (from speech recognition): "${req.utterance.replace(/"/g, "'")}"`,
  ]
    .filter(Boolean)
    .join("\n");
}

export class ClaudeUnavailable extends Error {}

function decisionSchema(req: AgentRequest) {
  const actions = allActions(req.context);
  const targetIds = Array.from(new Set(actions.flatMap((a) => a.targets?.map((t) => t.id) ?? [])));
  return {
    type: "object",
    properties: {
      action: { type: "string", enum: actions.map((a) => a.name) },
      target: { type: "string", enum: ["", ...targetIds] },
      say: { type: "string" },
      needs_clarification: { type: "boolean" },
    },
    required: ["action", "target", "say", "needs_clarification"],
    additionalProperties: false,
  };
}

type RawDecision = { action?: string; target?: string; say?: string; needs_clarification?: boolean };

function toDecision(parsed: RawDecision, started: number, source: AgentDecision["source"] = "claude"): AgentDecision {
  return {
    action: String(parsed.action ?? "none"),
    target: parsed.target ? String(parsed.target) : null,
    say: String(parsed.say ?? "").trim().slice(0, 400),
    needsClarification: Boolean(parsed.needs_clarification),
    source,
    latencyMs: Date.now() - started,
  };
}

/** Same prompt and schema as the direct call, sent through OpenRouter. */
export async function decideViaOpenRouter(req: AgentRequest): Promise<AgentDecision> {
  const started = Date.now();
  const parsed = await chatJson<RawDecision>({
    model: agentModelViaOpenRouter(),
    maxTokens: 400,
    timeoutMs: 10_000,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: renderTurn(req) },
    ],
    schema: { name: "decision", schema: decisionSchema(req) },
    extra: { reasoning: { effort: "low" } },
  });
  return toDecision(parsed, started);
}

export async function decideWithClaude(req: AgentRequest): Promise<AgentDecision> {
  const schema = decisionSchema(req);

  const model = claudeModel();
  const base = {
    model,
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user" as const, content: renderTurn(req) }],
    output_config: { effort: effort(), format: { type: "json_schema" as const, schema } },
  };
  const started = Date.now();
  const response = SERVER_FALLBACK_MODELS.test(model)
    ? await getClient().beta.messages.create({
        ...base,
        // On a safety decline the API re-runs the turn on Anthropic's
        // recommended fallback model inside the same call.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      })
    : await getClient().beta.messages.create(base);

  if (response.stop_reason === "refusal") throw new ClaudeUnavailable("refusal");
  if (response.stop_reason === "max_tokens") throw new ClaudeUnavailable("max_tokens");
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new ClaudeUnavailable("no text block");

  let parsed: RawDecision;
  try {
    parsed = JSON.parse(text.text);
  } catch {
    throw new ClaudeUnavailable("invalid JSON");
  }
  return toDecision(parsed, started);
}

/** Safe-to-log description of an SDK error (never includes the key). */
export function describeClaudeError(err: unknown): string {
  if (err instanceof Anthropic.APIError) return `Anthropic API ${err.status ?? "?"}: ${err.message.slice(0, 160)}`;
  if (err instanceof ClaudeUnavailable) return `Claude response unusable: ${err.message}`;
  return `Claude call failed: ${String((err as Error)?.message ?? err).slice(0, 160)}`;
}
