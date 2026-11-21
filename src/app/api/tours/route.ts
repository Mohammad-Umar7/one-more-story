import { readJson, route, str } from "@/lib/server/http";
import { listTours, startTour } from "@/lib/server/content";

export const GET = route(async () => Response.json({ tours: listTours() }, { headers: { "Cache-Control": "no-store" } }));

export const POST = route(async (req: Request) => {
  const body = await readJson<{ clientKey?: string; routeId?: string }>(req);
  return Response.json(startTour({ clientKey: str(body.clientKey, "clientKey", 80), routeId: str(body.routeId, "routeId", 60) }));
});
