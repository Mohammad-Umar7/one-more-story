import { HttpError, readJson, route, str } from "@/lib/server/http";
import { ensureSeeded } from "@/lib/server/seed";
import { listStoryChecks, recordStoryCheck } from "@/lib/server/storycheck";
import type { StoryAnswer } from "@/lib/shared/storycheck";

// The story game's starting point and how each later game compares with it.
export const GET = route(async () => {
  ensureSeeded();
  return Response.json(listStoryChecks());
});

// A finished story game. The first one becomes the starting point and the
// family's phones are told; later ones are compared with it.
export const POST = route(async (req: Request) => {
  ensureSeeded();
  const body = await readJson<{ clientKey?: unknown; answers?: unknown }>(req);
  const clientKey = str(body.clientKey, "clientKey", 80);
  if (!Array.isArray(body.answers) || body.answers.length === 0 || body.answers.length > 12) {
    throw new HttpError(400, "answers must list 1 to 12 answers");
  }
  const answers: StoryAnswer[] = body.answers.map((a: { topic?: unknown; right?: unknown; words?: unknown }) => ({
    topic: str(a?.topic, "topic", 80),
    right: a?.right === true,
    words: Math.max(0, Math.min(500, Math.round(Number(a?.words) || 0))),
  }));
  return Response.json(await recordStoryCheck({ clientKey, answers }));
});
