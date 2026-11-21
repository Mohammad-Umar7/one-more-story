import { route, type IdParams } from "@/lib/server/http";
import { deleteStory } from "@/lib/server/content";

export const DELETE = route(async (_req: Request, ctx: IdParams) => {
  const { id } = await ctx.params;
  deleteStory(id);
  return Response.json({ ok: true });
});
