// One client for every AI job that goes through OpenRouter (server-side only;
// the key never reaches the browser and is never logged).
//
//   smart  - Claude Sonnet 5.5: daily games, baselines, interview replies, memories
//   fast   - GPT-6 Luna: quick structured jobs where latency matters most
//   media  - Gemini 3.8 Flash: hears recordings (transcripts, voice matching) and sees photos
//   image  - Recraft: avatars and storybook illustrations
//
// Each model can be swapped with an env var. Speech output lives in tts.ts.

const DEFAULTS = {
  smart: "anthropic/claude-sonnet-5.5",
  fast: "openai/gpt-6-luna",
  media: "google/gemini-3.8-flash",
  image: "recraft/recraft-v4.1-flash-v2",
} as const;

export type ModelRole = keyof typeof DEFAULTS;

const ENV_BY_ROLE: Record<ModelRole, string> = {
  smart: "OPENROUTER_SMART_MODEL",
  fast: "OPENROUTER_FAST_MODEL",
  media: "OPENROUTER_MEDIA_MODEL",
  image: "OPENROUTER_IMAGE_MODEL",
};

export function modelFor(role: ModelRole): string {
  return process.env[ENV_BY_ROLE[role]]?.trim() || DEFAULTS[role];
}

export function isOpenRouterConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

export function openRouterBase(): string {
  return (process.env.OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1").replace(/\/+$/, "");
}

export class AiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type Content =
  | string
  | (
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
      | { type: "input_audio"; input_audio: { data: string; format: string } }
    )[];

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: Content;
}

interface ChatOptions {
  role?: ModelRole;
  model?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  timeoutMs?: number;
  temperature?: number;
  /** JSON schema for structured output (strict). */
  schema?: { name: string; schema: Record<string, unknown> };
  modalities?: string[];
  extra?: Record<string, unknown>;
}

interface ChatResponse {
  choices?: {
    message?: {
      content?: string | null;
      images?: { image_url?: { url?: string } }[];
    };
    finish_reason?: string;
  }[];
  usage?: { cost?: number };
  error?: { message?: string; code?: number };
}

async function post(path: string, body: unknown, timeoutMs: number): Promise<Response> {
  if (!isOpenRouterConfigured()) throw new AiError(503, "OpenRouter is not configured");
  try {
    return await fetch(`${openRouterBase()}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "X-Title": "One More Story",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const name = (err as Error)?.name;
    throw new AiError(name === "TimeoutError" || name === "AbortError" ? 504 : 502, `OpenRouter request failed: ${name ?? "network"}`);
  }
}

async function chat(opts: ChatOptions): Promise<ChatResponse> {
  const model = opts.model ?? modelFor(opts.role ?? "smart");
  const body: Record<string, unknown> = {
    model,
    messages: opts.messages,
    max_tokens: opts.maxTokens ?? 1500,
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    ...(opts.schema
      ? { response_format: { type: "json_schema", json_schema: { name: opts.schema.name, strict: true, schema: opts.schema.schema } } }
      : {}),
    ...(opts.modalities ? { modalities: opts.modalities } : {}),
    ...opts.extra,
  };
  const res = await post("/chat/completions", body, opts.timeoutMs ?? 45_000);
  let json: ChatResponse;
  try {
    json = (await res.json()) as ChatResponse;
  } catch {
    throw new AiError(res.status || 502, `OpenRouter returned unreadable data (${res.status})`);
  }
  if (!res.ok || json.error) {
    throw new AiError(json.error?.code ?? res.status, `OpenRouter ${model}: ${(json.error?.message ?? `HTTP ${res.status}`).slice(0, 200)}`);
  }
  const cost = json.usage?.cost;
  if (typeof cost === "number") trackSpend(cost);
  return json;
}

/** Plain text reply. */
export async function chatText(opts: Omit<ChatOptions, "schema">): Promise<string> {
  const json = await chat(opts);
  const text = json.choices?.[0]?.message?.content ?? "";
  if (!text.trim()) throw new AiError(502, "Empty reply");
  return text.trim();
}

/** Strip a ```json fence if a model adds one despite structured output. */
function unfence(text: string): string {
  const t = text.trim();
  const m = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  return m ? m[1] : t;
}

/** Structured reply that must match `schema`; parsed for you. */
export async function chatJson<T>(opts: ChatOptions & { schema: NonNullable<ChatOptions["schema"]> }): Promise<T> {
  const json = await chat(opts);
  const choice = json.choices?.[0];
  if (choice?.finish_reason === "length") throw new AiError(502, "Reply was cut off");
  const text = choice?.message?.content ?? "";
  try {
    return JSON.parse(unfence(text)) as T;
  } catch {
    throw new AiError(502, "Reply was not valid JSON");
  }
}

/** Generate one image; returns the bytes and their type. */
export async function generateImage(prompt: string, opts: { aspect?: "1:1" | "4:3" | "3:4" | "16:9"; timeoutMs?: number } = {}): Promise<{ data: Buffer; mime: string }> {
  const json = await chat({
    role: "image",
    messages: [{ role: "user", content: prompt }],
    modalities: ["image"],
    maxTokens: 4096,
    timeoutMs: opts.timeoutMs ?? 90_000,
    extra: { image_config: { aspect_ratio: opts.aspect ?? "1:1" } },
  });
  const url = json.choices?.[0]?.message?.images?.[0]?.image_url?.url ?? "";
  const m = /^data:([^;]+);base64,(.+)$/s.exec(url);
  if (!m) throw new AiError(502, "No image came back");
  return { mime: m[1].toLowerCase(), data: Buffer.from(m[2], "base64") };
}

/** Audio formats Gemini accepts through OpenRouter's input_audio. */
export function audioFormatFor(mime: string): string | null {
  const m = mime.split(";")[0].trim().toLowerCase();
  if (m === "audio/wav" || m === "audio/x-wav" || m === "audio/wave") return "wav";
  if (m === "audio/mpeg" || m === "audio/mp3") return "mp3";
  if (m === "audio/mp4" || m === "audio/m4a" || m === "audio/x-m4a" || m === "audio/aac") return "m4a";
  if (m === "audio/ogg") return "ogg";
  if (m === "audio/flac") return "flac";
  if (m === "audio/webm") return "webm";
  return null;
}

export function audioPart(data: Buffer, mime: string) {
  const format = audioFormatFor(mime);
  if (!format) throw new AiError(415, `Unsupported audio type ${mime}`);
  return { type: "input_audio" as const, input_audio: { data: data.toString("base64"), format } };
}

export function imagePart(data: Buffer, mime: string) {
  return { type: "image_url" as const, image_url: { url: `data:${mime};base64,${data.toString("base64")}` } };
}

/** Word-for-word transcript of one recording. */
export async function transcribe(data: Buffer, mime: string, hint = ""): Promise<string> {
  const text = await chatText({
    role: "media",
    maxTokens: 2500,
    timeoutMs: 60_000,
    temperature: 0,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "Transcribe this recording word for word in the language spoken. Output only the transcript, with normal punctuation. " +
              "If nobody speaks, output exactly: [silence]" +
              (hint ? `\nContext (for spelling names only): ${hint}` : ""),
          },
          audioPart(data, mime),
        ],
      },
    ],
  });
  return /^\[silence\]$/i.test(text) ? "" : text;
}

// ---- spend tracking ---------------------------------------------------------
// The team key has a hard limit; keep a running total so the family page can
// show it and so runaway loops are visible in the logs.

type GlobalSpend = typeof globalThis & { __omsSpend?: number };

function trackSpend(cost: number) {
  const g = globalThis as GlobalSpend;
  g.__omsSpend = (g.__omsSpend ?? 0) + cost;
}

export function sessionSpend(): number {
  return (globalThis as GlobalSpend).__omsSpend ?? 0;
}

/** Safe-to-log description (never includes the key). */
export function describeAiError(err: unknown): string {
  if (err instanceof AiError) return `${err.status}: ${err.message}`;
  return String((err as Error)?.message ?? err).slice(0, 200);
}
