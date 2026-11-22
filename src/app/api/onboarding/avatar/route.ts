import { HttpError, readJson, route } from "@/lib/server/http";
import { currentPlayerId } from "@/lib/server/bundle";
import { getCompanionMember, updateMember } from "@/lib/server/family";
import { makeAvatar } from "@/lib/server/art";
import { onboardingState } from "@/lib/server/companion";

// Paint the avatar again, or choose between the painting and the real photo.
export const POST = route(async (req: Request) => {
  const body = await readJson<{ action?: "repaint" | "use_photo" | "use_avatar" }>(req);
  const member = getCompanionMember(currentPlayerId());
  if (!member?.photo_media_id) throw new HttpError(400, "Add a photo first");
  if (body.action === "use_photo") updateMember(member.id, { show_photo: 1 });
  else if (body.action === "use_avatar") updateMember(member.id, { show_photo: 0 });
  else {
    if (member.avatar_status === "working") throw new HttpError(409, "Still painting");
    updateMember(member.id, { avatar_status: "working", show_photo: 0 });
    void makeAvatar(member.id).catch(() => undefined);
  }
  return Response.json(onboardingState());
});
