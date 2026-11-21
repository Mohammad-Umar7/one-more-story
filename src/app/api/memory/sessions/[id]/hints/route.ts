import { readJson, route, str, type IdParams } from "@/lib/server/http";
import { recordHint } from "@/lib/server/memory";

// Called by the tablet the moment a requested clue actually starts playing.
export const POST = route(async (req: Request, ctx: IdParams) => {
  const { id } = await ctx.params;
  const body = await readJson<{ playbackId?: string; objectId?: string }>(req);
  return Response.json(recordHint(id, str(body.playbackId, "playbackId", 80), str(body.objectId, "objectId", 80)));
});
