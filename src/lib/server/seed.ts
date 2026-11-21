// Demo content: one fictional family (synthetic data only, no real people).
//
// Yusuf Rahman, 79, has lived in Abu Dhabi since 1974. His daughter Mariam is
// his chosen trusted person. The seed creates one playable room, one cricket
// photo, a branching street route around Noor Bakery, and the memory-game
// history used by the live demo: baseline rounds with 1, 0, 1, 2, 1 hints
// followed by two rounds with 3 hints. The next round with 3 hints (played
// live by a judge) is the third elevated round and triggers the real alert.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getDb, nowIso, tx } from "./db";
import { saveMedia } from "./media";
import { roundSignature } from "../shared/baseline";

export const DEMO = {
  playerId: "p_yusuf",
  roomId: "room_living",
  routeId: "rt_street",
  alertCaregiverId: "cg_mariam",
  baselineHints: [1, 0, 1, 2, 1],
  recentHints: [3, 3],
};

const SEED_DIR = path.join(process.cwd(), "seed");

function seedFile(...parts: string[]): Buffer {
  const p = path.join(SEED_DIR, ...parts);
  if (!fs.existsSync(p)) throw new Error(`Missing seed asset: ${path.relative(process.cwd(), p)}`);
  return fs.readFileSync(p);
}

function mimeFor(file: string): string {
  if (file.endsWith(".jpg") || file.endsWith(".jpeg")) return "image/jpeg";
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".mp3")) return "audio/mpeg";
  if (file.endsWith(".wav")) return "audio/wav";
  if (file.endsWith(".webm")) return "audio/webm";
  return "application/octet-stream";
}

function seedMedia(id: string, rel: string, extra?: { durationMs?: number; transcript?: string }): string {
  saveMedia({
    id,
    data: seedFile(...rel.split("/")),
    mime: mimeFor(rel),
    durationMs: extra?.durationMs ?? null,
    transcript: extra?.transcript ?? null,
  });
  return id;
}

// Places on seed/images/room.jpg, as fractions of the photo (0..1).
export const DEMO_SPOTS = [
  { id: "spot_hooks", label: "hooks by the door", x: 0.235, y: 0.29 },
  { id: "spot_drawer", label: "top drawer", x: 0.38, y: 0.6 },
  { id: "spot_window", label: "windowsill", x: 0.53, y: 0.48 },
  { id: "spot_bowl", label: "blue bowl", x: 0.556, y: 0.79 },
  { id: "spot_chair", label: "armchair", x: 0.745, y: 0.7 },
  { id: "spot_shelf", label: "bookshelf", x: 0.82, y: 0.36 },
  { id: "spot_lamp", label: "lamp table", x: 0.915, y: 0.72 },
];

export const DEMO_OBJECTS = [
  {
    id: "obj_glasses",
    name: "glasses",
    icon: "glasses",
    question: "Where do you usually keep your glasses?",
    spotId: "spot_bowl",
    clue: "clue-glasses.mp3",
    transcript: "I always put my glasses down with the fruit, in the blue one.",
  },
  {
    id: "obj_keys",
    name: "keys",
    icon: "keys",
    question: "Where do you usually keep your keys?",
    spotId: "spot_hooks",
    clue: "clue-keys.mp3",
    transcript: "My keys hang up by the door, so I never forget them.",
  },
  {
    id: "obj_wallet",
    name: "wallet",
    icon: "wallet",
    question: "Where do you usually keep your wallet?",
    spotId: "spot_drawer",
    clue: "clue-wallet.mp3",
    transcript: "My wallet goes in the drawer. The top one.",
  },
  {
    id: "obj_beads",
    name: "prayer beads",
    icon: "beads",
    question: "Where do you usually keep your prayer beads?",
    spotId: "spot_window",
    clue: "clue-beads.mp3",
    transcript: "My beads stay by the window, near the little plant.",
  },
];

const CAREGIVERS = [
  { id: "cg_mariam", name: "Mariam", relation: "Daughter", kind: "relative" },
  { id: "cg_imran", name: "Imran", relation: "Son", kind: "relative" },
  { id: "cg_bashir", name: "Bashir", relation: "Friend from the cricket club", kind: "friend" },
  { id: "cg_grace", name: "Grace", relation: "Home-care nurse", kind: "professional" },
] as const;

const STOPS = [
  { id: "st_gate", name: "Our front gate", image: "gate.jpg" },
  { id: "st_bakery", name: "Noor Bakery", image: "bakery.jpg" },
  { id: "st_lane", name: "Jasmine Lane", image: "lane.jpg" },
  { id: "st_park", name: "The little park", image: "park.jpg" },
  { id: "st_main", name: "The main road", image: "mainroad.jpg" },
  { id: "st_tea", name: "The tea stall", image: "teastall.jpg" },
];

const LINKS = [
  { from: "st_gate", to: "st_bakery", direction: "straight", label: "walk on to the bakery" },
  { from: "st_bakery", to: "st_lane", direction: "left", label: "the lane on the left" },
  { from: "st_bakery", to: "st_main", direction: "right", label: "the main road on the right" },
  { from: "st_lane", to: "st_park", direction: "straight", label: "on to the little park" },
  { from: "st_main", to: "st_tea", direction: "straight", label: "along to the tea stall" },
];

function pairCode(): string {
  return crypto.randomBytes(9).toString("base64url");
}

/** Restore the demo family and content. Push subscriptions survive. */
export function seedDemoContent(): void {
  const created = nowIso();
  tx((db) => {
    db.prepare(
      `INSERT INTO players (id, name, family_name, pronoun, speech_lang, patience, save_tour_speech, alert_caregiver_id, created_at)
       VALUES (?, 'Yusuf', 'Dad', 'he', 'en-US', 'normal', 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, family_name = excluded.family_name,
         pronoun = excluded.pronoun, alert_caregiver_id = excluded.alert_caregiver_id`,
    ).run(DEMO.playerId, DEMO.alertCaregiverId, created);

    // Upsert (never delete) the demo caregivers so pairing links and phone
    // subscriptions keep working across resets.
    CAREGIVERS.forEach((c, i) => {
      db.prepare(
        `INSERT INTO caregivers (id, player_id, name, relation, kind, pair_code, sort, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, relation = excluded.relation,
           kind = excluded.kind, sort = excluded.sort`,
      ).run(c.id, DEMO.playerId, c.name, c.relation, c.kind, pairCode(), i, created);
    });

    // Room
    db.prepare("DELETE FROM rooms WHERE player_id = ?").run(DEMO.playerId);
    seedMedia("m_room", "images/room.jpg");
    db.prepare(
      `INSERT INTO rooms (id, player_id, name, photo_media_id, difficulty, updated_at) VALUES (?, ?, ?, ?, 'standard', ?)`,
    ).run(DEMO.roomId, DEMO.playerId, "Living room", "m_room", created);
    DEMO_SPOTS.forEach((s, i) => {
      db.prepare(`INSERT INTO room_spots (id, room_id, label, x, y, sort) VALUES (?, ?, ?, ?, ?, ?)`).run(
        s.id,
        DEMO.roomId,
        s.label,
        s.x,
        s.y,
        i,
      );
    });
    DEMO_OBJECTS.forEach((o, i) => {
      const clueId = `m_clue_${o.icon}`;
      seedMedia(clueId, `audio/${o.clue}`, { transcript: o.transcript });
      db.prepare(
        `INSERT INTO room_objects (id, room_id, name, icon, question, spot_id, clue_media_id, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(o.id, DEMO.roomId, o.name, o.icon, o.question, o.spotId, clueId, i);
    });

    // Story photo
    db.prepare("DELETE FROM story_photos WHERE player_id = ?").run(DEMO.playerId);
    seedMedia("m_cricket", "images/cricket.jpg");
    db.prepare(`INSERT INTO story_photos (id, player_id, media_id, title, sort) VALUES (?, ?, ?, ?, 0)`).run(
      "ph_cricket",
      DEMO.playerId,
      "m_cricket",
      "Cricket club team photo, about 1978",
    );

    // Street route
    db.prepare("DELETE FROM routes WHERE player_id = ?").run(DEMO.playerId);
    db.prepare(`INSERT INTO routes (id, player_id, name, start_stop_id) VALUES (?, ?, ?, ?)`).run(
      DEMO.routeId,
      DEMO.playerId,
      "Our street in Al Khalidiyah",
      "st_gate",
    );
    STOPS.forEach((s, i) => {
      const mediaId = `m_${s.id}`;
      seedMedia(mediaId, `images/${s.image}`);
      db.prepare(`INSERT INTO route_stops (id, route_id, name, photo_media_id, sort) VALUES (?, ?, ?, ?, ?)`).run(
        s.id,
        DEMO.routeId,
        s.name,
        mediaId,
        i,
      );
    });
    LINKS.forEach((l, i) => {
      db.prepare(
        `INSERT INTO route_links (id, route_id, from_stop_id, to_stop_id, direction, label) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(`ln_${i}`, DEMO.routeId, l.from, l.to, l.direction, l.label);
    });
  });
  seedMemoryHistory();
}

/**
 * Reset only the My Memory Room history to the demo baseline (1, 0, 1, 2, 1)
 * plus two elevated rounds (3, 3), for the player's current room setup.
 * Clears alerts and delivery records so the live demo can be run again.
 */
export function seedMemoryHistory(): { signature: string } {
  return tx((db) => {
    const room = db.prepare("SELECT * FROM rooms WHERE player_id = ? LIMIT 1").get(DEMO.playerId) as
      | { id: string; difficulty: string }
      | undefined;
    if (!room) throw new Error("No room set up yet");
    const objects = db
      .prepare("SELECT id, spot_id FROM room_objects WHERE room_id = ? ORDER BY sort")
      .all(room.id) as { id: string; spot_id: string }[];
    const signature = roundSignature(
      room.difficulty,
      objects.map((o) => ({ id: o.id, spotId: o.spot_id })),
    );

    db.prepare("DELETE FROM alerts WHERE player_id = ?").run(DEMO.playerId);
    db.prepare("DELETE FROM memory_sessions WHERE player_id = ?").run(DEMO.playerId);

    const hints = [...DEMO.baselineHints, ...DEMO.recentHints];
    const today = new Date();
    hints.forEach((count, i) => {
      const daysAgo = (hints.length - i) * 2 - 1; // 13, 11, 9, 7, 5, 3, 1 days ago
      const start = new Date(today);
      start.setUTCDate(start.getUTCDate() - daysAgo);
      start.setUTCHours(6, 30 + i, 0, 0); // mid-morning in Abu Dhabi (UTC+4)
      const end = new Date(start.getTime() + (9 + count) * 60_000);
      const id = `ms_seed_${i + 1}`;
      db.prepare(
        `INSERT INTO memory_sessions (id, player_id, room_id, signature, difficulty, object_count, status,
           started_at, ended_at, hint_count, mic_failures, playback_failures, wrong_choices, voice_used, seeded, client_key)
         VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, 0, 0, ?, 1, 1, ?)`,
      ).run(
        id,
        DEMO.playerId,
        room.id,
        signature,
        room.difficulty,
        objects.length,
        start.toISOString(),
        end.toISOString(),
        count,
        Math.max(0, count - 1),
        `seed-${i + 1}`,
      );
      for (let k = 0; k < count; k++) {
        db.prepare(
          `INSERT INTO hint_events (id, session_id, object_id, playback_id, started_at) VALUES (?, ?, ?, ?, ?)`,
        ).run(
          `he_seed_${i + 1}_${k}`,
          id,
          objects[k % objects.length].id,
          `seed-${i + 1}-${k}`,
          new Date(start.getTime() + (k + 1) * 90_000).toISOString(),
        );
      }
    });
    return { signature };
  });
}

/** Restore everything the family can change, keeping phone subscriptions. */
export function restoreDemo(): void {
  tx((db) => {
    db.prepare("DELETE FROM stories").run();
    db.prepare("DELETE FROM tours").run();
    db.prepare("DELETE FROM caregivers WHERE id NOT IN ('cg_mariam','cg_imran','cg_bashir','cg_grace')").run();
  });
  seedDemoContent();
}

export function ensureSeeded(): void {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) AS n FROM players").get() as { n: number };
  if (row.n === 0) seedDemoContent();
}
