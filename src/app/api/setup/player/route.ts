import { readJson, route } from "@/lib/server/http";
import { updatePlayer } from "@/lib/server/content";
import { getPlayer } from "@/lib/server/bundle";

export const PUT = route(async (req: Request) => {
  updatePlayer(await readJson(req));
  return Response.json({ player: getPlayer() });
});
