import { HttpError, readJson, route, type IdParams } from "@/lib/server/http";
import { getPlan } from "@/lib/server/planner";
import { saveResult } from "@/lib/server/assess";
import type { ItemResult } from "@/lib/shared/companion";

// One item played. Retries are safe: (plan, game, item) is unique.
export const POST = route(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const plan = getPlan(id);
  if (!plan) throw new HttpError(404, "Plan not found");
  const r = await readJson<ItemResult>(req);
  const game = plan.games.find((g) => g.id === r.gameId);
  if (!game || !game.items.some((i) => i.id === r.itemId)) throw new HttpError(400, "Unknown game item");
  saveResult(id, { ...r, kind: game.kind });
  return Response.json({ ok: true });
});
