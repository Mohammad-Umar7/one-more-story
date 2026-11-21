import { optStr, readJson, route, str, type IdParams } from "@/lib/server/http";
import { addTourNote } from "@/lib/server/content";

export const POST = route(async (req: Request, ctx: IdParams) => {
  const { id } = await ctx.params;
  const body = await readJson<{ clientKey?: string; stepId?: string; mediaId?: string; kind?: string; transcript?: string }>(req);
  return Response.json(
    addTourNote(id, {
      clientKey: str(body.clientKey, "clientKey", 80),
      stepId: str(body.stepId, "stepId", 60),
      mediaId: str(body.mediaId, "mediaId", 60),
      kind: body.kind === "narration" ? "narration" : "note",
      transcript: optStr(body.transcript, 2000),
    }),
  );
});
