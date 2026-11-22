import { HttpError, route } from "@/lib/server/http";
import { saveMedia } from "@/lib/server/media";
import { currentPlayerId } from "@/lib/server/bundle";
import { getCompanionMember, saveVoiceLine } from "@/lib/server/family";
import { describeAiError, transcribe } from "@/lib/server/openrouter";
import { VOICE_LINES, type VoiceLineKey } from "@/lib/shared/companion";

export const maxDuration = 60;

// Step 4: a short line in the family member's own voice ("Hello Baba, it's me!").
// The player hears these real recordings at the warmest moments.
export const POST = route(async (req: Request) => {
  const form = await req.formData().catch(() => null);
  const key = String(form?.get("key") ?? "") as VoiceLineKey;
  if (!VOICE_LINES.some((l) => l.key === key)) throw new HttpError(400, "Unknown line");
  const file = form?.get("file");
  if (!(file instanceof Blob) || file.size < 800) throw new HttpError(400, "That recording was empty");
  const mime = file.type.split(";")[0] || "audio/wav";
  const member = getCompanionMember(currentPlayerId());
  if (!member) throw new HttpError(400, "Tell us who you are first");
  const data = Buffer.from(await file.arrayBuffer());
  let transcript = "";
  try {
    transcript = await transcribe(data, mime);
  } catch (err) {
    // Keep the recording even if we couldn't check it.
    console.warn("[onboarding] line check failed:", describeAiError(err));
    transcript = "-";
  }
  if (!transcript) throw new HttpError(422, "I couldn't hear anything. Please try again a little closer.");
  const duration = Number(form?.get("durationMs"));
  const media = saveMedia({ data, mime, durationMs: Number.isFinite(duration) && duration > 0 ? duration : null, transcript: transcript === "-" ? null : transcript });
  saveVoiceLine(member.id, key, media.id, transcript === "-" ? null : transcript);
  return Response.json({ ok: true, key, transcript: transcript === "-" ? null : transcript });
});
