import { HttpError, route } from "@/lib/server/http";
import { buildStatus, startBuild } from "@/lib/server/companion";

// Step 6: turn everything the family gave us into the player's world.
export const POST = route(async () => {
  try {
    return Response.json(startBuild());
  } catch (err) {
    throw new HttpError(400, (err as Error).message);
  }
});

export const GET = route(async () => Response.json(buildStatus()));
