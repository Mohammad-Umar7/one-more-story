// Family members who lend the companion their face and voice, their recorded
// lines ("Hello Baba, it's me!") and their story interview answers.

import { getDb, nowIso, uid } from "./db";
import { getMedia, mediaUrl } from "./media";
import { setVoiceProfileGetter } from "./tts";
import { isElevenLabsConfigured, type VoiceProfile } from "./voices";
import { fillLine, VOICE_LINES, type Companion, type VoiceLineKey } from "../shared/companion";

export interface MemberRow {
  id: string;
  player_id: string;
  name: string;
  relation: string;
  photo_media_id: string | null;
  avatar_media_id: string | null;
  avatar_status: "none" | "working" | "ready" | "failed";
  show_photo: number;
  look: string | null;
  voice_name: string | null;
  voice_style: string | null;
  voice_summary: string | null;
  eleven_voice_id: string | null;
  is_companion: number;
  consent_at: string | null;
  created_at: string;
}

export function getMember(id: string): MemberRow | null {
  return (getDb().prepare("SELECT * FROM family_members WHERE id = ?").get(id) as MemberRow | undefined) ?? null;
}

/** The family member whose face and voice the companion uses. */
export function getCompanionMember(playerId: string): MemberRow | null {
  return (
    (getDb()
      .prepare("SELECT * FROM family_members WHERE player_id = ? ORDER BY is_companion DESC, created_at LIMIT 1")
      .get(playerId) as MemberRow | undefined) ?? null
  );
}

export function listMembers(playerId: string): MemberRow[] {
  return getDb().prepare("SELECT * FROM family_members WHERE player_id = ? ORDER BY is_companion DESC, created_at").all(playerId) as unknown as MemberRow[];
}

export function upsertCompanionMember(
  playerId: string,
  fields: { name: string; relation: string; consent: boolean },
): MemberRow {
  const db = getDb();
  const existing = getCompanionMember(playerId);
  if (existing) {
    db.prepare("UPDATE family_members SET name = ?, relation = ?, consent_at = COALESCE(consent_at, ?) WHERE id = ?").run(
      fields.name,
      fields.relation,
      fields.consent ? nowIso() : null,
      existing.id,
    );
    return getMember(existing.id)!;
  }
  const id = uid("fm");
  db.prepare(
    `INSERT INTO family_members (id, player_id, name, relation, is_companion, consent_at, created_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)`,
  ).run(id, playerId, fields.name, fields.relation, fields.consent ? nowIso() : null, nowIso());
  return getMember(id)!;
}

export function updateMember(id: string, patch: Partial<Omit<MemberRow, "id" | "player_id" | "created_at">>): void {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  getDb()
    .prepare(`UPDATE family_members SET ${sets} WHERE id = ?`)
    .run(...keys.map((k) => (patch[k] ?? null) as string | number | null), id);
}

// ---- voice lines ---------------------------------------------------------------

export function saveVoiceLine(memberId: string, key: VoiceLineKey, mediaId: string, transcript: string | null): void {
  getDb()
    .prepare(
      `INSERT INTO voice_lines (id, member_id, line_key, media_id, transcript, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(member_id, line_key) DO UPDATE SET media_id = excluded.media_id, transcript = excluded.transcript, created_at = excluded.created_at`,
    )
    .run(uid("vl"), memberId, key, mediaId, transcript, nowIso());
}

export function voiceLines(memberId: string): { key: VoiceLineKey; mediaId: string; transcript: string | null }[] {
  const rows = getDb().prepare("SELECT line_key, media_id, transcript FROM voice_lines WHERE member_id = ?").all(memberId) as {
    line_key: VoiceLineKey;
    media_id: string;
    transcript: string | null;
  }[];
  return rows.map((r) => ({ key: r.line_key, mediaId: r.media_id, transcript: r.transcript }));
}

// ---- interview answers ---------------------------------------------------------

export interface AnswerRow {
  id: string;
  member_id: string;
  question_key: string;
  question: string;
  media_id: string | null;
  transcript: string;
  reply: string | null;
  created_at: string;
}

export function saveAnswer(memberId: string, a: { key: string; question: string; mediaId: string | null; transcript: string; reply: string | null }): AnswerRow {
  getDb()
    .prepare(
      `INSERT INTO interview_answers (id, member_id, question_key, question, media_id, transcript, reply, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(member_id, question_key) DO UPDATE SET question = excluded.question, media_id = excluded.media_id,
         transcript = excluded.transcript, reply = excluded.reply, created_at = excluded.created_at`,
    )
    .run(uid("ia"), memberId, a.key, a.question, a.mediaId, a.transcript, a.reply, nowIso());
  return answers(memberId).find((r) => r.question_key === a.key)!;
}

export function answers(memberId: string): AnswerRow[] {
  return getDb().prepare("SELECT * FROM interview_answers WHERE member_id = ? ORDER BY created_at").all(memberId) as unknown as AnswerRow[];
}

export function isPlayerOnboarded(playerId: string): boolean {
  const r = getDb().prepare("SELECT onboarded_at FROM players WHERE id = ?").get(playerId) as { onboarded_at: string | null } | undefined;
  return Boolean(r?.onboarded_at);
}

// ---- the companion as the player's screen sees it ------------------------------

export function companionView(playerId: string, callName: string): Companion | null {
  const m = getCompanionMember(playerId);
  if (!m) return null;
  const lines: Companion["lines"] = {};
  for (const l of voiceLines(m.id)) {
    const def = VOICE_LINES.find((v) => v.key === l.key);
    if (!def || !getMedia(l.mediaId)) continue;
    lines[l.key] = { url: mediaUrl(l.mediaId), text: l.transcript || fillLine(def.template, callName, m.name) };
  }
  const photoUrl = m.photo_media_id ? mediaUrl(m.photo_media_id) : null;
  const avatarUrl = m.show_photo && photoUrl ? photoUrl : m.avatar_media_id ? mediaUrl(m.avatar_media_id) : photoUrl;
  return {
    memberId: m.id,
    name: m.name,
    relation: m.relation,
    avatarUrl,
    photoUrl,
    avatarStatus: m.avatar_status,
    lines,
    voice: {
      name: m.voice_name,
      summary: m.voice_summary,
      cloned: Boolean(m.eleven_voice_id) && isElevenLabsConfigured(),
    },
  };
}

// Every spoken line uses the companion's voice. The newest player is the one
// being cared for (one player per install).
setVoiceProfileGetter((): VoiceProfile | null => {
  const row = getDb()
    .prepare(
      `SELECT voice_name, voice_style, eleven_voice_id FROM family_members
       WHERE player_id = (SELECT id FROM players ORDER BY created_at LIMIT 1)
       ORDER BY is_companion DESC, created_at LIMIT 1`,
    )
    .get() as { voice_name: string | null; voice_style: string | null; eleven_voice_id: string | null } | undefined;
  if (!row?.voice_name) return null;
  return { voice: row.voice_name, style: row.voice_style, elevenVoiceId: row.eleven_voice_id };
});
