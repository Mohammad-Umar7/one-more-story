import { HttpError, route, type IdParams } from "@/lib/server/http";
import { getPlan, markPlan } from "@/lib/server/planner";

export const POST = route(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  if (!getPlan(id)) throw new HttpError(404, "Plan not found");
  markPlan(id, "playing");
  return Response.json({ ok: true });
});
