import { route } from "@/lib/server/http";
import { localDay, makePlan } from "@/lib/server/planner";
import { planContext, servePlan } from "@/lib/server/companion";

// Family: make a fresh set of games for today at the current baseline.
export const POST = route(async () => {
  const plan = await makePlan(planContext(), localDay());
  return Response.json({ plan: servePlan(plan) });
});
