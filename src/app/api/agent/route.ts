import { decideViaOpenRouter, decideWithClaude, describeClaudeError, isClaudeConfigured } from "@/lib/server/claude";
import { describeAiError, isOpenRouterConfigured } from "@/lib/server/openrouter";
import { bankSize, isRecorded } from "@/lib/server/voicebank";
import { scriptedReply } from "@/lib/shared/demo-script";
import { HttpError, readJson, route } from "@/lib/server/http";
import {
  interpretLocally,
  validateDecision,
  type AgentDecision,
  type AgentRequest,
} from "@/lib/shared/agent";

function checkRequest(body: AgentRequest): AgentRequest {
  const ctx = body?.context;
  if (!ctx || !Array.isArray(ctx.actions) || typeof ctx.game !== "string") throw new HttpError(400, "Missing screen context");
  if (typeof body.utterance !== "string" || !body.utterance.trim()) throw new HttpError(400, "Nothing was heard");
  return {
    context: {
      ...ctx,
      actions: ctx.actions.slice(0, 20).map((a) => ({
        name: String(a.name).slice(0, 40),
        description: String(a.description ?? "").slice(0, 300),
        targets: a.targets?.slice(0, 20).map((t) => ({
          id: String(t.id).slice(0, 60),
          label: String(t.label).slice(0, 80),
          aliases: t.aliases?.slice(0, 8).map((x) => String(x).slice(0, 40)),
        })),
        phrases: a.phrases?.slice(0, 20).map((p) => String(p).slice(0, 60)),
      })),
      scene: String(ctx.scene ?? "").slice(0, 600),
      question: ctx.question ? String(ctx.question).slice(0, 300) : undefined,
      facts: ctx.facts?.slice(0, 10).map((f) => String(f).slice(0, 200)),
    },
    utterance: body.utterance.trim().slice(0, 500),
    history: (Array.isArray(body.history) ? body.history : []).slice(-12).map((h) => ({
      role: h.role === "assistant" ? "assistant" : "player",
      text: String(h.text ?? "").slice(0, 400),
    })),
    playerName: String(body.playerName ?? "friend").slice(0, 40),
    clarifications: Number(body.clarifications) || 0,
  };
}

const TAKE_TIME = "Take your time. There's no rush.";

export const POST = route(async (req: Request) => {
  const started = Date.now();
  const body = checkRequest(await readJson<AgentRequest>(req));
  let decision: AgentDecision;
  if (isClaudeConfigured()) {
    try {
      decision = await decideWithClaude(body);
    } catch (err) {
      console.warn("[agent]", describeClaudeError(err), "- using the local matcher for this turn");
      decision = { ...interpretLocally(body), note: "claude_unavailable" };
    }
  } else if (isOpenRouterConfigured()) {
    try {
      decision = await decideViaOpenRouter(body);
    } catch (err) {
      console.warn("[agent] OpenRouter", describeAiError(err), "- using the local matcher for this turn");
      decision = { ...interpretLocally(body), note: "openrouter_unavailable" };
    }
  } else {
    decision = interpretLocally(body);
  }
  decision = validateDecision(decision, body.context);
  // With the family's recorded voice bank, free replies come from the script
  // so every line can be played in their real voice.
  if (bankSize() > 0) {
    const scripted = scriptedReply(body.context, decision.action, body.history);
    if (scripted) decision = { ...decision, say: scripted };
    // Only the family member's real voice: an AI-written reply they didn't record
    // is dropped. When nothing else fits, the current question is asked again.
    if (decision.say && !isRecorded(decision.say)) {
      const q = body.context.question;
      const fallback = q && isRecorded(q) ? q : isRecorded(TAKE_TIME) ? TAKE_TIME : "";
      decision = { ...decision, say: decision.action === "none" ? fallback : "" };
    }
  }
  if (process.env.NODE_ENV !== "production") {
    console.log(`[agent] ${body.context.game}/${body.context.screen} "${body.utterance.slice(0, 80)}" -> ${decision.action}${decision.target ? `(${decision.target})` : ""} ${decision.say ? `"${decision.say.slice(0, 60)}"` : ""}`);
  }
  return Response.json({ ...decision, latencyMs: Date.now() - started });
});
