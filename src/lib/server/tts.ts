import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getSetting, setSetting, TTS_CACHE_DIR } from "./db";
import { DEFAULT_VOICE, isElevenLabsConfigured, isGeminiVoice, speakWithElevenLabs, type VoiceProfile } from "./voices";

// Spoken replies: OpenRouter's /audio/speech endpoint with the team key
// (US$40 spending limit). Every phrase is cached on disk per voice, so
// repeated prompts cost nothing after the first time. The browser falls back
// to its own speech synthesis on failure.
//
// The voice is the companion's: matched to the family member who recorded the
// story interview (see voices.ts), or their ElevenLabs clone when configured.

const DEFAULT_TTS_MODEL = "google/gemini-3.8-flash-tts-20260922";
const INSTRUCTIONS =
  "Speak slowly, warmly and clearly, like a loving family member talking with an older parent. Calm, unhurried pace with natural pauses between sentences. Friendly, never childish.";

type ProfileGetter = () => VoiceProfile | null;
let profileGetter: ProfileGetter | null = null;

/** The family module registers how to find the companion's voice (avoids an import cycle). */
export function setVoiceProfileGetter(fn: ProfileGetter) {
  profileGetter = fn;
}

function envVoice(): string {
  const v = process.env.OPENROUTER_TTS_VOICE?.trim();
  return v || DEFAULT_VOICE;
}

export function activeProfile(): VoiceProfile {
  let p: VoiceProfile | null = null;
  try {
    p = profileGetter?.() ?? null;
  } catch {
    p = null;
  }
  return {
    voice: p && isGeminiVoice(p.voice) ? p.voice : envVoice(),
    style: p?.style ?? null,
    elevenVoiceId: p?.elevenVoiceId ?? null,
  };
}

function instructionsFor(profile: VoiceProfile): string {
  return profile.style ? `${profile.style.trim()} ${INSTRUCTIONS}` : INSTRUCTIONS;
}
export const MAX_TTS_CHARS = 500;

export function ttsModel(): string {
  return process.env.OPENROUTER_TTS_MODEL?.trim() || DEFAULT_TTS_MODEL;
}

export function isTtsConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

function baseUrl(): string {
  return (process.env.OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1").replace(/\/+$/, "");
}

function dailyLimit(): number {
  const n = Number(process.env.TTS_DAILY_CHAR_LIMIT);
  return Number.isFinite(n) && n > 0 ? n : 60_000;
}

export class TtsError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Wrap raw 16-bit little-endian PCM in a WAV header so any browser can play it. */
export function pcmToWav(pcm: Buffer, sampleRate = 24_000, channels = 1, bitsPerSample = 16): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE((channels * bitsPerSample) / 8, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function viaEleven(profile: VoiceProfile): boolean {
  return Boolean(profile.elevenVoiceId) && isElevenLabsConfigured();
}

function cacheKey(model: string, profile: VoiceProfile, text: string): string {
  const who = viaEleven(profile) ? `eleven:${profile.elevenVoiceId}` : `${model}|${profile.voice}|${instructionsFor(profile)}`;
  return crypto.createHash("sha256").update(`${who}|${text}`).digest("hex");
}

function spendChars(n: number): void {
  const key = `tts_chars_${new Date().toISOString().slice(0, 10)}`;
  const used = Number(getSetting(key) ?? "0");
  if (used + n > dailyLimit()) throw new TtsError(429, "Daily speech budget reached");
  setSetting(key, String(used + n));
}

const inflight = new Map<string, Promise<{ audio: Buffer; mime: string; cached: boolean }>>();
let workingModel: string | null = null;

async function callOpenRouter(model: string, text: string, profile: VoiceProfile): Promise<Response> {
  return fetch(`${baseUrl()}/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: text,
      voice: profile.voice,
      instructions: instructionsFor(profile),
      response_format: "pcm",
    }),
    signal: AbortSignal.timeout(20_000),
  });
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body?.error?.message?.slice(0, 200) ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

async function generate(text: string, profile: VoiceProfile): Promise<{ audio: Buffer; mime: string; cached: boolean }> {
  const configured = ttsModel();
  const model = workingModel ?? configured;
  const key = cacheKey(configured, profile, text);

  if (viaEleven(profile)) {
    const mp3 = path.join(TTS_CACHE_DIR, `${key}.mp3`);
    if (fs.existsSync(mp3)) return { audio: fs.readFileSync(mp3), mime: "audio/mpeg", cached: true };
    spendChars(text.length);
    try {
      const audio = await speakWithElevenLabs(text, profile.elevenVoiceId!);
      fs.mkdirSync(TTS_CACHE_DIR, { recursive: true });
      fs.writeFileSync(mp3, audio);
      return { audio, mime: "audio/mpeg", cached: false };
    } catch (err) {
      // Fall back to the matched Gemini voice rather than going silent.
      console.warn("[tts] ElevenLabs failed, using the matched voice:", (err as Error).message);
      return generate(text, { ...profile, elevenVoiceId: null });
    }
  }

  const file = path.join(TTS_CACHE_DIR, `${key}.wav`);
  if (fs.existsSync(file)) return { audio: fs.readFileSync(file), mime: "audio/wav", cached: true };

  spendChars(text.length);
  let res = await callOpenRouter(model, text, profile);
  // The dated ID is the canonical snapshot of google/gemini-3.8-flash-tts. If
  // a provider ever rejects it, retry once with the undated alias.
  if ((res.status === 404 || res.status === 400) && /-\d{8}$/.test(model)) {
    const alias = model.replace(/-\d{8}$/, "");
    const retry = await callOpenRouter(alias, text, profile);
    if (retry.ok) {
      console.warn(`[tts] ${model} was rejected (${res.status}); using alias ${alias}`);
      workingModel = alias;
      res = retry;
    }
  }
  if (!res.ok) throw new TtsError(res.status, await readError(res));

  const contentType = res.headers.get("content-type") ?? "";
  const body = Buffer.from(await res.arrayBuffer());
  let audio: Buffer;
  if (body.subarray(0, 4).toString("ascii") === "RIFF") {
    audio = body;
  } else if (/mpeg|mp3/.test(contentType)) {
    return { audio: body, mime: "audio/mpeg", cached: false };
  } else {
    const rate = Number(/rate=(\d+)/i.exec(contentType)?.[1] ?? 24_000);
    const channels = Number(/channels=(\d+)/i.exec(contentType)?.[1] ?? 1);
    audio = pcmToWav(body, rate, channels);
  }
  fs.mkdirSync(TTS_CACHE_DIR, { recursive: true });
  fs.writeFileSync(file, audio);
  return { audio, mime: "audio/wav", cached: false };
}

export async function synthesize(
  rawText: string,
  profile: VoiceProfile = activeProfile(),
): Promise<{ audio: Buffer; mime: string; cached: boolean }> {
  if (!isTtsConfigured()) throw new TtsError(503, "Speech service not configured");
  const text = rawText.replace(/\s+/g, " ").trim().slice(0, MAX_TTS_CHARS);
  if (!text) throw new TtsError(400, "Nothing to say");
  const key = cacheKey(ttsModel(), profile, text);
  const running = inflight.get(key);
  if (running) return running;
  const p = generate(text, profile).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Render a line in a specific Gemini voice as WAV (used for voice matching). */
export async function renderSample(text: string, profile: VoiceProfile): Promise<Buffer> {
  const { audio } = await synthesize(text, { ...profile, elevenVoiceId: null });
  return audio;
}
