import { HttpError, route, type IdParams } from "@/lib/server/http";
import { getPlan, makePlan, markPlan, tomorrow } from "@/lib/server/planner";
import { assessPlan } from "@/lib/server/assess";
import { planContext, playerContext } from "@/lib/server/companion";
import { describeAiError } from "@/lib/server/openrouter";

// The day's games are finished: the AI sets the new baseline, then makes
// tomorrow's games in the background.
export const POST = route(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  if (!getPlan(id)) throw new HttpError(404, "Plan not found");
  markPlan(id, "done");
  const ctx = playerContext();
  const baseline = await assessPlan(ctx.playerId, id, ctx.callName);
  void makePlan(planContext(playerContext()), tomorrow()).catch((err) => console.warn("[companion] tomorrow's plan failed:", describeAiError(err)));
  return Response.json({ baseline });
});
