import { route } from "@/lib/server/http";
import { sessionHistory } from "@/lib/server/memory";

export const GET = route(async () => Response.json(sessionHistory(), { headers: { "Cache-Control": "no-store" } }));
