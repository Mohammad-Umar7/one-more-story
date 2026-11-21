// Server-side only (imported by route handlers and the CLI scripts).
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// One SQLite file holds everything (WAL mode, so a second process such as the
// seed script can safely open it). Media files live next to it on disk.

export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), "data"));
export const MEDIA_DIR = path.join(DATA_DIR, "media");
export const TTS_CACHE_DIR = path.join(DATA_DIR, "tts-cache");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('image','audio')),
  mime TEXT NOT NULL,
  file TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  duration_ms INTEGER,
  transcript TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  family_name TEXT NOT NULL,
  pronoun TEXT NOT NULL DEFAULT 'they',
  speech_lang TEXT NOT NULL DEFAULT 'en-US',
  patience TEXT NOT NULL DEFAULT 'normal',
  save_tour_speech INTEGER NOT NULL DEFAULT 1,
  alert_caregiver_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS caregivers (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  relation TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('relative','friend','professional')),
  pair_code TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  caregiver_id TEXT NOT NULL REFERENCES caregivers(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  device_label TEXT,
  created_at TEXT NOT NULL,
  last_success_at TEXT,
  last_error TEXT,
  disabled_at TEXT
);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  photo_media_id TEXT NOT NULL,
  difficulty TEXT NOT NULL DEFAULT 'standard',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS room_spots (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  sort INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS room_objects (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  icon TEXT NOT NULL,
  question TEXT NOT NULL,
  spot_id TEXT NOT NULL,
  clue_media_id TEXT,
  sort INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_sessions (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  signature TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  object_count INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('in_progress','completed','interrupted')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  hint_count INTEGER NOT NULL DEFAULT 0,
  mic_failures INTEGER NOT NULL DEFAULT 0,
  playback_failures INTEGER NOT NULL DEFAULT 0,
  wrong_choices INTEGER NOT NULL DEFAULT 0,
  reveals INTEGER NOT NULL DEFAULT 0,
  voice_used INTEGER NOT NULL DEFAULT 0,
  seeded INTEGER NOT NULL DEFAULT 0,
  client_key TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_sessions_player ON memory_sessions(player_id, ended_at);

CREATE TABLE IF NOT EXISTS hint_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES memory_sessions(id) ON DELETE CASCADE,
  object_id TEXT NOT NULL,
  playback_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  UNIQUE (session_id, playback_id)
);

CREATE TABLE IF NOT EXISTS session_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES memory_sessions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  detail TEXT,
  client_event_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (session_id, client_event_id)
);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  caregiver_id TEXT,
  game TEXT NOT NULL,
  pattern_key TEXT NOT NULL UNIQUE,
  baseline REAL NOT NULL,
  threshold REAL NOT NULL,
  hint_counts TEXT NOT NULL,
  session_ids TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  seen_at TEXT
);

CREATE TABLE IF NOT EXISTS alert_deliveries (
  id TEXT PRIMARY KEY,
  alert_id TEXT NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  subscription_id TEXT NOT NULL,
  status TEXT NOT NULL,
  status_code INTEGER,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  attempted_at TEXT NOT NULL,
  UNIQUE (alert_id, subscription_id)
);

CREATE TABLE IF NOT EXISTS story_photos (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  title TEXT NOT NULL,
  sort INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stories (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  client_key TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS story_clips (
  id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL,
  prompt TEXT,
  transcript TEXT,
  sort INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS routes (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  name TEXT NOT NULL,
  start_stop_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS route_stops (
  id TEXT PRIMARY KEY,
  route_id TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  photo_media_id TEXT NOT NULL,
  sort INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS route_links (
  id TEXT PRIMARY KEY,
  route_id TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  from_stop_id TEXT NOT NULL,
  to_stop_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('left','right','straight')),
  label TEXT NOT NULL,
  UNIQUE (from_stop_id, direction)
);

CREATE TABLE IF NOT EXISTS tours (
  id TEXT PRIMARY KEY,
  route_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('in_progress','completed','left')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  client_key TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS tour_steps (
  id TEXT PRIMARY KEY,
  tour_id TEXT NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
  stop_id TEXT NOT NULL,
  via_direction TEXT,
  via_label TEXT,
  arrived_at TEXT NOT NULL,
  sort INTEGER NOT NULL,
  client_key TEXT NOT NULL,
  UNIQUE (tour_id, client_key)
);

CREATE TABLE IF NOT EXISTS tour_notes (
  id TEXT PRIMARY KEY,
  tour_id TEXT NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
  step_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'note',
  transcript TEXT,
  created_at TEXT NOT NULL,
  client_key TEXT UNIQUE
);
`;

type GlobalWithDb = typeof globalThis & { __omsDb?: DatabaseSync; __omsSeeding?: boolean };

export function nowIso(): string {
  return new Date().toISOString();
}

export function uid(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export function getDb(): DatabaseSync {
  const g = globalThis as GlobalWithDb;
  if (g.__omsDb) return g.__omsDb;
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  fs.mkdirSync(TTS_CACHE_DIR, { recursive: true });
  const db = new DatabaseSync(path.join(DATA_DIR, "one-more-story.db"));
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  g.__omsDb = db;
  return db;
}

/** Run fn inside a transaction (IMMEDIATE, so concurrent writers queue up). */
export function tx<T>(fn: (db: DatabaseSync) => T): T {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn(db);
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function getSetting(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}
