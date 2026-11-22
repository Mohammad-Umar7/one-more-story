// The demo day, line by line: everything the companion says when it leads
// Dada through the memory room, the street tour and a story. The family
// member records each line once (demo/VOICE_SCRIPT.md) and the companion
// then speaks only in their real voice. Free replies during the street tour
// and the story come from here too, so they can be recorded.

import type { ConversationTurn, ScreenContext } from "./agent";

export const STREET_REPLIES: Record<string, string> = {
  "the front gate": "What a lovely gate, Dada. Shall we go on to the bakery straight ahead?",
  "noor bakery": "I can almost smell the fresh bread. Which way shall we go: the lane on the left, or the main road on the right?",
  "jasmine lane": "It's so peaceful here. Shall we go on to the little park?",
  "the little park": "I love this park too, Dada. Shall we finish the tour here?",
  "the main road": "It's so busy here. Shall we go along to the tea stall?",
  "the tea stall": "A cup of masala chai sounds perfect. Shall we finish the tour here?",
};

export const STORY_FOLLOWUPS = [
  "That was the day you taught me to ride my bike, Dada. What do you remember most about it?",
  "You kept running behind me, holding the seat. How did it feel when I finally rode on my own?",
  "I'll never forget it, Dada. Tell me a little more.",
];

/** The whole script, in the order it is heard. `key` marks the six voice lines recorded at setup. */
export const DEMO_LINES: { section: string; text: string; key?: string }[] = [
  { section: "Hello", text: "Hello Dada, it's me, Aamir!", key: "hello" },
  { section: "Hello", text: "Good morning, Dada. It's so lovely to see you today." },
  { section: "Hello", text: "Let's play a little game together.", key: "lets_play" },
  { section: "Hello", text: "First, let's find a few of your things in the living room." },

  { section: "My Memory Room", text: "Let's find four things in your living room. Shall we start?" },
  { section: "My Memory Room", text: "Where do you usually keep your glasses?" },
  { section: "My Memory Room", text: "Yes, the blue bowl. That's where your glasses live." },
  { section: "My Memory Room", text: "Now, where do you usually keep your keys?" },
  { section: "My Memory Room", text: "That's the top drawer. Your keys usually live somewhere else. Would you like to hear your clue?" },
  { section: "My Memory Room", text: "Here's your clue, in your own voice." },
  { section: "My Memory Room", text: "Where do you think they are?" },
  { section: "My Memory Room", text: "That's right, the hooks by the door." },
  { section: "My Memory Room", text: "Now, where do you usually keep your watch?" },
  { section: "My Memory Room", text: "Lovely. Your watch goes in the top drawer." },
  { section: "My Memory Room", text: "Now, where do you usually keep your prayer beads?" },
  { section: "My Memory Room", text: "Yes, the windowsill. Just where they belong." },
  { section: "My Memory Room", text: "All four, back where they belong. Well done, Dada." },

  { section: "Show Me Your Street", text: "Today you're the tour guide. Will you show me around your street?" },
  { section: "Show Me Your Street", text: "We're starting at the front gate. What can you tell me about this place?" },
  { section: "Show Me Your Street", text: STREET_REPLIES["the front gate"] },
  { section: "Show Me Your Street", text: "Here we are at Noor Bakery. What can you tell me about this place?" },
  { section: "Show Me Your Street", text: STREET_REPLIES["noor bakery"] },
  { section: "Show Me Your Street", text: "Here we are at Jasmine Lane. What can you tell me about this place?" },
  { section: "Show Me Your Street", text: STREET_REPLIES["jasmine lane"] },
  { section: "Show Me Your Street", text: "Here we are at the little park. This is as far as the path goes. What can you tell me about it?" },
  { section: "Show Me Your Street", text: STREET_REPLIES["the little park"] },
  { section: "Show Me Your Street", text: "Thank you for the tour, Dada. Your family can walk it with you any time." },

  { section: "Tell the Story", text: "Here's a photo from your album. What would you like to share about this day?" },
  ...STORY_FOLLOWUPS.map((text) => ({ section: "Tell the Story", text })),
  { section: "Tell the Story", text: "Thank you for sharing that. Would you like to listen back, save it, or let it go?" },
  { section: "Tell the Story", text: "Saved. Your family will love hearing this. Thank you, Dada." },

  { section: "Goodbye", text: "Well done, Dada! I'm so proud of you.", key: "well_done" },
  { section: "Goodbye", text: "That was wonderful, Dada. Thank you for playing with me." },
  { section: "Goodbye", text: "I love you, Dada. See you tomorrow.", key: "love_you" },
];

/** A scripted reply for free talk in the street tour and the story (null: keep the AI's). */
export function scriptedReply(ctx: ScreenContext, action: string, history: ConversationTurn[]): string | null {
  if (ctx.game === "show_me_your_street" && action === "none") {
    const stop = /This stop is called "([^"]+)"/.exec(ctx.facts?.join(" ") ?? "")?.[1]?.toLowerCase();
    return (stop && STREET_REPLIES[stop]) || null;
  }
  if (ctx.game === "tell_the_story" && action === "tell") {
    const asked = history.filter((h) => h.role === "assistant" && STORY_FOLLOWUPS.includes(h.text)).length;
    return STORY_FOLLOWUPS[Math.min(asked, STORY_FOLLOWUPS.length - 1)];
  }
  return null;
}
