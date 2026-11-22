import { HttpError, readJson, route } from "@/lib/server/http";
import { getDb, setSetting } from "@/lib/server/db";
import { currentPlayerId } from "@/lib/server/bundle";

type GlobalBuild = typeof globalThis & { __omsBuild?: unknown; __omsBuilding?: unknown };

// Family: start the companion over (a new family member, a new story).
// Removes the family member, their recordings and avatar links, the life
// story, baselines, daily games and results. Photos and recordings stay on
// disk until the data folder is cleared. The classic games are untouched.
export const POST = route(async (req: Request) => {
  const body = await readJson<{ confirm?: string }>(req);
  if (body.confirm !== "start-over") throw new HttpError(400, "Please confirm");
  const g = globalThis as GlobalBuild;
  if (g.__omsBuilding) throw new HttpError(409, "Still building, try again in a minute");
  const playerId = currentPlayerId();
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM game_results WHERE plan_id IN (SELECT id FROM daily_plans WHERE player_id = ?)").run(playerId);
    db.prepare("DELETE FROM daily_plans WHERE player_id = ?").run(playerId);
    db.prepare("DELETE FROM baselines WHERE player_id = ?").run(playerId);
    db.prepare("DELETE FROM memories WHERE player_id = ?").run(playerId);
    db.prepare("DELETE FROM family_members WHERE player_id = ?").run(playerId); // lines and answers cascade
    db.prepare("UPDATE players SET onboarded_at = NULL, photo_media_id = NULL WHERE id = ?").run(playerId);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  setSetting("build_status", "");
  g.__omsBuild = undefined;
  return Response.json({ ok: true });
});
