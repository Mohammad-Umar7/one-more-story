// The companion speaks in a voice matched to the family member who recorded
// the story interview.
//
// With the OpenRouter key alone there is no voice cloning, so we do the next
// best thing, entirely with AI:
//   1. Gemini listens to their recordings and describes the voice (gender, age,
//      pitch, pace, accent, warmth) and shortlists the closest Gemini TTS voices.
//   2. Each candidate reads the same sentence in that style.
//   3. Gemini compares the candidates with the real recording and picks the
//      closest one, plus a style instruction ("soft Lahori English accent...").
// The player also hears the family member's REAL recordings at key moments
// (hello, well done, goodbye, and their stories).
//
// With ELEVENLABS_API_KEY set, the same recordings make an instant voice clone
// and every spoken line uses it instead.

import { AiError, audioPart, chatJson, describeAiError, modelFor } from "./openrouter";

export interface GeminiVoice {
  name: string;
  gender: "female" | "male";
  character: string;
}

/** Gemini TTS prebuilt voices. */
export const GEMINI_VOICES: GeminiVoice[] = [
  { name: "Zephyr", gender: "female", character: "bright" },
  { name: "Puck", gender: "male", character: "upbeat" },
  { name: "Charon", gender: "male", character: "informative, deep" },
  { name: "Kore", gender: "female", character: "firm" },
  { name: "Fenrir", gender: "male", character: "excitable" },
  { name: "Leda", gender: "female", character: "youthful" },
  { name: "Orus", gender: "male", character: "firm" },
  { name: "Aoede", gender: "female", character: "breezy" },
  { name: "Callirrhoe", gender: "female", character: "easy-going" },
  { name: "Autonoe", gender: "female", character: "bright" },
  { name: "Enceladus", gender: "male", character: "breathy, soft" },
  { name: "Iapetus", gender: "male", character: "clear" },
  { name: "Umbriel", gender: "male", character: "easy-going" },
  { name: "Algieba", gender: "male", character: "smooth" },
  { name: "Despina", gender: "female", character: "smooth" },
  { name: "Erinome", gender: "female", character: "clear" },
  { name: "Algenib", gender: "male", character: "gravelly" },
  { name: "Rasalgethi", gender: "male", character: "informative" },
  { name: "Laomedeia", gender: "female", character: "upbeat" },
  { name: "Achernar", gender: "female", character: "soft" },
  { name: "Alnilam", gender: "male", character: "firm" },
  { name: "Schedar", gender: "male", character: "even" },
  { name: "Gacrux", gender: "female", character: "mature" },
  { name: "Pulcherrima", gender: "female", character: "forward" },
  { name: "Achird", gender: "male", character: "friendly" },
  { name: "Zubenelgenubi", gender: "male", character: "casual" },
  { name: "Vindemiatrix", gender: "female", character: "gentle" },
  { name: "Sadachbia", gender: "male", character: "lively" },
  { name: "Sadaltager", gender: "male", character: "knowledgeable" },
  { name: "Sulafat", gender: "female", character: "warm" },
];

export const DEFAULT_VOICE = "Sulafat";

export function isGeminiVoice(name: string | null | undefined): name is string {
  return !!name && GEMINI_VOICES.some((v) => v.name === name);
}

export interface VoiceProfile {
  /** Gemini voice name. */
  voice: string;
  /** Extra TTS instructions to sound like the family member. */
  style: string | null;
  /** ElevenLabs voice id when the voice was cloned. */
  elevenVoiceId: string | null;
}

export interface VoiceMatch {
  voice: string;
  style: string;
  summary: string; // family-facing: "A warm male voice in his thirties with a soft Pakistani English accent"
}

interface Description {
  gender: "female" | "male" | "unclear";
  age: string;
  pitch: string;
  pace: string;
  accent: string;
  character: string;
  summary: string;
  style_instruction: string;
  shortlist: string[];
}

const SAMPLE_LINE = "Hello, it's lovely to see you today. Shall we look at some photos together?";

/** Step 1: describe the voice and shortlist candidates. */
async function describe(samples: { data: Buffer; mime: string }[]): Promise<Description> {
  const catalog = GEMINI_VOICES.map((v) => `${v.name} (${v.gender}, ${v.character})`).join("; ");
  return chatJson<Description>({
    role: "media",
    maxTokens: 2000,
    timeoutMs: 60_000,
    temperature: 0.2,
    schema: {
      name: "voice_description",
      schema: {
        type: "object",
        properties: {
          gender: { type: "string", enum: ["female", "male", "unclear"] },
          age: { type: "string" },
          pitch: { type: "string" },
          pace: { type: "string" },
          accent: { type: "string" },
          character: { type: "string" },
          summary: { type: "string" },
          style_instruction: { type: "string" },
          shortlist: { type: "array", items: { type: "string", enum: GEMINI_VOICES.map((v) => v.name) } },
        },
        required: ["gender", "age", "pitch", "pace", "accent", "character", "summary", "style_instruction", "shortlist"],
        additionalProperties: false,
      },
    },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "These recordings are one family member speaking. Describe their speaking voice so a text-to-speech system can sound as close to them as possible.\n" +
              "- summary: one friendly sentence for the family, e.g. \"A warm, deep male voice in his thirties with a gentle Pakistani English accent\".\n" +
              "- style_instruction: one or two sentences telling a TTS voice how to speak like them (accent, pace, warmth, how they stress words). Do not mention names.\n" +
              `- shortlist: the 4 closest voices from this catalog, best first, matching gender first: ${catalog}.`,
          },
          ...samples.map((s) => audioPart(s.data, s.mime)),
        ],
      },
    ],
  });
}

/** Step 3: pick the candidate that sounds most like the real person. */
async function pickClosest(
  original: { data: Buffer; mime: string },
  candidates: { voice: string; wav: Buffer }[],
): Promise<string> {
  const res = await chatJson<{ closest: string; why: string }>({
    role: "media",
    maxTokens: 1200,
    timeoutMs: 60_000,
    temperature: 0,
    schema: {
      name: "closest_voice",
      schema: {
        type: "object",
        properties: {
          closest: { type: "string", enum: candidates.map((c) => c.voice) },
          why: { type: "string" },
        },
        required: ["closest", "why"],
        additionalProperties: false,
      },
    },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "The first recording is a real person. The others are synthetic voices, in this order: " + candidates.map((c) => c.voice).join(", ") + ". Which synthetic voice sounds most like the real person (pitch, timbre, age, accent)?" },
          audioPart(original.data, original.mime),
          ...candidates.map((c) => audioPart(c.wav, "audio/wav")),
        ],
      },
    ],
  });
  return res.closest;
}

/**
 * Match a Gemini voice to the family member's recordings. `speak` renders a
 * line in a given voice and style (injected to avoid an import cycle with tts.ts).
 */
export async function matchVoice(
  samples: { data: Buffer; mime: string }[],
  speak: (text: string, profile: VoiceProfile) => Promise<Buffer>,
): Promise<VoiceMatch> {
  if (!samples.length) throw new AiError(400, "No recordings to match");
  // Keep the request small: the two longest recordings are plenty.
  const chosen = [...samples].sort((a, b) => b.data.byteLength - a.data.byteLength).slice(0, 2);
  const d = await describe(chosen);
  const wanted = d.gender === "unclear" ? null : d.gender;
  let shortlist = d.shortlist.filter((n) => isGeminiVoice(n) && (!wanted || GEMINI_VOICES.find((v) => v.name === n)?.gender === wanted));
  if (!shortlist.length) shortlist = GEMINI_VOICES.filter((v) => !wanted || v.gender === wanted).slice(0, 4).map((v) => v.name);
  shortlist = Array.from(new Set(shortlist)).slice(0, 4);
  const style = d.style_instruction.trim().slice(0, 400);

  let voice = shortlist[0];
  try {
    const rendered = await Promise.all(
      shortlist.map(async (v) => ({ voice: v, wav: await speak(SAMPLE_LINE, { voice: v, style, elevenVoiceId: null }) })),
    );
    if (rendered.length > 1) voice = await pickClosest(chosen[0], rendered);
  } catch (err) {
    console.warn("[voices] comparison skipped:", describeAiError(err));
  }
  return { voice, style, summary: d.summary.trim().slice(0, 240) };
}

// ---- ElevenLabs (optional true clone) ---------------------------------------

export function isElevenLabsConfigured(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY?.trim());
}

function elevenModel(): string {
  return process.env.ELEVENLABS_MODEL?.trim() || "eleven_multilingual_v2";
}

/** Instant voice clone from the interview recordings. Returns the voice id. */
export async function cloneWithElevenLabs(name: string, samples: { data: Buffer; mime: string; filename: string }[]): Promise<string> {
  const form = new FormData();
  form.append("name", `One More Story - ${name}`.slice(0, 90));
  form.append("description", "Family voice for a memory companion, recorded with consent.");
  form.append("remove_background_noise", "true");
  for (const s of samples.slice(0, 8)) form.append("files", new Blob([new Uint8Array(s.data)], { type: s.mime }), s.filename);
  const res = await fetch("https://api.elevenlabs.io/v1/voices/add", {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY ?? "" },
    body: form,
    signal: AbortSignal.timeout(90_000),
  });
  const json = (await res.json().catch(() => ({}))) as { voice_id?: string; detail?: { message?: string } | string };
  if (!res.ok || !json.voice_id) {
    const msg = typeof json.detail === "string" ? json.detail : json.detail?.message;
    throw new AiError(res.status, `ElevenLabs clone failed: ${(msg ?? `HTTP ${res.status}`).slice(0, 160)}`);
  }
  return json.voice_id;
}

export async function speakWithElevenLabs(text: string, voiceId: string): Promise<Buffer> {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY ?? "", "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text,
      model_id: elevenModel(),
      voice_settings: { stability: 0.55, similarity_boost: 0.85, style: 0.15, use_speaker_boost: true, speed: 0.92 },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new AiError(res.status, `ElevenLabs speech failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

export function voiceModelLabel(): string {
  return isElevenLabsConfigured() ? `elevenlabs/${elevenModel()}` : modelFor("media");
}
