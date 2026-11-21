import { getDb, nowIso, tx, uid } from "./db";
import { getPlayer, getRoom } from "./bundle";
import { deliverAlert, type DeliverySummary } from "./push";
import { HttpError } from "./http";
import {
  alertMessage,
  evaluatePattern,
  excludedReason,
  MEMORY_GAME,
  type PatternState,
  type SessionFacts,
} from "../shared/baseline";
import type { AlertView, MemorySessionView } from "../shared/types";

interface SessionRow {
  id: string;
  player_id: string;
  room_id: string;
  signature: string;
  difficulty: string;
  object_count: number;
  status: SessionFacts["status"];
  started_at: string;
  ended_at: string | null;
  hint_count: number;
  mic_failures: number;
  playback_failures: number;
  wrong_choices: number;
  reveals: number;
  voice_used: number;
  seeded: number;
}

function toFacts(r: SessionRow): SessionFacts {
  return {
    id: r.id,
    signature: r.signature,
    status: r.status,
    objectCount: r.object_count,
    hintCount: r.hint_count,
    micFailures: r.mic_failures,
    playbackFailures: r.playback_failures,
    endedAt: r.ended_at,
    startedAt: r.started_at,
  };
}

function getSessionRow(id: string): SessionRow | null {
  return (getDb().prepare("SELECT * FROM memory_sessions WHERE id = ?").get(id) as SessionRow | undefined) ?? null;
}

/** Start a round. Idempotent per clientKey (a retried request returns the same round). */
export function startSession(clientKey: string): { sessionId: string; signature: string } {
  const room = getRoom();
  if (!room) throw new HttpError(409, "The family has not set up a room yet.");
  const db = getDb();
  const existing = db.prepare("SELECT id, signature FROM memory_sessions WHERE client_key = ?").get(clientKey) as
    | { id: string; signature: string }
    | undefined;
  if (existing) return { sessionId: existing.id, signature: existing.signature };
  const id = uid("ms");
  // Any earlier round left open (closed tab, crash) is no longer comparable.
  db.prepare(
    "UPDATE memory_sessions SET status = 'interrupted', ended_at = COALESCE(ended_at, ?) WHERE player_id = ? AND status = 'in_progress'",
  ).run(nowIso(), getPlayer().id);
  db.prepare(
    `INSERT INTO memory_sessions (id, player_id, room_id, signature, difficulty, object_count, status, started_at, client_key)
     VALUES (?, ?, ?, ?, ?, ?, 'in_progress', ?, ?)`,
  ).run(id, getPlayer().id, room.id, room.signature, room.difficulty, room.objects.length, nowIso(), clientKey);
  return { sessionId: id, signature: room.signature };
}

function requireOpen(sessionId: string): SessionRow {
  const s = getSessionRow(sessionId);
  if (!s) throw new HttpError(404, "Round not found");
  return s;
}

/**
 * Count a hint: called when a requested clue has actually started playing.
 * The (session, playbackId) pair is unique, so each playback counts once even
 * if the browser retries the request.
 */
export function recordHint(sessionId: string, playbackId: string, objectId: string): { hintCount: number; counted: boolean } {
  return tx((db) => {
    const s = requireOpen(sessionId);
    if (s.status !== "in_progress") {
      return { hintCount: s.hint_count, counted: false };
    }
    const res = db
      .prepare(
        `INSERT OR IGNORE INTO hint_events (id, session_id, object_id, playback_id, started_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(uid("he"), sessionId, objectId, playbackId, nowIso());
    const count = (db.prepare("SELECT COUNT(*) AS n FROM hint_events WHERE session_id = ?").get(sessionId) as { n: number }).n;
    db.prepare("UPDATE memory_sessions SET hint_count = ? WHERE id = ?").run(count, sessionId);
    return { hintCount: count, counted: res.changes > 0 };
  });
}

const EVENT_COLUMNS: Record<string, string> = {
  mic_failure: "mic_failures",
  playback_failure: "playback_failures",
  wrong_choice: "wrong_choices",
  reveal: "reveals",
};

/** Mic/playback failures mark the round as not comparable. Wrong choices are kept for context only. */
export function recordEvent(sessionId: string, kind: string, clientEventId: string, detail: string | null): void {
  tx((db) => {
    const s = requireOpen(sessionId);
    if (s.status !== "in_progress") return;
    const res = db
      .prepare(
        `INSERT OR IGNORE INTO session_events (id, session_id, kind, detail, client_event_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(uid("ev"), sessionId, kind, detail?.slice(0, 300) ?? null, clientEventId, nowIso());
    const col = EVENT_COLUMNS[kind];
    if (res.changes > 0 && col) {
      db.prepare(`UPDATE memory_sessions SET ${col} = ${col} + 1 WHERE id = ?`).run(sessionId);
    }
    if (kind === "voice_used") db.prepare("UPDATE memory_sessions SET voice_used = 1 WHERE id = ?").run(sessionId);
  });
}

export function interruptSession(sessionId: string): void {
  getDb()
    .prepare("UPDATE memory_sessions SET status = 'interrupted', ended_at = ? WHERE id = ? AND status = 'in_progress'")
    .run(nowIso(), sessionId);
}

export interface CompletionResult {
  sessionId: string;
  hintCount: number;
  excludedReason: string | null;
  pattern: PublicPattern;
  alert: { id: string; created: boolean; message: string } | null;
  delivery: DeliverySummary | null;
}

export interface PublicPattern {
  state: PatternState["state"];
  baseline: number | null;
  threshold: number | null;
  needed: number;
  streak: number;
}

function publicPattern(p: PatternState): PublicPattern {
  if (p.state === "building") return { state: p.state, baseline: null, threshold: null, needed: p.needed, streak: 0 };
  return { state: p.state, baseline: p.baseline, threshold: p.threshold, needed: 0, streak: p.streak.length };
}

function allFacts(playerId: string): SessionFacts[] {
  const rows = getDb()
    .prepare("SELECT * FROM memory_sessions WHERE player_id = ? ORDER BY COALESCE(ended_at, started_at)")
    .all(playerId) as unknown as SessionRow[];
  return rows.map(toFacts);
}

/**
 * Create the alert for the current pattern if there is one. The pattern key
 * is unique, so calling this again (retry, refresh, the streak continuing)
 * returns the existing alert instead of creating a new one.
 */
export function evaluateAndRecordAlert(
  playerId: string,
  signature: string,
): { pattern: PatternState; alert: { id: string; created: boolean; message: string } | null } {
  return tx((db) => {
    const pattern = evaluatePattern(allFacts(playerId), signature);
    if (pattern.state !== "alert" || !pattern.patternKey) return { pattern, alert: null };

    const existing = db.prepare("SELECT id, message FROM alerts WHERE pattern_key = ?").get(pattern.patternKey) as
      | { id: string; message: string }
      | undefined;
    if (existing) return { pattern, alert: { id: existing.id, created: false, message: existing.message } };

    const player = getPlayer(playerId);
    const counts = pattern.alertSessions.map((s) => s.hintCount);
    const message = alertMessage(player.familyName, player.pronoun, pattern.baseline, counts);
    const id = uid("al");
    db.prepare(
      `INSERT INTO alerts (id, player_id, caregiver_id, game, pattern_key, baseline, threshold, hint_counts, session_ids, message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      playerId,
      player.alertCaregiverId,
      MEMORY_GAME,
      pattern.patternKey,
      pattern.baseline,
      pattern.threshold,
      JSON.stringify(counts),
      JSON.stringify(pattern.alertSessions.map((s) => s.id)),
      message,
      nowIso(),
    );
    return { pattern, alert: { id, created: true, message } };
  });
}

/** Finish a round: count hints server-side, evaluate the rule, alert + push if needed. Idempotent. */
export async function completeSession(sessionId: string): Promise<CompletionResult> {
  const before = requireOpen(sessionId);
  if (before.status === "interrupted") throw new HttpError(409, "This round was interrupted and can't be completed.");
  if (before.status === "in_progress") {
    tx((db) => {
      const count = (db.prepare("SELECT COUNT(*) AS n FROM hint_events WHERE session_id = ?").get(sessionId) as { n: number }).n;
      db.prepare(
        "UPDATE memory_sessions SET status = 'completed', ended_at = ?, hint_count = ? WHERE id = ? AND status = 'in_progress'",
      ).run(nowIso(), count, sessionId);
    });
  }
  const s = requireOpen(sessionId);
  const facts = toFacts(s);
  const { pattern, alert } = evaluateAndRecordAlert(s.player_id, s.signature);

  let delivery: DeliverySummary | null = null;
  if (alert) {
    // Safe to call on every completion: each (alert, device) is pushed once.
    delivery = await deliverAlert(alert.id);
  }
  return {
    sessionId,
    hintCount: s.hint_count,
    excludedReason: excludedReason(facts),
    pattern: publicPattern(pattern),
    alert,
    delivery,
  };
}

// ---------------------------------------------------------------------------
// Read models for the family dashboard.

export function sessionHistory(): { sessions: MemorySessionView[]; pattern: PublicPattern; signature: string | null } {
  const player = getPlayer();
  const room = getRoom(player.id);
  const rows = getDb()
    .prepare("SELECT * FROM memory_sessions WHERE player_id = ? ORDER BY COALESCE(ended_at, started_at) DESC LIMIT 60")
    .all(player.id) as unknown as SessionRow[];
  const facts = allFacts(player.id);
  const signature = room?.signature ?? null;
  const pattern = signature ? evaluatePattern(facts, signature) : null;
  const baselineIds = new Set(pattern && pattern.state !== "building" ? pattern.baselineSessions.map((s) => s.id) : []);
  const comparedIds = new Set(pattern && pattern.state !== "building" ? pattern.compared.map((s) => s.id) : []);
  const threshold = pattern && pattern.state !== "building" ? pattern.threshold : null;

  const sessions: MemorySessionView[] = rows.map((r) => {
    const f = toFacts(r);
    const reason = excludedReason(f);
    const role: MemorySessionView["role"] =
      r.signature !== signature ? "other-setup" : reason ? "excluded" : baselineIds.has(r.id) ? "baseline" : comparedIds.has(r.id) ? "compared" : "baseline";
    return {
      id: r.id,
      status: r.status,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      hintCount: r.hint_count,
      micFailures: r.mic_failures,
      playbackFailures: r.playback_failures,
      wrongChoices: r.wrong_choices,
      objectCount: r.object_count,
      signature: r.signature,
      difficulty: r.difficulty as MemorySessionView["difficulty"],
      seeded: r.seeded === 1,
      valid: reason === null,
      excludedReason: r.signature !== signature ? "Different objects, places or difficulty" : reason,
      role,
      elevated: role === "compared" && threshold !== null && r.hint_count >= threshold,
    };
  });
  return {
    sessions,
    pattern: pattern ? publicPattern(pattern) : { state: "building", baseline: null, threshold: null, needed: 5, streak: 0 },
    signature,
  };
}

export function listAlerts(): AlertView[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT a.*, c.name AS caregiver_name FROM alerts a LEFT JOIN caregivers c ON c.id = a.caregiver_id
       ORDER BY a.created_at DESC LIMIT 50`,
    )
    .all() as {
    id: string;
    game: string;
    message: string;
    baseline: number;
    threshold: number;
    hint_counts: string;
    session_ids: string;
    created_at: string;
    seen_at: string | null;
    caregiver_id: string | null;
    caregiver_name: string | null;
  }[];
  return rows.map((r) => {
    const deliveries = db
      .prepare(
        `SELECT d.status, d.status_code, d.attempted_at, s.device_label FROM alert_deliveries d
         LEFT JOIN push_subscriptions s ON s.id = d.subscription_id WHERE d.alert_id = ? ORDER BY d.attempted_at`,
      )
      .all(r.id) as { status: string; status_code: number | null; attempted_at: string; device_label: string | null }[];
    return {
      id: r.id,
      game: r.game,
      message: r.message,
      baseline: r.baseline,
      threshold: r.threshold,
      hintCounts: JSON.parse(r.hint_counts),
      sessionIds: JSON.parse(r.session_ids),
      createdAt: r.created_at,
      seenAt: r.seen_at,
      caregiverId: r.caregiver_id,
      caregiverName: r.caregiver_name,
      deliveries: deliveries.map((d) => ({ status: d.status, statusCode: d.status_code, device: d.device_label, at: d.attempted_at })),
    };
  });
}

export function markAlertSeen(id: string): boolean {
  const res = getDb().prepare("UPDATE alerts SET seen_at = COALESCE(seen_at, ?) WHERE id = ?").run(nowIso(), id);
  return res.changes > 0;
}
