import { HttpError, route, type IdParams } from "@/lib/server/http";
import { archiveMemory, getMemory } from "@/lib/server/life";
import { paintMemory } from "@/lib/server/art";

// Take a memory out of the games (kept on disk, just hidden).
export const DELETE = route(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  if (!getMemory(id)) throw new HttpError(404, "Memory not found");
  archiveMemory(id);
  return Response.json({ ok: true });
});

// Paint it again.
export const POST = route(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  if (!getMemory(id)) throw new HttpError(404, "Memory not found");
  void paintMemory(id);
  return Response.json({ ok: true });
});
