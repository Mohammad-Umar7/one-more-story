import { HttpError, route } from "@/lib/server/http";
import { getDb } from "@/lib/server/db";
import { saveMedia } from "@/lib/server/media";
import { currentPlayerId } from "@/lib/server/bundle";
import { getCompanionMember, updateMember } from "@/lib/server/family";
import { makeAvatar } from "@/lib/server/art";
import { onboardingState } from "@/lib/server/companion";

const IMAGE = ["image/jpeg", "image/png", "image/webp"];

// Step 2: the family member's photo (their avatar is painted from it in the
// background), or the player's own photo (who: "player").
export const POST = route(async (req: Request) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob)) throw new HttpError(400, "Missing photo");
  if (!IMAGE.includes(file.type)) throw new HttpError(415, "Please choose a JPEG, PNG or WebP photo");
  const who = form?.get("who") === "player" ? "player" : "member";
  const playerId = currentPlayerId();
  const row = saveMedia({ data: Buffer.from(await file.arrayBuffer()), mime: file.type });
  if (who === "player") {
    getDb().prepare("UPDATE players SET photo_media_id = ? WHERE id = ?").run(row.id, playerId);
    return Response.json(onboardingState());
  }
  const member = getCompanionMember(playerId);
  if (!member) throw new HttpError(400, "Tell us who you are first");
  updateMember(member.id, { photo_media_id: row.id, avatar_status: "working" });
  // Painting takes a little while; the page polls the state.
  void makeAvatar(member.id).catch(() => undefined);
  return Response.json(onboardingState());
});
