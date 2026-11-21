import { contentWords } from "./text";

// Everyday ways people refer to places in a room, so "the window" finds the
// windowsill and "the chair" finds the armchair.
const EXTRA: Record<string, string[]> = {
  windowsill: ["window", "window ledge", "sill"],
  bookshelf: ["books", "shelf", "book case", "bookcase"],
  bookcase: ["books", "shelf", "bookshelf"],
  armchair: ["chair", "sofa chair", "my chair"],
  drawer: ["drawers", "chest of drawers", "dresser"],
  hooks: ["hook", "hanger", "coat hook", "by the door", "door"],
  bowl: ["fruit bowl", "dish", "the blue one"],
  lamp: ["side table", "little table", "table by the chair"],
  bedside: ["bed", "night stand", "nightstand"],
  cupboard: ["cabinet", "closet"],
  wardrobe: ["closet", "cupboard"],
  sofa: ["couch", "settee"],
  table: ["the table"],
  shelf: ["shelves"],
};

export function spotAliases(label: string): string[] {
  const out = new Set<string>();
  for (const w of contentWords(label)) {
    out.add(w);
    for (const [key, extra] of Object.entries(EXTRA)) {
      if (w === key || w.replace(/s$/, "") === key) extra.forEach((e) => out.add(e));
    }
  }
  out.delete(label.toLowerCase());
  return Array.from(out).slice(0, 8);
}
