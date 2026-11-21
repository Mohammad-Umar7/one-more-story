import { readJson, route, str } from "@/lib/server/http";
import { isSubscribed, removeSubscription } from "@/lib/server/push";

// POST {endpoint}            -> is this device subscribed, and for whom?
// POST {endpoint, remove:1}  -> turn alerts off on this device
export const POST = route(async (req: Request) => {
  const body = await readJson<{ endpoint?: string; remove?: boolean }>(req);
  const endpoint = str(body.endpoint, "endpoint", 2000);
  if (body.remove) {
    removeSubscription(endpoint);
    return Response.json({ subscribed: false });
  }
  const sub = isSubscribed(endpoint);
  return Response.json({ subscribed: Boolean(sub), caregiverId: sub?.caregiverId ?? null });
});
