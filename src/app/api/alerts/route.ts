import { route } from "@/lib/server/http";
import { listAlerts } from "@/lib/server/memory";
import { ensureSeeded } from "@/lib/server/seed";

export const GET = route(async () => {
  ensureSeeded();
  return Response.json({ alerts: listAlerts() }, { headers: { "Cache-Control": "no-store" } });
});
