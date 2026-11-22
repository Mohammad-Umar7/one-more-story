#!/usr/bin/env node
// Export the demo family (the companion's face and voice, the life story, the
// recorded lines, the story photo and the baseline) from the local database
// into seed/demo-pack/, so a fresh server (and every Vercel instance) starts
// with it. Audio is compressed to MP3 to keep the repo small.
//
//   node scripts/export-demo-pack.mjs
//
// The pack contains a real person's photo and voice: commit it only with
// their consent.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const ROOT = process.cwd();
const DATA = path.resolve(process.env.DATA_DIR || path.join(ROOT, "data"));
const OUT = path.join(ROOT, "seed", "demo-pack");
const db = new DatabaseSync(path.join(DATA, "one-more-story.db"), { readOnly: true });

const player = db.prepare("SELECT * FROM players ORDER BY created_at LIMIT 1").get();
const member = db.prepare("SELECT * FROM family_members WHERE player_id = ? ORDER BY is_companion DESC, created_at LIMIT 1").get(player.id);
if (!member) {
  console.error("No family member in the local database: nothing to export.");
  process.exit(1);
}
const lines = db.prepare("SELECT line_key, media_id, transcript FROM voice_lines WHERE member_id = ?").all(member.id);
const bank = db.prepare("SELECT text, media_id FROM voice_bank ORDER BY created_at").all();
const memories = db.prepare("SELECT * FROM memories WHERE player_id = ? AND active = 1 ORDER BY created_at").all(player.id);
const baselines = db.prepare("SELECT * FROM baselines WHERE player_id = ? ORDER BY created_at").all(player.id);
const storyPhotos = db.prepare("SELECT * FROM story_photos WHERE player_id = ? AND id LIKE 'sp_%' AND id NOT IN ('sp_cricket') ORDER BY sort").all(player.id);

const mediaIds = new Set(
  [
    member.photo_media_id,
    member.avatar_media_id,
    ...lines.map((l) => l.media_id),
    ...bank.map((b) => b.media_id),
    ...memories.flatMap((m) => [m.art_media_id, m.photo_media_id]),
    ...storyPhotos.map((s) => s.media_id),
  ].filter(Boolean),
);

fs.mkdirSync(path.join(OUT, "media"), { recursive: true });
for (const f of fs.readdirSync(path.join(OUT, "media"))) fs.rmSync(path.join(OUT, "media", f), { force: true });
const media = [];
for (const id of mediaIds) {
  const row = db.prepare("SELECT * FROM media WHERE id = ?").get(id);
  if (!row) continue;
  const src = path.join(DATA, "media", row.file);
  if (!fs.existsSync(src)) continue;
  let file = row.file;
  let mime = row.mime;
  if (row.kind === "audio" && row.mime !== "audio/mpeg") {
    file = `${id}.mp3`;
    mime = "audio/mpeg";
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", src, "-ac", "1", "-ar", "24000", "-b:a", "48k", path.join(OUT, "media", file)]);
  } else if (row.kind === "image" && row.mime === "image/webp" && row.bytes > 400_000) {
    // Paintings come out of the image model at full size: phone size is plenty.
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", src, "-vf", "scale='min(1200,iw)':-2", "-c:v", "libwebp", "-quality", "80", path.join(OUT, "media", file)]);
  } else {
    fs.copyFileSync(src, path.join(OUT, "media", file));
  }
  media.push({ id, kind: row.kind, mime, file, durationMs: row.duration_ms, transcript: row.transcript });
}

const pack = {
  exportedAt: new Date().toISOString(),
  player: { name: player.name, familyName: player.family_name, pronoun: player.pronoun, speechLang: player.speech_lang },
  member: {
    id: member.id,
    name: member.name,
    relation: member.relation,
    photoMediaId: member.photo_media_id,
    avatarMediaId: member.avatar_media_id,
    showPhoto: member.show_photo,
    look: member.look,
    voiceName: member.voice_name,
    voiceStyle: member.voice_style,
    voiceSummary: member.voice_summary,
  },
  lines: lines.map((l) => ({ key: l.line_key, mediaId: l.media_id, transcript: l.transcript })),
  bank: bank.map((b) => ({ text: b.text, mediaId: b.media_id })),
  // The interview recordings are left out (the demo doesn't play them).
  memories: memories.map((m) => ({
    id: m.id,
    kind: m.kind,
    title: m.title,
    detail: m.detail,
    people: m.people,
    place: m.place,
    era: m.era,
    facts: m.facts,
    photoMediaId: m.photo_media_id,
    artMediaId: m.art_media_id,
    artPrompt: m.art_prompt,
    source: m.source,
    addedBy: m.added_by,
    createdAt: m.created_at,
  })),
  baselines: baselines.map((b) => ({
    id: b.id,
    stage: b.stage,
    level: b.level,
    trend: b.trend,
    reason: b.reason,
    familyNote: b.family_note,
    decidedBy: b.decided_by,
    metrics: b.metrics,
    createdAt: b.created_at,
  })),
  storyPhotos: storyPhotos.map((s) => ({ id: s.id, mediaId: s.media_id, title: s.title })),
  media,
};
fs.writeFileSync(path.join(OUT, "pack.json"), JSON.stringify(pack, null, 1));
const bytes = media.reduce((n, m) => n + fs.statSync(path.join(OUT, "media", m.file)).size, 0);
console.log(
  `Exported ${member.name}: ${pack.lines.length} voice lines, ${pack.bank.length} recorded companion lines, ${pack.memories.length} memories, ${pack.storyPhotos.length} story photo(s), ${pack.baselines.length} baseline(s), ${media.length} files (${(bytes / 1e6).toFixed(1)} MB) -> seed/demo-pack/`,
);
