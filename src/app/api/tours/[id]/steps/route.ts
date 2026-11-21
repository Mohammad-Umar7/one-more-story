import { optStr, readJson, route, str, type IdParams } from "@/lib/server/http";
import { addTourStep } from "@/lib/server/content";

export const POST = route(async (req: Request, ctx: IdParams) => {
  const { id } = await ctx.params;
  const body = await readJson<{ clientKey?: string; stopId?: string; direction?: string; label?: string }>(req);
  return Response.json(
    addTourStep(id, {
      clientKey: str(body.clientKey, "clientKey", 80),
      stopId: str(body.stopId, "stopId", 60),
      direction: str(body.direction, "direction", 20),
      label: optStr(body.label, 80),
    }),
  );
});
