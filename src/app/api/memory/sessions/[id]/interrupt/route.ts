import { route, type IdParams } from "@/lib/server/http";
import { interruptSession } from "@/lib/server/memory";

// Also reached through navigator.sendBeacon when the tab is closed mid-round.
export const POST = route(async (_req: Request, ctx: IdParams) => {
  const { id } = await ctx.params;
  interruptSession(id);
  return Response.json({ ok: true });
});
