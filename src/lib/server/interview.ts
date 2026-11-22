// The story interview: the companion asks, the family member talks, and the
// AI listens like a warm biographer.
//
// One Gemini call per answer both transcribes the recording and writes a
// short, warm reply (plus at most one follow-up question when the answer was
// brief), so the conversation keeps flowing. When the interview is finished,
// Claude turns all the answers into the life-story memories the games use.

import { audioPart, chatJson, describeAiError } from "./openrouter";
import type { AnswerRow } from "./family";
import type { MemoryFact, MemoryKind } from "../shared/companion";

export interface HeardAnswer {
  transcript: string;
  reply: string;
  followUp: string | null;
}

export async function hearAnswer(opts: {
  audio: { data: Buffer; mime: string };
  question: string;
  memberName: string;
  relation: string;
  callName: string;
  isFollowUp: boolean;
}): Promise<HeardAnswer> {
  const res = await chatJson<{ transcript: string; reply: string; follow_up: string }>({
    role: "media",
    maxTokens: 4000,
    timeoutMs: 70_000,
    temperature: 0.4,
    schema: {
      name: "heard_answer",
      schema: {
        type: "object",
        properties: {
          transcript: { type: "string" },
          reply: { type: "string" },
          follow_up: { type: "string" },
        },
        required: ["transcript", "reply", "follow_up"],
        additionalProperties: false,
      },
    },
    messages: [
      {
        role: "system",
        content:
          `You are the warm, attentive voice of "One More Story", interviewing ${opts.memberName} (${opts.relation}) about ${opts.callName}, ` +
          `who is living with Alzheimer's. You are gathering their life story so their games can be built from it. You are a kind biographer, never clinical.`,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              `The question was: "${opts.question}"\n` +
              "1. transcript: transcribe the recording word for word (names spelled as spoken). If nobody speaks, use an empty string.\n" +
              "2. reply: what you say back, out loud, in one or two short warm sentences (under 30 words). Reflect one specific detail they shared so they feel heard. " +
              "No questions in the reply. Never mention memory loss.\n" +
              (opts.isFollowUp
                ? "3. follow_up: empty string (this was already a follow-up)."
                : "3. follow_up: if the answer was short or missing a vivid detail (a name, a place, a sensory moment), ONE short, curious follow-up question to draw out more of the story; otherwise an empty string."),
          },
          audioPart(opts.audio.data, opts.audio.mime),
        ],
      },
    ],
  });
  return {
    transcript: res.transcript.trim(),
    reply: res.reply.trim().slice(0, 300),
    followUp: opts.isFollowUp ? null : res.follow_up.trim().slice(0, 200) || null,
  };
}

/** The same, for an answer that was typed instead of recorded. */
export async function replyToText(opts: { question: string; text: string; memberName: string; callName: string }): Promise<string> {
  try {
    const res = await chatJson<{ reply: string }>({
      role: "fast",
      maxTokens: 200,
      timeoutMs: 15_000,
      schema: {
        name: "reply",
        schema: { type: "object", properties: { reply: { type: "string" } }, required: ["reply"], additionalProperties: false },
      },
      messages: [
        {
          role: "system",
          content: `You warmly interview ${opts.memberName} about ${opts.callName}'s life story. Reply in one or two short warm sentences (under 30 words) reflecting one detail they shared. No questions.`,
        },
        { role: "user", content: `Question: ${opts.question}\nAnswer: ${opts.text}` },
      ],
    });
    return res.reply.trim();
  } catch (err) {
    console.warn("[interview] reply failed:", describeAiError(err));
    return "Thank you. That's a lovely thing to know.";
  }
}

export interface ExtractedMemory {
  kind: MemoryKind;
  title: string;
  detail: string;
  people: string[];
  place: string;
  era: string;
  facts: MemoryFact[];
  art_prompt: string;
  from_question: string;
}

const FACT_SCHEMA = {
  type: "object",
  properties: {
    prompt: { type: "string" },
    answer: { type: "string" },
    distractors: { type: "array", items: { type: "string" } },
  },
  required: ["prompt", "answer", "distractors"],
  additionalProperties: false,
};

export const MEMORY_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["person", "place", "event", "favorite", "routine", "gentle"] },
    title: { type: "string" },
    detail: { type: "string" },
    people: { type: "array", items: { type: "string" } },
    place: { type: "string" },
    era: { type: "string" },
    facts: { type: "array", items: FACT_SCHEMA },
    art_prompt: { type: "string" },
    from_question: { type: "string" },
  },
  required: ["kind", "title", "detail", "people", "place", "era", "facts", "art_prompt", "from_question"],
  additionalProperties: false,
};

export const MEMORY_RULES = `Rules for memories
- Use ONLY what the family said. Never invent names, places, dates, jobs or events. If something is unclear, leave it out.
- kind: person (one important person), place (a home, town or favourite place), event (one story or milestone), favorite (food, music, hobby, sport, smell), routine (part of their day now), gentle (something upsetting or to avoid: guidance only, never shown to the player).
- title: 2 to 6 words, e.g. "Wedding in Lahore", "Amina, his wife", "Mango with salt".
- detail: 1 to 3 warm sentences in the third person, keeping the family's own vivid words.
- people: names mentioned in this memory. place and era: short, or "" when unknown.
- facts: up to 3 questions the player could be asked about this memory, written TO the player in the second person ("Where did you grow up?", "What is your wife's name?", "Which sweet did you always buy on Fridays?"). answer: 1 to 4 words, exactly as the family said. distractors: 3 believable alternatives of the same type that are clearly NOT true and are NOT other real people or places from this family's story. No facts for gentle memories, and no facts that could upset (a death, an illness, a loss).
- art_prompt: for a soft storybook painting of the memory without readable text or recognisable faces (for a person, paint something that evokes them: the place, an object, the activity they share). One or two concrete sentences. "" for gentle memories.
- from_question: the key of the question the memory mostly came from.`;

export async function extractLifeStory(opts: {
  callName: string;
  playerName: string;
  pronoun: string;
  memberName: string;
  relation: string;
  answers: AnswerRow[];
}): Promise<ExtractedMemory[]> {
  const transcript = opts.answers
    .filter((a) => a.transcript.trim())
    .map((a) => `[${a.question_key}] Q: ${a.question}\nA (${opts.memberName}): ${a.transcript}`)
    .join("\n\n");
  if (!transcript) return [];
  const res = await chatJson<{ memories: ExtractedMemory[] }>({
    role: "smart",
    maxTokens: 9000,
    timeoutMs: 120_000,
    temperature: 0.3,
    schema: {
      name: "life_story",
      schema: {
        type: "object",
        properties: { memories: { type: "array", items: MEMORY_SCHEMA } },
        required: ["memories"],
        additionalProperties: false,
      },
    },
    messages: [
      {
        role: "system",
        content:
          `You turn a family interview into the life story of ${opts.playerName} (called "${opts.callName}" at home, pronoun ${opts.pronoun}), who lives with Alzheimer's. ` +
          `${opts.memberName} (${opts.relation}) gave the interview. Personal memory games and gentle conversations will be built from your memories, so accuracy and warmth matter more than quantity.\n\n` +
          MEMORY_RULES,
      },
      {
        role: "user",
        content: `Interview:\n\n${transcript}\n\nWrite 8 to 18 memories covering the people, places, stories, favourite things, today's routine and anything to be gentle about.`,
      },
    ],
  });
  return Array.isArray(res.memories) ? res.memories : [];
}

/** One new memory from something the family (or the player) just told us. */
export async function extractOneMemory(opts: { text: string; callName: string; by: string; known: string }): Promise<ExtractedMemory[]> {
  const res = await chatJson<{ memories: ExtractedMemory[] }>({
    role: "smart",
    maxTokens: 3000,
    timeoutMs: 60_000,
    temperature: 0.3,
    schema: {
      name: "new_memories",
      schema: {
        type: "object",
        properties: { memories: { type: "array", items: MEMORY_SCHEMA } },
        required: ["memories"],
        additionalProperties: false,
      },
    },
    messages: [
      {
        role: "system",
        content:
          `You add to the life story of ${opts.callName}, who lives with Alzheimer's. ${opts.by} just shared something. ` +
          `Return 1 memory (2 at most if they clearly told two separate things). Use from_question "added".\n\n${MEMORY_RULES}`,
      },
      {
        role: "user",
        content: `What we already know (for context and spelling, do not repeat it):\n${opts.known || "(nothing yet)"}\n\nWhat ${opts.by} shared now:\n${opts.text}`,
      },
    ],
  });
  return Array.isArray(res.memories) ? res.memories.slice(0, 2) : [];
}
