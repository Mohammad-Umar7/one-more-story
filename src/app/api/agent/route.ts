import { decideWithClaude, describeClaudeError, isClaudeConfigured } from "@/lib/server/claude";
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
  } else {
    decision = interpretLocally(body);
  }
  decision = validateDecision(decision, body.context);
  return Response.json({ ...decision, latencyMs: Date.now() - started });
});
