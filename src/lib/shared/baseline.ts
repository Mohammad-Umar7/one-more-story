// The hackathon alert rule for My Memory Room, kept as pure functions so the
// server and the tests run exactly the same logic.
//
//   * Only My Memory Room sessions count.
//   * A hint is counted when a requested clue actually starts playing; each
//     playback is counted once (deduplicated by playback id on the server).
//   * Baseline = median hint count of the player's first five valid
//     four-object sessions with the same objects (in the same places) and the
//     same difficulty. Interrupted sessions and sessions affected by mic or
//     playback failures are excluded.
//   * Three consecutive comparable sessions, each using at least two hints
//     above baseline, create one caregiver alert. The alert is keyed by the
//     first session of the streak, so retries and a continuing streak never
//     create a second alert.
//
// These are prototype gameplay thresholds. They describe a change in how much
// help was asked for in one game. They are not a medical assessment.

import type { Pronoun } from "./types";

export const BASELINE_SESSIONS = 5;
export const HINTS_ABOVE_BASELINE = 2;
export const CONSECUTIVE_SESSIONS = 3;
export const OBJECTS_PER_ROUND = 4;
export const MEMORY_GAME = "My Memory Room";

export interface SessionFacts {
  id: string;
  signature: string;
  status: "in_progress" | "completed" | "interrupted";
  objectCount: number;
  hintCount: number;
  micFailures: number;
  playbackFailures: number;
  endedAt: string | null; // ISO time the round finished
  startedAt: string;
}

export function excludedReason(s: SessionFacts): string | null {
  if (s.status === "in_progress") return "Not finished";
  if (s.status === "interrupted") return "Interrupted before the end";
  if (s.objectCount !== OBJECTS_PER_ROUND) return `Used ${s.objectCount} objects, not ${OBJECTS_PER_ROUND}`;
  if (s.micFailures > 0) return "Microphone problem during the round";
  if (s.playbackFailures > 0) return "A clue or prompt failed to play";
  return null;
}

export function isValidSession(s: SessionFacts): boolean {
  return excludedReason(s) === null;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function chronological(a: SessionFacts, b: SessionFacts): number {
  const ta = a.endedAt ?? a.startedAt;
  const tb = b.endedAt ?? b.startedAt;
  return ta < tb ? -1 : ta > tb ? 1 : a.id < b.id ? -1 : 1;
}

export type PatternState =
  | { state: "building"; signature: string; validCount: number; needed: number; comparable: SessionFacts[] }
  | {
      state: "watching" | "alert";
      signature: string;
      baseline: number;
      threshold: number;
      baselineSessions: SessionFacts[];
      compared: SessionFacts[];
      streak: SessionFacts[];
      patternKey: string | null;
      alertSessions: SessionFacts[];
    };

export function evaluatePattern(all: SessionFacts[], signature: string): PatternState {
  const comparable = all.filter((s) => s.signature === signature && isValidSession(s)).sort(chronological);

  if (comparable.length < BASELINE_SESSIONS) {
    return {
      state: "building",
      signature,
      validCount: comparable.length,
      needed: BASELINE_SESSIONS - comparable.length,
      comparable,
    };
  }

  const baselineSessions = comparable.slice(0, BASELINE_SESSIONS);
  const baseline = median(baselineSessions.map((s) => s.hintCount));
  const threshold = baseline + HINTS_ABOVE_BASELINE;
  const compared = comparable.slice(BASELINE_SESSIONS);

  // The run of elevated sessions that ends with the most recent session.
  const streak: SessionFacts[] = [];
  for (let i = compared.length - 1; i >= 0; i--) {
    if (compared[i].hintCount >= threshold) streak.unshift(compared[i]);
    else break;
  }

  const active = streak.length >= CONSECUTIVE_SESSIONS;
  return {
    state: active ? "alert" : "watching",
    signature,
    baseline,
    threshold,
    baselineSessions,
    compared,
    streak,
    // One alert per streak: the streak's first session never changes while
    // the pattern continues, so the key (and the alert) stay the same.
    patternKey: active ? `memory-room|${signature}|${streak[0].id}` : null,
    alertSessions: active ? streak.slice(-CONSECUTIVE_SESSIONS) : [],
  };
}

function formatCount(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function plural(n: number, word: string): string {
  return `${formatCount(n)} ${word}${n === 1 ? "" : "s"}`;
}

function listCounts(counts: number[]): string {
  if (counts.every((c) => c === counts[0])) return `${plural(counts[0], "hint")} each time`;
  const parts = counts.map(formatCount);
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]} hints`;
}

/** "Dad usually uses 1 hint per round. In his last 3 sessions, he used 3 hints each time." */
export function alertMessage(familyName: string, pronoun: Pronoun, baseline: number, counts: number[]): string {
  const possessive = pronoun === "he" ? "his" : pronoun === "she" ? "her" : "their";
  return (
    `${familyName} usually uses ${plural(baseline, "hint")} per round. ` +
    `In ${possessive} last ${counts.length} sessions, ${pronoun} used ${listCounts(counts)}.`
  );
}

/** Stable identity for "the same objects in the same places, same difficulty". */
export function roundSignature(difficulty: string, objects: { id: string; spotId: string }[]): string {
  const parts = objects.map((o) => `${o.id}@${o.spotId}`).sort();
  return `${difficulty}|${parts.join(",")}`;
}
