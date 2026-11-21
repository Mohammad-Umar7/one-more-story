import { HttpError, route, type IdParams } from "@/lib/server/http";
import { markAlertSeen } from "@/lib/server/memory";

// "Mark as seen" from the inbox, or from the notification's own action button.
export const POST = route(async (_req: Request, ctx: IdParams) => {
  const { id } = await ctx.params;
  if (!markAlertSeen(id)) throw new HttpError(404, "Alert not found");
  return Response.json({ ok: true });
});
