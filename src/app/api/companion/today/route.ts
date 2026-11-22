import { route } from "@/lib/server/http";
import { todayPlan } from "@/lib/server/companion";

export const maxDuration = 180;

// Today's games for the player's screen (made now if there are none yet).
export const GET = route(async () => Response.json({ plan: await todayPlan() }));
