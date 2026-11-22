// Pictures made by AI: the companion's avatar (from the family member's own
// photo) and a storybook painting for each memory.
//
// The image model on the team key draws from text only, so the avatar is made
// in two steps: Gemini studies the photo and writes a precise likeness
// description, then Recraft paints a portrait from it.

import fs from "node:fs";
import { chatJson, describeAiError, generateImage, imagePart } from "./openrouter";
import { getMedia, mediaPath, saveMedia } from "./media";
import { getMember, updateMember } from "./family";
import { getArtPrompt, setMemoryArt } from "./life";

const AVATAR_STYLE =
  "Warm painterly portrait illustration, like a beautiful animated film still: soft gouache and digital painting, gentle golden rim light, " +
  "kind relaxed smile, looking straight at the viewer, head and shoulders, centred, eyes clearly visible. " +
  "Plain softly glowing background in deep navy blue fading to warm gold. No text, no letters, no frame, no watermark.";

const MEMORY_STYLE =
  "Soft storybook illustration in watercolour and gouache, warm golden-hour light, gentle nostalgic colours, calm and happy mood, " +
  "simple clear composition that reads well on a small screen. No text, no letters, no captions, no watermark. " +
  "People, if any, are seen from a distance or from behind, with no detailed faces. Scene: ";

interface Look {
  likeness: string;
  summary: string;
}

/** Gemini looks at the photo and writes what a painter needs for a likeness. */
export async function describeLook(data: Buffer, mime: string): Promise<Look> {
  return chatJson<Look>({
    role: "media",
    maxTokens: 2000,
    timeoutMs: 60_000,
    temperature: 0.2,
    schema: {
      name: "look",
      schema: {
        type: "object",
        properties: {
          likeness: { type: "string" },
          summary: { type: "string" },
        },
        required: ["likeness", "summary"],
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
              "Describe the main person in this photo for a portrait painter who must capture a strong likeness without seeing the photo. " +
              "likeness: 70 to 110 words covering apparent age range, gender presentation, skin tone, face shape, eyes and eyebrows, nose, mouth and smile, " +
              "hair (colour, length, style, hairline) or head covering, facial hair, glasses, and the colour and type of clothing. Concrete visual words only, no names, no guesses about identity. " +
              "summary: 8 to 14 friendly words, e.g. \"Man in his thirties with a short beard and a warm smile\".",
          },
          imagePart(data, mime),
        ],
      },
    ],
  });
}

function mimeOk(mime: string): boolean {
  return ["image/jpeg", "image/png", "image/webp"].includes(mime);
}

/** Make (or remake) the companion's avatar from the member's uploaded photo. */
export async function makeAvatar(memberId: string): Promise<void> {
  const m = getMember(memberId);
  if (!m?.photo_media_id) throw new Error("No photo yet");
  const photo = getMedia(m.photo_media_id);
  if (!photo) throw new Error("Photo missing");
  updateMember(memberId, { avatar_status: "working" });
  try {
    const data = fs.readFileSync(mediaPath(photo));
    const look = await describeLook(data, photo.mime);
    updateMember(memberId, { look: `${look.summary}\n${look.likeness}` });
    const img = await generateImage(`${AVATAR_STYLE}\nThe person: ${look.likeness}`, { aspect: "1:1" });
    if (!mimeOk(img.mime)) throw new Error(`Unexpected image type ${img.mime}`);
    const saved = saveMedia({ data: img.data, mime: img.mime });
    updateMember(memberId, { avatar_media_id: saved.id, avatar_status: "ready" });
  } catch (err) {
    console.warn("[art] avatar failed:", describeAiError(err));
    updateMember(memberId, { avatar_status: "failed" });
    throw err;
  }
}

/** Paint one memory from its art prompt. */
export async function paintMemory(memoryId: string): Promise<void> {
  const prompt = getArtPrompt(memoryId);
  if (!prompt) return;
  setMemoryArt(memoryId, "working");
  try {
    const img = await generateImage(MEMORY_STYLE + prompt, { aspect: "4:3" });
    if (!mimeOk(img.mime)) throw new Error(`Unexpected image type ${img.mime}`);
    const saved = saveMedia({ data: img.data, mime: img.mime });
    setMemoryArt(memoryId, "ready", saved.id);
  } catch (err) {
    console.warn("[art] memory painting failed:", describeAiError(err));
    setMemoryArt(memoryId, "failed");
  }
}

/** Paint several memories, a few at a time (keeps the API polite). */
export async function paintMemories(ids: string[], concurrency = 3, onEach?: () => void): Promise<void> {
  const queue = [...ids];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const id = queue.shift()!;
      await paintMemory(id);
      onEach?.();
    }
  });
  await Promise.all(workers);
}
