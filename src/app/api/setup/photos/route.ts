import { HttpError, readJson, route } from "@/lib/server/http";
import { saveStoryPhotos } from "@/lib/server/content";
import { getStoryPhotos } from "@/lib/server/bundle";

export const PUT = route(async (req: Request) => {
  const body = await readJson<{ photos?: { id?: string; mediaId: string; title: string }[] }>(req);
  if (!Array.isArray(body.photos)) throw new HttpError(400, "Missing photos");
  saveStoryPhotos(body.photos.slice(0, 30));
  return Response.json({ photos: getStoryPhotos() });
});
