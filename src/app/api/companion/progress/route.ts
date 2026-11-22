import { route } from "@/lib/server/http";
import { baselineHistory } from "@/lib/server/assess";
import { planningNow, playerContext } from "@/lib/server/companion";
import { recentPlans } from "@/lib/server/planner";
import { sessionSpend } from "@/lib/server/openrouter";

// Family: how the baseline has moved and what the recent games were.
export const GET = route(async () => {
  const ctx = playerContext();
  return Response.json({
    history: baselineHistory(ctx.playerId, 30),
    plans: recentPlans(ctx.playerId, 7).map((p) => ({
      id: p.id,
      day: p.day,
      stage: p.stage,
      level: p.level,
      status: p.status,
      source: p.source,
      games: p.games.map((g) => ({ kind: g.kind, title: g.title, items: g.items.length })),
    })),
    planning: planningNow(),
    aiSpendThisSession: Math.round(sessionSpend() * 1000) / 1000,
  });
});
