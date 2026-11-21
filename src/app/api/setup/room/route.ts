import { readJson, route } from "@/lib/server/http";
import { saveRoom } from "@/lib/server/content";
import { getRoom } from "@/lib/server/bundle";

export const PUT = route(async (req: Request) => {
  saveRoom(await readJson(req));
  return Response.json({ room: getRoom() });
});
