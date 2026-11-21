import { HttpError, readJson, route, str } from "@/lib/server/http";
import { listStories, saveStory } from "@/lib/server/content";

export const GET = route(async () => Response.json({ stories: listStories() }, { headers: { "Cache-Control": "no-store" } }));

export const POST = route(async (req: Request) => {
  const body = await readJson<{
    clientKey?: string;
    photoId?: string;
    clips?: { mediaId: string; prompt?: string; transcript?: string }[];
  }>(req);
  if (!Array.isArray(body.clips)) throw new HttpError(400, "Missing clips");
  return Response.json(
    saveStory({
      clientKey: str(body.clientKey, "clientKey", 80),
      photoId: str(body.photoId, "photoId", 60),
      clips: body.clips.slice(0, 30).map((c) => ({
        mediaId: String(c.mediaId),
        prompt: typeof c.prompt === "string" ? c.prompt : null,
        transcript: typeof c.transcript === "string" ? c.transcript : null,
      })),
    }),
  );
});
