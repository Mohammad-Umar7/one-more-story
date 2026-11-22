import { HttpError, optStr, readJson, route, str } from "@/lib/server/http";
import { getDb } from "@/lib/server/db";
import { currentPlayerId } from "@/lib/server/bundle";
import { upsertCompanionMember } from "@/lib/server/family";
import { onboardingState } from "@/lib/server/companion";

// Step 1: who the family member is, and who they're setting this up for.
export const POST = route(async (req: Request) => {
  const body = await readJson<{
    memberName?: string;
    relation?: string;
    playerName?: string;
    callName?: string;
    pronoun?: string;
    lang?: string;
    consent?: boolean;
  }>(req);
  if (body.consent !== true) throw new HttpError(400, "Please agree to use your voice and photo first");
  const memberName = str(body.memberName, "your name", 40);
  const relation = str(body.relation, "how you're related", 40);
  const playerName = str(body.playerName, "their name", 40);
  const callName = optStr(body.callName, 40) ?? playerName;
  const pronoun = body.pronoun === "he" || body.pronoun === "she" ? body.pronoun : "they";
  const lang = /^[a-z]{2,3}(-[A-Z]{2})?$/.test(String(body.lang ?? "")) ? String(body.lang) : "en-US";
  const playerId = currentPlayerId();
  getDb()
    .prepare("UPDATE players SET name = ?, family_name = ?, pronoun = ?, speech_lang = ? WHERE id = ?")
    .run(playerName, callName, pronoun, lang, playerId);
  upsertCompanionMember(playerId, { name: memberName, relation, consent: true });
  return Response.json(onboardingState());
});
