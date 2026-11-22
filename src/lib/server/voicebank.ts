// The family member's own recordings of the companion's lines. When the
// companion is about to say a sentence that was recorded, the recording plays
// instead of the synthetic voice, so the player hears the real person.

import fs from "node:fs";
import { getDb, nowIso } from "./db";
import { getMedia, mediaPath } from "./media";

export function normLine(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function similarity(a: string, b: string): number {
  const A = a.split(" ").filter(Boolean);
  const B = b.split(" ").filter(Boolean);
  if (!A.length || !B.length) return 0;
  const setB = new Set(B);
  const common = A.filter((w) => setB.has(w)).length;
  return (2 * common) / (A.length + B.length);
}

export function addToBank(text: string, mediaId: string): void {
  getDb()
    .prepare(
      `INSERT INTO voice_bank (text_norm, text, media_id, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(text_norm) DO UPDATE SET text = excluded.text, media_id = excluded.media_id, created_at = excluded.created_at`,
    )
    .run(normLine(text), text, mediaId, nowIso());
}

export function clearBank(): void {
  getDb().prepare("DELETE FROM voice_bank").run();
}

export function bankSize(): number {
  return (getDb().prepare("SELECT COUNT(*) AS n FROM voice_bank").get() as { n: number }).n;
}

export function listBank(): { text: string; mediaId: string }[] {
  return (getDb().prepare("SELECT text, media_id FROM voice_bank ORDER BY created_at").all() as { text: string; media_id: string }[]).map((r) => ({
    text: r.text,
    mediaId: r.media_id,
  }));
}

/** Once the family has recorded lines, the companion speaks only in their real voice. */
export function isRecordedOnly(): boolean {
  return bankSize() > 0;
}

function bestMatch(text: string): { media_id: string; score: number } | null {
  const n = normLine(text);
  if (!n) return null;
  const rows = getDb().prepare("SELECT text_norm, media_id FROM voice_bank").all() as { text_norm: string; media_id: string }[];
  let best: { media_id: string; score: number } | null = null;
  for (const r of rows) {
    const score = r.text_norm === n ? 1 : similarity(r.text_norm, n);
    if (!best || score > best.score) best = { media_id: r.media_id, score };
  }
  return best && best.score >= 0.86 ? best : null;
}

/** Did the family record this sentence (or nearly the same words)? */
export function isRecorded(text: string): boolean {
  return bestMatch(text) !== null;
}

/** The recording for this sentence, if the family recorded it (exact, or nearly the same words). */
export function findRecorded(text: string): { audio: Buffer; mime: string } | null {
  const n = normLine(text);
  if (!n) return null;
  const rows = getDb().prepare("SELECT text_norm, media_id FROM voice_bank").all() as { text_norm: string; media_id: string }[];
  let best: { media_id: string; score: number } | null = null;
  for (const r of rows) {
    const score = r.text_norm === n ? 1 : similarity(r.text_norm, n);
    if (!best || score > best.score) best = { media_id: r.media_id, score };
  }
  if (!best || best.score < 0.86) return null;
  const media = getMedia(best.media_id);
  if (!media) return null;
  try {
    return { audio: fs.readFileSync(mediaPath(media)), mime: media.mime };
  } catch {
    return null;
  }
}
