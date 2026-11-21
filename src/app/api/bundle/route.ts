import { getBundle } from "@/lib/server/bundle";
import { route } from "@/lib/server/http";

export const GET = route(async () => Response.json(getBundle(), { headers: { "Cache-Control": "no-store" } }));
