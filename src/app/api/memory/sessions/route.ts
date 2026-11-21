import { readJson, route, str } from "@/lib/server/http";
import { startSession } from "@/lib/server/memory";

export const POST = route(async (req: Request) => {
  const body = await readJson<{ clientKey?: string }>(req);
  return Response.json(startSession(str(body.clientKey, "clientKey", 80)));
});
