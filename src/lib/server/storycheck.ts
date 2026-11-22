// Server side of the story game's starting point: store each finished game,
// make the first one the player's own baseline, and tell the family once.

import { getDb, nowIso, tx, uid } from "./db";
import { currentPlayerId, getPlayer } from "./bundle";
import { notifyFamily } from "./push";
import { baselineMessage, compareWithBaseline, type StoryAnswer, type StoryCheckView } from "../shared/storycheck";

interface Row {
  id: string;
  total: number;
  correct: number;
  answers: string;
  is_baseline: number;
  created_at: string;
}

function view(row: Row, baseline: Row | null): StoryCheckView {
  const isBaseline = row.is_baseline === 1;
  return {
    id: row.id,
    createdAt: row.created_at,
    total: row.total,
    correct: row.correct,
    answers: JSON.parse(row.answers) as StoryAnswer[],
    isBaseline,
    comparison: !isBaseline && baseline ? compareWithBaseline(baseline, row) : null,
  };
}

function baselineRow(playerId: string): Row | null {
  return (getDb().prepare("SELECT * FROM story_checks WHERE player_id = ? AND is_baseline = 1").get(playerId) as Row | undefined) ?? null;
}

/** The starting point and every game, newest first. */
export function listStoryChecks(playerId = currentPlayerId()): { baseline: StoryCheckView | null; checks: StoryCheckView[] } {
  const base = baselineRow(playerId);
  const rows = getDb().prepare("SELECT * FROM story_checks WHERE player_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 30").all(playerId) as unknown as Row[];
  return { baseline: base ? view(base, null) : null, checks: rows.map((r) => view(r, base)) };
}

/**
 * Save a finished story game. Retries with the same clientKey return the same
 * game. The first game of a player becomes the starting point, and the
 * family's phones are told once.
 */
export async function recordStoryCheck(input: { clientKey: string; answers: StoryAnswer[] }): Promise<{ check: StoryCheckView; baselineCreated: boolean }> {
  const playerId = currentPlayerId();
  const total = input.answers.length;
  const correct = input.answers.filter((a) => a.right).length;
  const result = tx((db) => {
    const existing = db.prepare("SELECT * FROM story_checks WHERE client_key = ?").get(input.clientKey) as Row | undefined;
    if (existing) return { row: existing, created: false };
    const hasBaseline = !!db.prepare("SELECT 1 FROM story_checks WHERE player_id = ? AND is_baseline = 1").get(playerId);
    const row: Row = {
      id: uid("sc"),
      total,
      correct,
      answers: JSON.stringify(input.answers),
      is_baseline: hasBaseline ? 0 : 1,
      created_at: nowIso(),
    };
    db.prepare("INSERT INTO story_checks (id, player_id, client_key, total, correct, answers, is_baseline, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      row.id,
      playerId,
      input.clientKey,
      row.total,
      row.correct,
      row.answers,
      row.is_baseline,
      row.created_at,
    );
    return { row, created: row.is_baseline === 1 };
  });

  if (result.created) {
    const player = getPlayer(playerId);
    const msg = baselineMessage(player.familyName || player.name, result.row);
    await notifyFamily(playerId, { ...msg, tag: "story-baseline", url: "/family" }).catch(() => undefined);
  }
  return { check: view(result.row, baselineRow(playerId)), baselineCreated: result.created };
}

/** Forget every story game, so the next one sets a new starting point. */
export function clearStoryChecks(): void {
  getDb().prepare("DELETE FROM story_checks").run();
}
