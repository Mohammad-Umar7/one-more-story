// The companion leads the player through Umar's classic games one after
// another: /play/memory?chain=street,story -> /play/street?chain=story ->
// /play/story -> back to the companion (/?after=1) to say goodbye.

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

export function startChain(): string {
  return "/play/memory?chain=street,story";
}
