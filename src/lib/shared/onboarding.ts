// The story interview a family member gives during setup. The companion asks
// each question out loud; the answer is recorded in the family member's own
// voice. Those recordings become (1) the life story the daily games are built
// from, (2) the voice the player hears, and (3) real clips the player can
// listen to ("Ahmed told me about your wedding day...").

export interface InterviewQuestion {
  key: string;
  chapter: "beginning" | "people" | "life" | "joy" | "today";
  /** Asked out loud. {call} = what the family calls the player. */
  ask: string;
  /** Shown under the question to help the family member answer well. */
  tip: string;
  optional?: boolean;
}

export const INTERVIEW: InterviewQuestion[] = [
  {
    key: "childhood",
    chapter: "beginning",
    ask: "Let's start at the very beginning. Where did {call} grow up, and what was home like when {they} were little?",
    tip: "The town, the house, brothers and sisters, a smell or a sound from that home.",
  },
  {
    key: "people",
    chapter: "people",
    ask: "Who are the most important people in {call}'s life? Tell me their names, and one thing about each of them.",
    tip: "Say each name clearly: a husband or wife, children, grandchildren, best friends.",
  },
  {
    key: "love",
    chapter: "people",
    ask: "Tell me how {call} met the love of {their} life, like you're telling a story.",
    tip: "Where they met, the wedding, a funny moment. If this doesn't fit, talk about a best friend instead.",
  },
  {
    key: "work",
    chapter: "life",
    ask: "What work did {call} do, and what made {them} proud?",
    tip: "Jobs, skills, the thing people always asked them for help with.",
  },
  {
    key: "shared_memory",
    chapter: "joy",
    ask: "Now tell me about a day you and {call} still smile about.",
    tip: "Tell it slowly, with the place, who was there and what happened. This one becomes a story they can hear in your voice.",
  },
  {
    key: "favorites",
    chapter: "joy",
    ask: "What does {call} love? Favourite food, songs, places, hobbies, anything at all.",
    tip: "Small, specific things work best: mango with salt, old Rafi songs, cricket on the radio.",
  },
  {
    key: "routine",
    chapter: "today",
    ask: "What does a normal day look like for {call} now, from morning to night?",
    tip: "When they wake, tea or coffee, a walk, prayers, a favourite chair, who visits.",
  },
  {
    key: "gentle",
    chapter: "today",
    ask: "Last one. Is there anything that upsets {call}, or anything we should be gentle about or never bring up?",
    tip: "For example someone who has passed away, a move from an old home, or worries about money. The games will steer clear.",
    optional: true,
  },
];

export const CHAPTER_LABEL: Record<InterviewQuestion["chapter"], string> = {
  beginning: "Where it began",
  people: "Their people",
  life: "Their life's work",
  joy: "What brings joy",
  today: "Their days now",
};

export type Pronoun = "he" | "she" | "they";

const FORMS: Record<Pronoun, { they: string; them: string; their: string }> = {
  he: { they: "he", them: "him", their: "his" },
  she: { they: "she", them: "her", their: "her" },
  they: { they: "they", them: "them", their: "their" },
};

export function fillQuestion(text: string, call: string, pronoun: Pronoun): string {
  const f = FORMS[pronoun] ?? FORMS.they;
  return text
    .replace(/\{call\}/g, call)
    .replace(/\{they\}/g, f.they)
    .replace(/\{them\}/g, f.them)
    .replace(/\{their\}/g, f.their);
}

export type OnboardingStep = "welcome" | "about" | "photo" | "interview" | "voice" | "stage" | "build" | "done";

export const ONBOARDING_STEPS: { key: OnboardingStep; label: string }[] = [
  { key: "about", label: "About you" },
  { key: "photo", label: "Your face" },
  { key: "interview", label: "Their story" },
  { key: "voice", label: "Your voice" },
  { key: "stage", label: "How they are" },
  { key: "build", label: "Their world" },
];
