import { route, type IdParams } from "@/lib/server/http";
import { completeSession } from "@/lib/server/memory";

// Finishing a round runs the baseline rule and, when the pattern appears,
// creates the caregiver alert and pushes it. Safe to retry.
export const POST = route(async (_req: Request, ctx: IdParams) => {
  const { id } = await ctx.params;
  return Response.json(await completeSession(id));
});
