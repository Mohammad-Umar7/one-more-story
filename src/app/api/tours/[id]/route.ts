import { route, type IdParams } from "@/lib/server/http";
import { getTour } from "@/lib/server/content";

export const GET = route(async (_req: Request, ctx: IdParams) => {
  const { id } = await ctx.params;
  return Response.json({ tour: getTour(id) }, { headers: { "Cache-Control": "no-store" } });
});
