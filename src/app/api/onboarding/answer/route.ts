import { HttpError, route } from "@/lib/server/http";
import { saveMedia } from "@/lib/server/media";
import { currentPlayerId, getPlayer } from "@/lib/server/bundle";
import { getCompanionMember, saveAnswer } from "@/lib/server/family";
import { hearAnswer, replyToText } from "@/lib/server/interview";
import { describeAiError } from "@/lib/server/openrouter";
import { fillQuestion, INTERVIEW, type Pronoun } from "@/lib/shared/onboarding";

const AUDIO = ["audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp4", "audio/webm", "audio/ogg"];

// Step 3: one answer to the story interview, recorded (or typed). The AI
// transcribes it, replies warmly, and may ask one follow-up question.
export const POST = route(async (req: Request) => {
  const form = await req.formData().catch(() => null);
  if (!form) throw new HttpError(400, "Expected a recording");
  const key = String(form.get("key") ?? "");
  const isFollowUp = form.get("followUp") === "1";
  const q = INTERVIEW.find((x) => x.key === key);
  if (!q) throw new HttpError(400, "Unknown question");

  const playerId = currentPlayerId();
  const player = getPlayer(playerId);
  const member = getCompanionMember(playerId);
  if (!member) throw new HttpError(400, "Tell us who you are first");
  const callName = player.familyName || player.name;
  const asked = isFollowUp ? String(form.get("question") ?? "").slice(0, 300) || "Tell me a little more." : fillQuestion(q.ask, callName, player.pronoun as Pronoun);
  const storeKey = isFollowUp ? `${key}__more` : key;

  const file = form.get("file");
  const typed = String(form.get("text") ?? "").trim().slice(0, 6000);

  if (file instanceof Blob && file.size > 0) {
    const mime = file.type.split(";")[0] || "audio/wav";
    if (!AUDIO.includes(mime)) throw new HttpError(415, "Please upload a WAV, MP3, M4A, WebM or OGG recording");
    const data = Buffer.from(await file.arrayBuffer());
    const duration = Number(form.get("durationMs"));
    let heard;
    try {
      heard = await hearAnswer({ audio: { data, mime }, question: asked, memberName: member.name, relation: member.relation, callName, isFollowUp });
    } catch (err) {
      console.warn("[onboarding] hearing the answer failed:", describeAiError(err));
      throw new HttpError(502, "I couldn't listen to that just now. Please try again.");
    }
    if (!heard.transcript) {
      return Response.json({ heard: false, reply: "I couldn't hear anything in that recording. Let's try once more, a little closer to the microphone." });
    }
    const media = saveMedia({ data, mime, durationMs: Number.isFinite(duration) && duration > 0 ? duration : null, transcript: heard.transcript.slice(0, 2000) });
    saveAnswer(member.id, { key: storeKey, question: asked, mediaId: media.id, transcript: heard.transcript, reply: heard.reply });
    return Response.json({ heard: true, transcript: heard.transcript, reply: heard.reply, followUp: heard.followUp });
  }

  if (!typed) throw new HttpError(400, "Record or type an answer");
  const reply = await replyToText({ question: asked, text: typed, memberName: member.name, callName });
  saveAnswer(member.id, { key: storeKey, question: asked, mediaId: null, transcript: typed, reply });
  return Response.json({ heard: true, transcript: typed, reply, followUp: null });
});
