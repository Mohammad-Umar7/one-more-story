import fs from "node:fs";
import path from "node:path";
import { getDb, MEDIA_DIR, nowIso, uid } from "./db";

export interface MediaRow {
  id: string;
  kind: "image" | "audio";
  mime: string;
  file: string;
  bytes: number;
  duration_ms: number | null;
  transcript: string | null;
  created_at: string;
}

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
};

export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

export function mediaUrl(id: string): string {
  return `/api/media/${id}`;
}

/** Strip codec parameters: "audio/webm;codecs=opus" -> "audio/webm". */
export function baseMime(mime: string): string {
  return mime.split(";")[0].trim().toLowerCase();
}

export function isAllowedMime(mime: string): boolean {
  return baseMime(mime) in EXT_BY_MIME;
}

export function saveMedia(opts: {
  id?: string;
  data: Buffer;
  mime: string;
  durationMs?: number | null;
  transcript?: string | null;
}): MediaRow {
  const mime = baseMime(opts.mime);
  const ext = EXT_BY_MIME[mime];
  if (!ext) throw new Error(`Unsupported media type: ${mime}`);
  const kind: "image" | "audio" = mime.startsWith("image/") ? "image" : "audio";
  const limit = kind === "image" ? MAX_IMAGE_BYTES : MAX_AUDIO_BYTES;
  if (opts.data.byteLength > limit) throw new Error("File is too large");
  if (opts.data.byteLength === 0) throw new Error("File is empty");

  const id = opts.id ?? uid(kind === "image" ? "img" : "aud");
  const file = `${id}.${ext}`;
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  fs.writeFileSync(path.join(MEDIA_DIR, file), opts.data);
  const row: MediaRow = {
    id,
    kind,
    mime: opts.mime.toLowerCase().startsWith("audio/webm") ? "audio/webm" : mime,
    file,
    bytes: opts.data.byteLength,
    duration_ms: opts.durationMs ?? null,
    transcript: opts.transcript ?? null,
    created_at: nowIso(),
  };
  getDb()
    .prepare(
      `INSERT INTO media (id, kind, mime, file, bytes, duration_ms, transcript, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, mime = excluded.mime, file = excluded.file,
         bytes = excluded.bytes, duration_ms = excluded.duration_ms, transcript = excluded.transcript`,
    )
    .run(row.id, row.kind, row.mime, row.file, row.bytes, row.duration_ms, row.transcript, row.created_at);
  return row;
}

export function getMedia(id: string): MediaRow | null {
  const row = getDb().prepare("SELECT * FROM media WHERE id = ?").get(id) as MediaRow | undefined;
  return row ?? null;
}

export function mediaPath(row: MediaRow): string {
  return path.join(MEDIA_DIR, row.file);
}

export function deleteMedia(id: string): void {
  const row = getMedia(id);
  if (!row) return;
  getDb().prepare("DELETE FROM media WHERE id = ?").run(id);
  try {
    fs.unlinkSync(mediaPath(row));
  } catch {
    // already gone
  }
}
