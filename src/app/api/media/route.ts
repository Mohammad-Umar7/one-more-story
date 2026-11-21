import { HttpError, route } from "@/lib/server/http";
import { isAllowedMime, mediaUrl, saveMedia } from "@/lib/server/media";

// Upload one photo or recording (multipart field "file").
export const POST = route(async (req: Request) => {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, "Expected a file upload");
  }
  const file = form.get("file");
  if (!(file instanceof Blob)) throw new HttpError(400, "Missing file");
  const mime = file.type || "application/octet-stream";
  if (!isAllowedMime(mime)) throw new HttpError(415, "Please upload a JPEG/PNG photo or a recording");
  const duration = Number(form.get("durationMs"));
  const transcript = form.get("transcript");
  try {
    const row = saveMedia({
      data: Buffer.from(await file.arrayBuffer()),
      mime,
      durationMs: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
      transcript: typeof transcript === "string" && transcript.trim() ? transcript.trim().slice(0, 2000) : null,
    });
    return Response.json({ id: row.id, url: mediaUrl(row.id), kind: row.kind });
  } catch (err) {
    throw new HttpError(400, (err as Error).message);
  }
});
