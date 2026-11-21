import { describe, expect, it } from "vitest";
import {
  interpretLocally,
  isInterruptCommand,
  matchGlobalCommand,
  validateDecision,
  type ScreenContext,
} from "../src/lib/shared/agent";
import { echoOverlap, labelMatchScore } from "../src/lib/shared/text";

const memory: ScreenContext = {
  game: "memory_room",
  screen: "question",
  version: "q1",
  scene: "Living room photo",
  question: "Where do you usually keep your glasses?",
  actions: [
    {
      name: "choose_spot",
      description: "pick a place",
      targets: [
        { id: "spot_bowl", label: "blue bowl" },
        { id: "spot_hooks", label: "hooks by the door" },
        { id: "spot_drawer", label: "top drawer" },
        { id: "spot_window", label: "windowsill" },
        { id: "spot_shelf", label: "bookshelf" },
      ],
    },
    { name: "play_clue", description: "hear clue", phrases: ["clue", "hint", "help me", "remind me", "hear my"] },
  ],
};

const street: ScreenContext = {
  game: "show_me_your_street",
  screen: "stop",
  version: "st_bakery",
  scene: "Noor Bakery",
  mode: "conversation",
  talkAction: "none",
  actions: [
    {
      name: "go",
      description: "move",
      targets: [
        { id: "left", label: "the lane on the left", aliases: ["left", "lane"] },
        { id: "right", label: "the main road on the right", aliases: ["right", "main road"] },
        { id: "back", label: "back the way we came", aliases: ["back", "go back"] },
      ],
    },
    { name: "leave_note", description: "note", phrases: ["leave a note", "voice note", "record a note"] },
  ],
};

const req = (context: ScreenContext, utterance: string, clarifications = 0) => ({
  context,
  utterance,
  history: [],
  playerName: "Yusuf",
  clarifications,
});

describe("local interpreter (used when Claude is unavailable)", () => {
  it("maps natural answers to places", () => {
    const d = interpretLocally(req(memory, "I think they're in the bowl"));
    expect(d.action).toBe("choose_spot");
    expect(d.target).toBe("spot_bowl");
  });

  it("tolerates recognition slips: 'the bull' -> blue bowl", () => {
    const d = interpretLocally(req(memory, "the blue bull"));
    expect(d.target).toBe("spot_bowl");
  });

  it("asks for the clue", () => {
    expect(interpretLocally(req(memory, "Can I hear my clue?")).action).toBe("play_clue");
  });

  it("asks one gentle clarification when unclear, then offers tapping", () => {
    const first = interpretLocally(req(memory, "the thing over there"));
    expect(first.action).toBe("none");
    expect(first.needsClarification).toBe(true);
    const second = interpretLocally(req(memory, "the thing over there", 1));
    expect(second.say).toMatch(/tap/i);
  });

  it("turns at the bakery: 'Let's take the lane on the left'", () => {
    const d = interpretLocally(req(street, "Let's take the lane on the left"));
    expect(d.action).toBe("go");
    expect(d.target).toBe("left");
    const r = interpretLocally(req(street, "let's go right along the main road"));
    expect(r.target).toBe("right");
  });

  it("treats talk on the street as conversation, not a miss", () => {
    const d = interpretLocally(req(street, "My father used to buy bread here every Friday"));
    expect(d.action).toBe("none");
    expect(d.needsClarification).toBe(false);
    expect(d.say.length).toBeGreaterThan(0);
  });
});

describe("small talk", () => {
  const home: ScreenContext = {
    game: "home",
    screen: "choose",
    version: "home",
    scene: "start",
    question: "Which game would you like to play?",
    actions: [
      {
        name: "open_game",
        description: "open",
        targets: [
          { id: "memory", label: "My Memory Room" },
          { id: "story", label: "Tell the Story" },
          { id: "street", label: "Show Me Your Street" },
        ],
      },
    ],
  };
  it("answers a greeting warmly instead of asking for a clarification", () => {
    const d = interpretLocally(req(home, "hello how are you"));
    expect(d.action).toBe("none");
    expect(d.needsClarification).toBe(false);
    expect(d.say).toMatch(/^I'm very well/);
    expect(d.say).toContain("Which game would you like to play?");
  });
  it("names games without an extra 'the'", () => {
    const d = interpretLocally(req(home, "the purple thing"));
    expect(d.say).toContain("My Memory Room, Tell the Story or Show Me Your Street");
    expect(d.say).not.toContain("the My Memory Room");
  });
});

describe("fast-path commands", () => {
  it("I'm done always ends the session", () => {
    expect(matchGlobalCommand("I'm done", memory)?.action).toBe("end_session");
    expect(matchGlobalCommand("ok I am done for today", memory)?.action).toBe("end_session");
    expect(matchGlobalCommand("pause please", memory)?.action).toBe("pause");
    expect(matchGlobalCommand("can you say that again", memory)?.action).toBe("repeat");
    expect(matchGlobalCommand("they're in the bowl", memory)).toBeNull();
  });
  it("recognises interruptions", () => {
    expect(isInterruptCommand("stop")).toBe(true);
    expect(isInterruptCommand("Stop talking")).toBe(true);
    expect(isInterruptCommand("the blue bowl")).toBe(false);
  });
});

describe("validation", () => {
  it("never lets an action outside the screen through", () => {
    const bad = validateDecision(
      { action: "go", target: "left", say: "", needsClarification: false, source: "claude" },
      memory,
    );
    expect(bad.action).toBe("none");
    const badTarget = validateDecision(
      { action: "choose_spot", target: "spot_fridge", say: "", needsClarification: false, source: "claude" },
      memory,
    );
    expect(badTarget.action).toBe("none");
    const ok = validateDecision(
      { action: "choose_spot", target: "spot_bowl", say: "", needsClarification: false, source: "claude" },
      memory,
    );
    expect(ok.target).toBe("spot_bowl");
  });
});

describe("echo detection", () => {
  it("recognises the agent's own words coming back through the mic", () => {
    expect(echoOverlap("where do you usually keep your glasses", "Where do you usually keep your glasses?")).toBeGreaterThan(0.8);
    expect(echoOverlap("in the blue bowl", "Where do you usually keep your glasses?")).toBeLessThan(0.35);
  });
  it("scores labels", () => {
    expect(labelMatchScore("by the door", "hooks by the door")).toBeGreaterThan(0.7);
    expect(labelMatchScore("near the window", "windowsill")).toBeGreaterThan(0.7);
    expect(labelMatchScore("on the books", "bookshelf")).toBeGreaterThan(0.7);
    expect(labelMatchScore("the kitchen", "windowsill")).toBeLessThan(0.5);
  });
});
