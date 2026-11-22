import { HttpError, route } from "@/lib/server/http";
import { saveMedia } from "@/lib/server/media";
import { currentPlayerId } from "@/lib/server/bundle";
import { addMemory, lifeDigest, listMemories } from "@/lib/server/life";
import { extractOneMemory, type ExtractedMemory } from "@/lib/server/interview";
import { paintMemories } from "@/lib/server/art";
import { playerContext } from "@/lib/server/companion";
import { describeAiError, transcribe } from "@/lib/server/openrouter";

const AUDIO = ["audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp4", "audio/webm", "audio/ogg"];
const IMAGE = ["image/jpeg", "image/png", "image/webp"];

export const GET = route(async () => Response.json({ memories: listMemories(currentPlayerId()) }));

// Something new from their life, told by the family or by the player:
// a recording and/or text, with an optional photo. The AI writes it up as a
// memory (with facts for tomorrow's games) and paints it if there's no photo.
export const POST = route(async (req: Request) => {
  const form = await req.formData().catch(() => null);
  if (!form) throw new HttpError(400, "Expected a form");
  const ctx = playerContext();
  const source = form.get("source") === "patient" ? "patient" : "family";
  const by = source === "patient" ? ctx.callName : String(form.get("by") ?? "").trim().slice(0, 40) || ctx.companion?.name || "Family";

  let text = String(form.get("text") ?? "").trim().slice(0, 6000);
  let clipId: string | null = null;
  const audio = form.get("audio");
  if (audio instanceof Blob && audio.size > 800) {
    const mime = audio.type.split(";")[0];
    if (!AUDIO.includes(mime)) throw new HttpError(415, "Unsupported recording type");
    const data = Buffer.from(await audio.arrayBuffer());
    let heard = "";
    try {
      heard = await transcribe(data, mime);
    } catch (err) {
      console.warn("[memories] transcript failed:", describeAiError(err));
    }
    const typedTranscript = String(form.get("transcript") ?? "").trim();
    heard = heard || typedTranscript;
    if (heard) {
      const duration = Number(form.get("durationMs"));
      clipId = saveMedia({ data, mime, durationMs: Number.isFinite(duration) && duration > 0 ? duration : null, transcript: heard.slice(0, 2000) }).id;
      text = [text, heard].filter(Boolean).join("\n");
    }
  }
  if (text.split(/\s+/).filter(Boolean).length < 3) throw new HttpError(422, "Tell me a little more, a sentence or two is perfect.");

  let photoId: string | null = null;
  const photo = form.get("photo");
  if (photo instanceof Blob && photo.size > 0) {
    if (!IMAGE.includes(photo.type)) throw new HttpError(415, "Please choose a JPEG, PNG or WebP photo");
    photoId = saveMedia({ data: Buffer.from(await photo.arrayBuffer()), mime: photo.type }).id;
  }

  let extracted: ExtractedMemory[];
  try {
    extracted = await extractOneMemory({ text, callName: ctx.callName, by, known: lifeDigest(listMemories(ctx.playerId), 25) });
  } catch (err) {
    console.warn("[memories] extraction failed:", describeAiError(err));
    extracted = [];
  }
  if (!extracted.length) {
    extracted = [{ kind: "event" as const, title: text.split(/[.!?]/)[0].slice(0, 50) || "A memory", detail: text.slice(0, 600), people: [], place: "", era: "", facts: [], art_prompt: text.slice(0, 300), from_question: "added" }];
  }
  const saved = extracted.map((e, i) =>
    addMemory(ctx.playerId, {
      kind: e.kind,
      title: e.title,
      detail: e.detail,
      people: e.people,
      place: e.place,
      era: e.era,
      facts: e.facts,
      artPrompt: i === 0 && photoId ? null : e.art_prompt,
      photoMediaId: i === 0 ? photoId : null,
      clipMediaId: clipId,
      clipBy: by,
      source,
      addedBy: by,
    }),
  );
  const toPaint = saved.filter((m) => m.artStatus === "working").map((m) => m.id);
  if (toPaint.length) void paintMemories(toPaint).catch(() => undefined);
  return Response.json({ memories: saved });
});
