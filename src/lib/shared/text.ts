// Small, dependency-free text helpers used for echo detection and the local
// (no-network) intent matcher.

const STOP_WORDS = new Set([
  "a", "an", "the", "i", "im", "i'm", "me", "my", "mine", "you", "your", "we", "our",
  "it", "its", "is", "are", "was", "be", "to", "of", "in", "on", "at", "by", "for",
  "with", "and", "or", "so", "that", "this", "there", "they", "them", "think", "maybe",
  "um", "uh", "erm", "hmm", "mm", "ah", "oh", "well", "like", "just", "please", "can",
  "could", "would", "will", "do", "does", "did", "go", "lets", "let's", "let", "us",
  "yes", "no", "ok", "okay", "where", "what", "which", "usually", "keep", "put",
  "probably", "guess", "know", "dont", "don't", "one", "thing", "really",
]);

const FILLERS = new Set([
  "um", "uh", "erm", "er", "hmm", "mm", "mmm", "ah", "oh", "well", "so", "let", "me",
  "see", "think", "hang", "on", "wait", "a", "second", "moment", "minute", "just",
]);

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^a-z0-9'\s-]/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function words(text: string): string[] {
  const n = normalize(text);
  return n ? n.split(" ") : [];
}

export function contentWords(text: string): string[] {
  return words(text).filter((w) => !STOP_WORDS.has(w));
}

/** True when the utterance is only hesitation ("um... let me think"). */
export function isOnlyFiller(text: string): boolean {
  const ws = words(text);
  return ws.length > 0 && ws.every((w) => FILLERS.has(w));
}

const TRAILING_INCOMPLETE = new Set([
  "and", "the", "a", "an", "my", "in", "on", "to", "of", "because", "with", "um", "uh",
  "but", "then", "so", "was", "were", "is", "at", "by", "or", "his", "her", "our",
]);

/** The player probably has more to say ("we used to go to the..."). */
export function soundsUnfinished(text: string): boolean {
  const ws = words(text);
  if (ws.length === 0) return false;
  return TRAILING_INCOMPLETE.has(ws[ws.length - 1]);
}

/** Crude phonetic skeleton: "bowl", "bull" and "ball" all become "bl". */
export function skeleton(word: string): string {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return "";
  const first = w[0];
  const rest = w
    .slice(1)
    .replace(/ph/g, "f")
    .replace(/ck/g, "k")
    .replace(/[aeiouyhw]/g, "");
  const raw = (("aeiou".includes(first) ? "" : first) + rest).replace(/(.)\1+/g, "$1");
  return raw || first;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = tmp;
    }
  }
  return prev[b.length];
}

/** 1 = same word, 0 = unrelated. Tolerates plurals, typos and sound-alikes. */
export function wordSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const sa = a.replace(/(es|s)$/, "");
  const sb = b.replace(/(es|s)$/, "");
  if (sa && sa === sb) return 0.95;
  // Part of a compound word: "window" ~ "windowsill", "book" ~ "bookshelf".
  const [short, long] = sa.length <= sb.length ? [sa, sb] : [sb, sa];
  if (short.length >= 4 && long.length >= 6 && long.includes(short)) return 0.8;
  const dist = levenshtein(sa, sb);
  const ratio = 1 - dist / Math.max(sa.length, sb.length, 1);
  if (ratio >= 0.8) return ratio;
  if (sa.length >= 3 && sb.length >= 3 && skeleton(sa) === skeleton(sb) && skeleton(sa).length >= 2) {
    return 0.75;
  }
  return ratio * 0.6;
}

/**
 * How well a spoken utterance refers to a label ("I think they're in the bowl"
 * vs "blue bowl"). Returns 0..1, weighting the label's distinctive words.
 */
export function labelMatchScore(utterance: string, label: string, aliases: string[] = []): number {
  const said = contentWords(utterance);
  if (said.length === 0) return 0;
  let best = 0;
  for (const candidate of [label, ...aliases]) {
    const target = contentWords(candidate);
    if (target.length === 0) continue;
    // Exact phrase inside the utterance is the strongest evidence.
    if (normalize(utterance).includes(normalize(candidate))) {
      best = Math.max(best, 1);
      continue;
    }
    let total = 0;
    for (const t of target) {
      let wordBest = 0;
      for (const s of said) wordBest = Math.max(wordBest, wordSimilarity(s, t));
      total += wordBest;
    }
    // Any single strong word match counts (people say "the bowl", not "the blue bowl").
    const anyStrong = target.some((t) => said.some((s) => wordSimilarity(s, t) >= 0.75));
    const avg = total / target.length;
    best = Math.max(best, anyStrong ? Math.max(avg, 0.75) : avg);
  }
  return best;
}

/** Share of the heard words that also occur in what the app was saying. */
export function echoOverlap(heard: string, spoken: string): number {
  const h = words(heard);
  if (h.length === 0) return 0;
  const s = words(spoken);
  if (s.length === 0) return 0;
  let hits = 0;
  for (const w of h) {
    if (s.some((x) => wordSimilarity(w, x) >= 0.8)) hits++;
  }
  return hits / h.length;
}

export function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function isPluralNoun(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (/(glasses|keys|beads|scissors|trousers|headphones|earrings|slippers|shoes|pills|tablets)$/.test(n)) {
    return true;
  }
  return /[^s]s$/.test(n);
}
