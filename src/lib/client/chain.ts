// The companion leads the player through Umar's classic games one after
// another: /play/story?chain=memory,street -> /play/memory?chain=street ->
// /play/street -> back to the companion (/?after=1) to say goodbye.

const PATHS: Record<string, string> = { memory: "/play/memory", street: "/play/street", story: "/play/story" };

export function chainFromUrl(): string[] | null {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search);
  if (!q.has("chain")) return null;
  return (q.get("chain") ?? "").split(",").filter((x) => x in PATHS);
}

/** Where to go after this game in the chain. */
export function nextInChain(chain: string[]): string {
  if (!chain.length) return "/?after=1";
  const [next, ...rest] = chain;
  return `${PATHS[next]}?chain=${rest.join(",")}`;
}

/**
 * The day is one game: the story about one picture, then "thank you for
 * playing" and the starting-point report. The next game is tomorrow.
 */
export function startChain(): string {
  return "/play/story?chain=";
}
