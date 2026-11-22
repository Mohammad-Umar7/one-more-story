import { route } from "@/lib/server/http";
import { todayPlan } from "@/lib/server/companion";
import { planResults } from "@/lib/server/assess";

export const maxDuration = 180;

// Today's games for the player's screen (made now if there are none yet),
// and which items were already played, so a closed app picks up where it was.
export const GET = route(async () => {
  const plan = await todayPlan();
  const played = planResults(plan.id).map((r) => `${r.gameId}/${r.itemId}`);
  return Response.json({ plan, played });
});
