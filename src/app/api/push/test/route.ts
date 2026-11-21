import { readJson, route, str } from "@/lib/server/http";
import { sendTestNotification } from "@/lib/server/push";

export const POST = route(async (req: Request) => {
  const body = await readJson<{ caregiverId?: string }>(req);
  return Response.json(await sendTestNotification(str(body.caregiverId, "caregiverId", 60)));
});
