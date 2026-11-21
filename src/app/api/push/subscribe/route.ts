import { HttpError, optStr, readJson, route, str } from "@/lib/server/http";
import { saveSubscription, type BrowserSubscription } from "@/lib/server/push";

export const POST = route(async (req: Request) => {
  const body = await readJson<{
    caregiverId?: string;
    pairCode?: string;
    subscription?: BrowserSubscription;
    deviceLabel?: string;
  }>(req);
  if (!body.subscription) throw new HttpError(400, "Missing subscription");
  try {
    const res = saveSubscription({
      caregiverId: str(body.caregiverId, "caregiverId", 60),
      pairCode: str(body.pairCode, "pairCode", 60),
      subscription: body.subscription,
      deviceLabel: optStr(body.deviceLabel, 80),
    });
    return Response.json(res);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, (err as Error).message);
  }
});
