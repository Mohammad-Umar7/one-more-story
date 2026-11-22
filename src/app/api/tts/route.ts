import { synthesize, TtsError } from "@/lib/server/tts";
// Registers the companion's matched voice with the speech module.
import "@/lib/server/family";
import { readJson } from "@/lib/server/http";
import { findRecorded, isRecordedOnly } from "@/lib/server/voicebank";

// Returns audio for one spoken reply: the family member's own recording when
// they recorded it. With recordings, an unrecorded line is 204 (silent). Without
// any, the matched AI voice speaks; other errors let the browser speak instead.
export async function POST(req: Request) {
  try {
    const { text } = await readJson<{ text?: string }>(req);
    if (typeof text !== "string") return Response.json({ error: "Missing text" }, { status: 400 });
    // The family member recorded this line: play their real voice.
    const recorded = findRecorded(text);
    if (recorded) {
      return new Response(new Uint8Array(recorded.audio), {
        headers: { "Content-Type": recorded.mime, "Content-Length": String(recorded.audio.byteLength), "Cache-Control": "no-store", "X-TTS-Cache": "recorded" },
      });
    }
    // Only the family member's real voice: a line they didn't record stays silent
    // (the browser shows it as a caption and never uses a synthetic voice).
    if (isRecordedOnly()) return new Response(null, { status: 204, headers: { "X-TTS-Cache": "silent" } });
    const { audio, mime, cached } = await synthesize(text);
    return new Response(new Uint8Array(audio), {
      headers: {
        "Content-Type": mime,
        "Content-Length": String(audio.byteLength),
        "Cache-Control": "private, max-age=86400",
        "X-TTS-Cache": cached ? "hit" : "miss",
      },
    });
  } catch (err) {
    if (err instanceof TtsError) {
      if (err.status !== 503) console.warn(`[tts] ${err.status} ${err.message}`);
      return Response.json({ error: err.message }, { status: err.status === 503 ? 503 : 502 });
    }
    console.warn("[tts] failed:", (err as Error)?.message ?? err);
    return Response.json({ error: "Speech failed" }, { status: 502 });
  }
}
