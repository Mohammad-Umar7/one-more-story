import { HttpError, route } from "@/lib/server/http";
import { saveMedia } from "@/lib/server/media";
import { addToBank, clearBank, listBank } from "@/lib/server/voicebank";

export const GET = route(async () => Response.json({ lines: listBank() }));

// Add one recorded line (multipart: text, file). DELETE clears the bank.
export const POST = route(async (req: Request) => {
  const form = await req.formData().catch(() => null);
  const text = String(form?.get("text") ?? "").trim();
  const file = form?.get("file");
  if (!text || !(file instanceof Blob) || file.size < 500) throw new HttpError(400, "Need text and a recording");
  const media = saveMedia({ data: Buffer.from(await file.arrayBuffer()), mime: file.type || "audio/wav", transcript: text.slice(0, 2000) });
  addToBank(text, media.id);
  return Response.json({ ok: true });
});

export const DELETE = route(async () => {
  clearBank();
  return Response.json({ ok: true });
});
