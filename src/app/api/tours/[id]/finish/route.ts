import { readJson, route, type IdParams } from "@/lib/server/http";
import { finishTour } from "@/lib/server/content";

export const POST = route(async (req: Request, ctx: IdParams) => {
  const { id } = await ctx.params;
  const body = await readJson<{ status?: string }>(req);
  finishTour(id, body.status === "left" ? "left" : "completed");
  return Response.json({ ok: true });
});
