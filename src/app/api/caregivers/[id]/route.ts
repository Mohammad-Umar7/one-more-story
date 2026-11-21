import { route, str, type IdParams } from "@/lib/server/http";
import { getCaregiverForPairing } from "@/lib/server/content";
import { getVapidKeys } from "@/lib/server/push";
import { ensureSeeded } from "@/lib/server/seed";

// Used by the caregiver's phone when it opens its pairing link.
export const GET = route(async (req: Request, ctx: IdParams) => {
  ensureSeeded();
  const { id } = await ctx.params;
  const code = str(new URL(req.url).searchParams.get("code"), "code", 60);
  return Response.json({ caregiver: getCaregiverForPairing(id, code), vapidPublicKey: getVapidKeys().publicKey });
});
