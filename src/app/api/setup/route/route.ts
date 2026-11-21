import { readJson, route } from "@/lib/server/http";
import { saveRoute } from "@/lib/server/content";
import { getRoute } from "@/lib/server/bundle";

export const PUT = route(async (req: Request) => {
  saveRoute(await readJson(req));
  return Response.json({ route: getRoute() });
});
