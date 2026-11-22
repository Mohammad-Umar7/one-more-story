import { readJson, route } from "@/lib/server/http";
import { clearMemoryHistory, ensureSeeded, restoreDemo, seedMemoryHistory } from "@/lib/server/seed";

// scope "history": put My Memory Room back to the demo baseline (1,0,1,2,1 then 3,3)
//                  and clear alerts, so the live demo can run again.
// scope "fresh":   no history at all, for a real new player: their own usual
//                  level is learned from their first five full rounds.
// scope "all":     restore all demo content as well. Phone subscriptions are kept.
export const POST = route(async (req: Request) => {
  const body = await readJson<{ scope?: string }>(req);
  ensureSeeded();
  if (body.scope === "all") restoreDemo();
  else if (body.scope === "fresh") clearMemoryHistory();
  else seedMemoryHistory();
  return Response.json({ ok: true });
});
