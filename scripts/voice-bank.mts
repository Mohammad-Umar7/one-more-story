// Turn one or more long recordings of demo/VOICE_SCRIPT.md into the voice
// bank: cut at the pauses, transcribe every piece, find each script line,
// and upload it. Read the lines in any order; saying the numbers is fine.
//
//   npm run demo:voice -- "demo/aamir stuff/voice 1.m4a" "demo/aamir stuff/voice 2.m4a"
//   (add --clear to empty the bank first, --url to point at another server)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { DEMO_LINES } from "../src/lib/shared/demo-script";

const args = process.argv.slice(2);
const BASE = (args.includes("--url") ? args[args.indexOf("--url") + 1] : "http://localhost:3000").replace(/\/+$/, "");
const files = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--url");
const KEY = /OPENROUTER_API_KEY=(.*)/.exec(fs.readFileSync(".env.local", "utf8"))?.[1]?.trim();
if (!files.length || !KEY) {
  console.error('Usage: npm run demo:voice -- <recording> [more recordings] [--clear]  (needs OPENROUTER_API_KEY in .env.local)');
  process.exit(1);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "oms-voice-"));

const norm = (t: string) => t.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
function sim(a: string, b: string): number {
  const A = norm(a).split(" ").filter(Boolean);
  const B = norm(b).split(" ").filter(Boolean);
  if (!A.length || !B.length) return 0;
  const pool = [...B];
  let common = 0;
  for (const w of A) {
    const i = pool.indexOf(w);
    if (i !== -1) {
      common++;
      pool.splice(i, 1);
    }
  }
  // Mostly: are the line's words all there? A little: is there not much else?
  return 0.7 * (common / B.length) + 0.3 * (common / A.length);
}

async function hear(file: string): Promise<string> {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-3.8-flash",
          max_tokens: 400,
          temperature: 0,
          reasoning: { effort: "low" },
          messages: [{ role: "user", content: [{ type: "text", text: "Transcribe exactly. Output only the words, or [silence]." }, { type: "input_audio", input_audio: { data: fs.readFileSync(file).toString("base64"), format: "wav" } }] }],
        }),
      });
      const j = (await r.json()) as { choices?: { message?: { content?: string } }[] };
      const t = j.choices?.[0]?.message?.content?.trim();
      if (t !== undefined) return /^\[silence\]$/i.test(t) ? "" : t;
    } catch {
      // retry
    }
  }
  return "";
}

type Piece = { src: string; start: number; end: number; text: string };
const pieces: Piece[] = [];
for (const [fi, f] of files.entries()) {
  const wav = path.join(tmp, `src${fi}.wav`);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", f, "-ac", "1", "-ar", "16000", wav]);
  const dur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wav]).toString());
  const log = spawnSync("ffmpeg", ["-hide_banner", "-i", wav, "-af", "silencedetect=noise=-30dB:d=0.25", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const starts = [...log.matchAll(/silence_start: ([\d.]+)/g)].map((m) => +m[1]);
  const ends = [...log.matchAll(/silence_end: ([\d.]+)/g)].map((m) => +m[1]);
  const cuts = [0];
  starts.forEach((s, i) => {
    const mid = (s + (ends[i] ?? dur)) / 2;
    if (mid > 0.3 && mid < dur - 0.3 && mid - cuts[cuts.length - 1] > 0.4) cuts.push(+mid.toFixed(2));
  });
  cuts.push(dur);
  for (let i = 0; i < cuts.length - 1; i++) pieces.push({ src: wav, start: cuts[i], end: cuts[i + 1], text: "" });
}
console.log(`${pieces.length} pieces from ${files.length} recording(s); transcribing…`);
const queue = pieces.map((p, i) => ({ p, i }));
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (queue.length) {
      const { p, i } = queue.shift()!;
      const f = path.join(tmp, `p${i}.wav`);
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", p.src, "-ss", String(p.start), "-to", String(p.end), f]);
      p.text = await hear(f);
    }
  }),
);

if (args.includes("--clear")) await fetch(`${BASE}/api/voice-bank`, { method: "DELETE" });

// For every line, the run of 1 to 4 neighbouring pieces (same recording) that sounds most like it.
let found = 0;
for (const [n, line] of DEMO_LINES.entries()) {
  let best: { a: number; b: number; score: number } | null = null;
  for (let a = 0; a < pieces.length; a++) {
    for (let b = a; b < Math.min(pieces.length, a + 4); b++) {
      if (pieces[b].src !== pieces[a].src) break;
      const text = pieces.slice(a, b + 1).map((p) => p.text).join(" ");
      // Ignore a spoken line number at the start ("Twelve.", "Line 12").
      const clean = text.replace(/^(line\s*)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty[\s-]?\w*|thirty[\s-]?\w*)[.,:]?\s*/i, "");
      const score = sim(clean, line.text);
      if (!best || score > best.score + 0.001) best = { a, b, score };
    }
  }
  if (!best || best.score < 0.6) {
    console.log(`  ${String(n + 1).padStart(2)} MISSING  ${line.text}`);
    continue;
  }
  // If the first piece is only the spoken number, start after it.
  // Drop leading pieces that are only a spoken number or heading.
  let a = best.a;
  while (a < best.b && sim(pieces[a].text, line.text) < 0.2) a++;
  const out = path.join(tmp, `line${n}.wav`);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", pieces[a].src, "-ss", String(pieces[a].start), "-to", String(pieces[best.b].end), "-af", "afade=t=in:d=0.04,areverse,afade=t=in:d=0.06,areverse", out]);
  const form = new FormData();
  form.append("text", line.text);
  form.append("file", new Blob([fs.readFileSync(out)], { type: "audio/wav" }), `line${n}.wav`);
  const res = await fetch(`${BASE}/api/voice-bank`, { method: "POST", body: form });
  found++;
  console.log(`  ${String(n + 1).padStart(2)} ${res.ok ? "ok     " : "FAILED "} ${best.score.toFixed(2)}  ${line.text}`);
}
console.log(`${found} of ${DEMO_LINES.length} lines are now in Aamir's real voice.`);
fs.rmSync(tmp, { recursive: true, force: true });
