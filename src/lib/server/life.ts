// The player's life story: people, places, events, favourite things, daily
// routines and things to be gentle about. Built from the family's interview
// and grown every day by the family (and by the player themself). The daily
// games are made from these.

import { getDb, nowIso, uid } from "./db";
import { getMedia, mediaUrl } from "./media";
import type { Memory, MemoryFact, MemoryKind } from "../shared/companion";

interface MemoryRow {
  id: string;
  player_id: string;
  kind: MemoryKind;
  title: string;
  detail: string;
  people: string;
  place: string | null;
  era: string | null;
  facts: string;
  photo_media_id: string | null;
  art_media_id: string | null;
  art_prompt: string | null;
  art_status: Memory["artStatus"];
  clip_media_id: string | null;
  clip_by: string | null;
  source: Memory["source"];
  added_by: string | null;
  active: number;
  created_at: string;
}

const KINDS: MemoryKind[] = ["person", "place", "event", "favorite", "routine", "gentle"];

function parseList<T>(json: string, fallback: T[]): T[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as T[]) : fallback;
  } catch {
    return fallback;
  }
}

function toMemory(r: MemoryRow): Memory {
  const clip = r.clip_media_id ? getMedia(r.clip_media_id) : null;
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    detail: r.detail,
    people: parseList<string>(r.people, []),
    place: r.place,
    era: r.era,
    facts: parseList<MemoryFact>(r.facts, []),
    photo: r.photo_media_id ? { id: r.photo_media_id, url: mediaUrl(r.photo_media_id) } : null,
    art: r.art_media_id ? { id: r.art_media_id, url: mediaUrl(r.art_media_id) } : null,
    artStatus: r.art_status,
    clip: clip ? { id: clip.id, url: mediaUrl(clip.id), durationMs: clip.duration_ms, by: r.clip_by } : null,
    source: r.source,
    addedBy: r.added_by,
    createdAt: r.created_at,
  };
}

export function listMemories(playerId: string, opts: { includeGentle?: boolean } = {}): Memory[] {
  const rows = getDb()
    .prepare("SELECT * FROM memories WHERE player_id = ? AND active = 1 ORDER BY created_at DESC")
    .all(playerId) as unknown as MemoryRow[];
  return rows.filter((r) => opts.includeGentle !== false || r.kind !== "gentle").map(toMemory);
}

export function getMemory(id: string): Memory | null {
  const r = getDb().prepare("SELECT * FROM memories WHERE id = ?").get(id) as MemoryRow | undefined;
  return r ? toMemory(r) : null;
}

export function getArtPrompt(id: string): string | null {
  const r = getDb().prepare("SELECT art_prompt FROM memories WHERE id = ?").get(id) as { art_prompt: string | null } | undefined;
  return r?.art_prompt ?? null;
}

export interface NewMemory {
  kind: string;
  title: string;
  detail: string;
  people?: string[];
  place?: string | null;
  era?: string | null;
  facts?: MemoryFact[];
  artPrompt?: string | null;
  photoMediaId?: string | null;
  clipMediaId?: string | null;
  clipBy?: string | null;
  source: Memory["source"];
  addedBy?: string | null;
}

function cleanFacts(facts: MemoryFact[] | undefined): MemoryFact[] {
  return (facts ?? [])
    .filter((f) => f && typeof f.prompt === "string" && typeof f.answer === "string" && f.answer.trim())
    .map((f) => ({
      prompt: f.prompt.trim().slice(0, 200),
      answer: f.answer.trim().slice(0, 60),
      distractors: Array.from(
        new Set((f.distractors ?? []).map((d) => String(d).trim().slice(0, 60)).filter((d) => d && d.toLowerCase() !== f.answer.trim().toLowerCase())),
      ).slice(0, 4),
    }))
    .filter((f) => f.distractors.length >= 1)
    .slice(0, 4);
}

export function addMemory(playerId: string, m: NewMemory): Memory {
  const id = uid("mem");
  const kind = KINDS.includes(m.kind as MemoryKind) ? (m.kind as MemoryKind) : "event";
  getDb()
    .prepare(
      `INSERT INTO memories (id, player_id, kind, title, detail, people, place, era, facts, photo_media_id,
         art_prompt, art_status, clip_media_id, clip_by, source, added_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      playerId,
      kind,
      m.title.trim().slice(0, 120),
      m.detail.trim().slice(0, 1500),
      JSON.stringify((m.people ?? []).map((p) => String(p).trim().slice(0, 60)).filter(Boolean).slice(0, 8)),
      m.place?.trim().slice(0, 120) || null,
      m.era?.trim().slice(0, 60) || null,
      JSON.stringify(cleanFacts(m.facts)),
      m.photoMediaId ?? null,
      m.artPrompt?.trim().slice(0, 800) || null,
      // "gentle" notes are guidance for the AI only: never illustrated or shown in games.
      kind === "gentle" || !m.artPrompt ? "none" : "working",
      m.clipMediaId ?? null,
      m.clipBy ?? null,
      m.source,
      m.addedBy ?? null,
      nowIso(),
    );
  return getMemory(id)!;
}

export function setMemoryArt(id: string, status: Memory["artStatus"], mediaId: string | null = null): void {
  getDb()
    .prepare("UPDATE memories SET art_status = ?, art_media_id = COALESCE(?, art_media_id) WHERE id = ?")
    .run(status, mediaId, id);
}

export function setMemoryPhoto(id: string, mediaId: string | null): void {
  getDb().prepare("UPDATE memories SET photo_media_id = ? WHERE id = ?").run(mediaId, id);
}

export function archiveMemory(id: string): void {
  getDb().prepare("UPDATE memories SET active = 0 WHERE id = ?").run(id);
}

/** Memories still waiting for their painting. */
export function memoriesNeedingArt(playerId: string): { id: string; prompt: string }[] {
  return (
    getDb()
      .prepare("SELECT id, art_prompt FROM memories WHERE player_id = ? AND active = 1 AND art_status IN ('working','failed') AND art_prompt IS NOT NULL")
      .all(playerId) as { id: string; art_prompt: string }[]
  ).map((r) => ({ id: r.id, prompt: r.art_prompt }));
}

/** Plain-text digest of the life story for prompts (newest first, capped). */
export function lifeDigest(memories: Memory[], max = 40): string {
  return memories
    .slice(0, max)
    .map((m) => {
      const bits = [
        `[${m.id}] (${m.kind}) ${m.title}: ${m.detail}`,
        m.people.length ? `people: ${m.people.join(", ")}` : "",
        m.place ? `place: ${m.place}` : "",
        m.era ? `when: ${m.era}` : "",
        m.photo || m.art ? "has picture" : "",
        m.clip ? `has a ${Math.round((m.clip.durationMs ?? 0) / 1000)}s recording by ${m.clip.by ?? "family"}` : "",
        m.facts.length ? `facts: ${m.facts.map((f) => `${f.prompt} -> ${f.answer} (not: ${f.distractors.join(" / ")})`).join("; ")}` : "",
      ];
      return bits.filter(Boolean).join(" | ");
    })
    .join("\n");
}
