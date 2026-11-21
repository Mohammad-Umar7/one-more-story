import { HttpError, optStr, readJson, route, str, type IdParams } from "@/lib/server/http";
import { recordEvent } from "@/lib/server/memory";

const KINDS = new Set(["mic_failure", "playback_failure", "wrong_choice", "reveal", "voice_used", "correct"]);

export const POST = route(async (req: Request, ctx: IdParams) => {
  const { id } = await ctx.params;
  const body = await readJson<{ kind?: string; clientEventId?: string; detail?: string }>(req);
  const kind = str(body.kind, "kind", 40);
  if (!KINDS.has(kind)) throw new HttpError(400, "Unknown event");
  recordEvent(id, kind, str(body.clientEventId, "clientEventId", 80), optStr(body.detail, 300));
  return Response.json({ ok: true });
});
