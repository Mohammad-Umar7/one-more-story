import fs from "node:fs";
import { getMedia, mediaPath } from "@/lib/server/media";
import type { IdParams } from "@/lib/server/http";

// Serves photos and recordings with HTTP Range support (Chrome needs ranges to
// seek and to report durations for recorded audio).
export async function GET(req: Request, ctx: IdParams) {
  const { id } = await ctx.params;
  const row = getMedia(id);
  if (!row) return new Response("Not found", { status: 404 });
  let data: Buffer;
  try {
    data = fs.readFileSync(mediaPath(row));
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const size = data.byteLength;
  const headers: Record<string, string> = {
    "Content-Type": row.mime,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  };
  const range = req.headers.get("range");
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (m) {
    let start = m[1] ? Number(m[1]) : NaN;
    let end = m[2] ? Number(m[2]) : size - 1;
    if (Number.isNaN(start)) {
      // suffix range: last N bytes
      start = Math.max(0, size - end);
      end = size - 1;
    }
    end = Math.min(end, size - 1);
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
    }
    const chunk = data.subarray(start, end + 1);
    return new Response(new Uint8Array(chunk), {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(chunk.byteLength) },
    });
  }
  return new Response(new Uint8Array(data), { headers: { ...headers, "Content-Length": String(size) } });
}
