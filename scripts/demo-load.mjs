#!/usr/bin/env node
// Load a family member's photo and recordings into a running app, through the
// same steps a family goes through on screen (about you, photo, story
// interview, voice lines, stage check, build). Handy for a demo: record the
// script in demo/SCRIPT.md, drop the files into demo/, and run:
//
//   npm run demo:load            (adds to whatever is there)
//   npm run demo:load -- --fresh (starts the companion over first)
//
// Options: --url http://localhost:3000   --dir demo
// Optional demo/setup.json overrides the form, e.g.
//   { "memberName": "Aamir", "relation": "Grandchild", "playerName": "Abdul Karim",
//     "callName": "Dada", "pronoun": "he", "lang": "en-US",
//     "stage": { "answers": [0, 1, 1, 1, 0], "doctor": "early" } }
//
// Needs ffmpeg on the PATH for anything that isn't already WAV or MP3.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = opt("url", "http://localhost:3000").replace(/\/+$/, "");
const DIR = path.resolve(opt("dir", "demo"));
const FRESH = args.includes("--fresh");

const QUESTIONS = ["childhood", "people", "love", "work", "shared_memory", "favorites", "routine", "gentle"];
const LINES = ["hello", "lets_play", "well_done", "take_time", "its_okay", "love_you"];
const AUDIO_EXT = /\.(m4a|mp3|wav|aac|ogg|opus|webm|mp4|mov|flac|amr|3gp|caf)$/i;
const IMAGE_EXT = /\.(jpe?g|png|webp|heic|heif)$/i;

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(3)}s]`, ...a);
const norm = (s) => s.toLowerCase().replace(/^\d+[-_ ]*/, "").replace(/^line[-_ ]*/, "").replace(/[-\s]/g, "_");

if (!fs.existsSync(DIR)) {
  console.error(`No folder ${DIR}. Put the photo and recordings there (see demo/SCRIPT.md).`);
  process.exit(1);
}
const files = fs.readdirSync(DIR).filter((f) => !f.startsWith("."));
const setupFile = path.join(DIR, "setup.json");
const setup = {
  memberName: "Aamir",
  relation: "Grandchild",
  playerName: "Abdul Karim",
  callName: "Dada",
  pronoun: "he",
  lang: "en-US",
  stage: { answers: [0, 1, 1, 1, 0], doctor: "early" },
  ...(fs.existsSync(setupFile) ? JSON.parse(fs.readFileSync(setupFile, "utf8")) : {}),
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "oms-demo-"));

/** Any recording -> 16 kHz mono WAV, gently loudness-normalised. */
function toWav(file) {
  const out = path.join(tmp, path.basename(file).replace(/\.[^.]+$/, "") + ".wav");
  try {
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", file, "-ac", "1", "-ar", "16000", "-af", "loudnorm=I=-18:TP=-2", out]);
    return { data: fs.readFileSync(out), mime: "audio/wav" };
  } catch {
    if (/\.wav$/i.test(file)) return { data: fs.readFileSync(file), mime: "audio/wav" };
    if (/\.mp3$/i.test(file)) return { data: fs.readFileSync(file), mime: "audio/mpeg" };
    throw new Error(`Couldn't convert ${path.basename(file)}: install ffmpeg, or save it as WAV or MP3`);
  }
}

function toJpeg(file) {
  if (/\.(jpe?g|png|webp)$/i.test(file)) {
    const ext = file.toLowerCase().split(".").pop();
    return { data: fs.readFileSync(file), mime: ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg" };
  }
  const out = path.join(tmp, "photo.jpg");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", file, "-frames:v", "1", out]);
  return { data: fs.readFileSync(out), mime: "image/jpeg" };
}

async function call(p, init) {
  const res = await fetch(BASE + p, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${p}: ${body.error ?? res.status}`);
  return body;
}
const postJson = (p, body) => call(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const postForm = (p, fields) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v && typeof v === "object" && "data" in v) f.append(k, new Blob([v.data], { type: v.mime }), v.name ?? "file");
    else f.append(k, String(v));
  }
  return call(p, { method: "POST", body: f });
};

try {
  await call("/api/health");
} catch {
  console.error(`The app isn't answering at ${BASE}. Start it first (npm run dev), then run this again.`);
  process.exit(1);
}

if (FRESH) {
  await postJson("/api/companion/reset", { confirm: "start-over" });
  log("Started the companion over");
}

await postJson("/api/onboarding/about", { ...setup, consent: true });
log(`About: ${setup.memberName} (${setup.relation}) for ${setup.playerName}, called "${setup.callName}"`);

const photo = files.find((f) => IMAGE_EXT.test(f) && /photo|face|avatar|me/i.test(f)) ?? files.find((f) => IMAGE_EXT.test(f));
if (photo) {
  const img = toJpeg(path.join(DIR, photo));
  await postForm("/api/onboarding/photo", { file: { ...img, name: photo } });
  log(`Photo: ${photo} (the avatar is being painted)`);
} else log("No photo found (add demo/photo.jpg)");

for (const key of QUESTIONS) {
  const file = files.find((f) => AUDIO_EXT.test(f) && !/^line/i.test(f) && norm(f.replace(/\.[^.]+$/, "")) === key);
  if (!file) {
    log(`Story question "${key}": no recording, skipped`);
    continue;
  }
  const audio = toWav(path.join(DIR, file));
  const res = await postForm("/api/onboarding/answer", { key, file: { ...audio, name: `${key}.wav` } });
  log(`Story "${key}": ${res.heard ? `heard ${res.transcript.split(/\s+/).length} words. Reply: "${res.reply}"` : res.reply}`);
}

for (const key of LINES) {
  const file = files.find((f) => AUDIO_EXT.test(f) && /^line/i.test(f) && norm(f.replace(/\.[^.]+$/, "")) === key);
  if (!file) {
    log(`Voice line "${key}": no recording, skipped`);
    continue;
  }
  const audio = toWav(path.join(DIR, file));
  const res = await postForm("/api/onboarding/line", { key, file: { ...audio, name: `${key}.wav` } });
  log(`Voice line "${key}": "${res.transcript ?? "saved"}"`);
}

const st = await postJson("/api/onboarding/stage", setup.stage);
log(`Starting baseline: ${st.baseline.stage} stage, level ${st.baseline.level}`);

await postJson("/api/onboarding/build", {});
log("Building their world…");
let last = "";
for (;;) {
  await new Promise((r) => setTimeout(r, 4000));
  const b = await call("/api/onboarding/build");
  const line = b.steps.map((s) => `${s.label}: ${s.status}${s.detail ? ` (${s.detail})` : ""}`).join(" | ");
  if (line !== last) log(line);
  last = line;
  if (b.done) {
    if (b.error) log(`Finished with a problem: ${b.error}`);
    break;
  }
}
const state = await call("/api/onboarding");
log(`Done. Avatar: ${state.member?.avatarStatus}. Open ${BASE}/ on the phone for ${setup.callName}'s games.`);
fs.rmSync(tmp, { recursive: true, force: true });
