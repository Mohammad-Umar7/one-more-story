import crypto from "node:crypto";
import { getDb, nowIso, tx, uid } from "./db";
import { deleteMedia, getMedia, mediaUrl } from "./media";
import { currentPlayerId } from "./bundle";
import { HttpError } from "./http";
import type { CaregiverKind, Difficulty, Patience, Pronoun } from "../shared/types";

const ID_RE = /^[a-z]{1,8}_[A-Za-z0-9_-]{3,40}$/;

function requireMedia(id: string, kind: "image" | "audio") {
  const m = getMedia(id);
  if (!m || m.kind !== kind) throw new HttpError(400, `Unknown ${kind} file`);
  return m;
}

// ---------------------------------------------------------------------------
// Stories (Tell the Story). Clips are uploaded only when the player saves, so
// a discarded recording never leaves the tablet.

export function saveStory(input: {
  clientKey: string;
  photoId: string;
  clips: { mediaId: string; prompt: string | null; transcript: string | null }[];
}): { id: string } {
  return tx((db) => {
    const existing = db.prepare("SELECT id FROM stories WHERE client_key = ?").get(input.clientKey) as { id: string } | undefined;
    if (existing) return existing;
    const photo = db.prepare("SELECT id FROM story_photos WHERE id = ?").get(input.photoId);
    if (!photo) throw new HttpError(400, "Unknown photo");
    if (input.clips.length === 0) throw new HttpError(400, "Nothing was recorded");
    input.clips.forEach((c) => requireMedia(c.mediaId, "audio"));
    const id = uid("story");
    db.prepare("INSERT INTO stories (id, player_id, photo_id, created_at, client_key) VALUES (?, ?, ?, ?, ?)").run(
      id,
      currentPlayerId(),
      input.photoId,
      nowIso(),
      input.clientKey,
    );
    input.clips.forEach((c, i) => {
      db.prepare("INSERT INTO story_clips (id, story_id, media_id, prompt, transcript, sort) VALUES (?, ?, ?, ?, ?, ?)").run(
        uid("clip"),
        id,
        c.mediaId,
        c.prompt?.slice(0, 300) ?? null,
        c.transcript?.slice(0, 2000) ?? null,
        i,
      );
    });
    return { id };
  });
}

export function listStories() {
  const db = getDb();
  const stories = db
    .prepare(
      `SELECT s.id, s.created_at, p.id AS photo_id, p.title, p.media_id FROM stories s
       JOIN story_photos p ON p.id = s.photo_id ORDER BY s.created_at DESC`,
    )
    .all() as { id: string; created_at: string; photo_id: string; title: string; media_id: string }[];
  return stories.map((s) => {
    const clips = db
      .prepare(
        `SELECT c.id, c.media_id, c.prompt, c.transcript, m.duration_ms FROM story_clips c
         JOIN media m ON m.id = c.media_id WHERE c.story_id = ? ORDER BY c.sort`,
      )
      .all(s.id) as { id: string; media_id: string; prompt: string | null; transcript: string | null; duration_ms: number | null }[];
    return {
      id: s.id,
      createdAt: s.created_at,
      photo: { id: s.photo_id, title: s.title, url: mediaUrl(s.media_id) },
      clips: clips.map((c) => ({
        id: c.id,
        url: mediaUrl(c.media_id),
        prompt: c.prompt,
        transcript: c.transcript,
        durationMs: c.duration_ms,
      })),
    };
  });
}

export function deleteStory(id: string): void {
  const db = getDb();
  const clips = db.prepare("SELECT media_id FROM story_clips WHERE story_id = ?").all(id) as { media_id: string }[];
  db.prepare("DELETE FROM stories WHERE id = ?").run(id);
  clips.forEach((c) => deleteMedia(c.media_id));
}

// ---------------------------------------------------------------------------
// Tours (Show Me Your Street). Every step and note is stored as it happens so
// a relative can replay the exact route later.

export function startTour(input: { clientKey: string; routeId: string }): { tourId: string; stepId: string } {
  return tx((db) => {
    const existing = db.prepare("SELECT id FROM tours WHERE client_key = ?").get(input.clientKey) as { id: string } | undefined;
    if (existing) {
      const step = db.prepare("SELECT id FROM tour_steps WHERE tour_id = ? ORDER BY sort LIMIT 1").get(existing.id) as { id: string };
      return { tourId: existing.id, stepId: step.id };
    }
    const route = db.prepare("SELECT id, start_stop_id FROM routes WHERE id = ?").get(input.routeId) as
      | { id: string; start_stop_id: string }
      | undefined;
    if (!route) throw new HttpError(400, "Unknown route");
    const tourId = uid("tour");
    const stepId = uid("step");
    const at = nowIso();
    db.prepare("INSERT INTO tours (id, route_id, player_id, status, started_at, client_key) VALUES (?, ?, ?, 'in_progress', ?, ?)").run(
      tourId,
      route.id,
      currentPlayerId(),
      at,
      input.clientKey,
    );
    db.prepare(
      "INSERT INTO tour_steps (id, tour_id, stop_id, via_direction, via_label, arrived_at, sort, client_key) VALUES (?, ?, ?, NULL, NULL, ?, 0, 'start')",
    ).run(stepId, tourId, route.start_stop_id, at);
    return { tourId, stepId };
  });
}

export function addTourStep(
  tourId: string,
  input: { clientKey: string; stopId: string; direction: string; label: string | null },
): { stepId: string } {
  return tx((db) => {
    const existing = db.prepare("SELECT id FROM tour_steps WHERE tour_id = ? AND client_key = ?").get(tourId, input.clientKey) as
      | { id: string }
      | undefined;
    if (existing) return { stepId: existing.id };
    const tour = db.prepare("SELECT route_id FROM tours WHERE id = ?").get(tourId) as { route_id: string } | undefined;
    if (!tour) throw new HttpError(404, "Tour not found");
    const stop = db.prepare("SELECT id FROM route_stops WHERE id = ? AND route_id = ?").get(input.stopId, tour.route_id);
    if (!stop) throw new HttpError(400, "Unknown stop");
    const sort = (db.prepare("SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM tour_steps WHERE tour_id = ?").get(tourId) as { n: number }).n;
    const stepId = uid("step");
    db.prepare(
      "INSERT INTO tour_steps (id, tour_id, stop_id, via_direction, via_label, arrived_at, sort, client_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(stepId, tourId, input.stopId, input.direction, input.label, nowIso(), sort, input.clientKey);
    return { stepId };
  });
}

export function addTourNote(
  tourId: string,
  input: { clientKey: string; stepId: string; mediaId: string; kind: "note" | "narration"; transcript: string | null },
): { noteId: string } {
  return tx((db) => {
    const existing = db.prepare("SELECT id FROM tour_notes WHERE client_key = ?").get(input.clientKey) as { id: string } | undefined;
    if (existing) return { noteId: existing.id };
    const step = db.prepare("SELECT id FROM tour_steps WHERE id = ? AND tour_id = ?").get(input.stepId, tourId);
    if (!step) throw new HttpError(400, "Unknown tour step");
    requireMedia(input.mediaId, "audio");
    const noteId = uid("note");
    db.prepare(
      "INSERT INTO tour_notes (id, tour_id, step_id, media_id, kind, transcript, created_at, client_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(noteId, tourId, input.stepId, input.mediaId, input.kind, input.transcript?.slice(0, 2000) ?? null, nowIso(), input.clientKey);
    return { noteId };
  });
}

export function finishTour(tourId: string, status: "completed" | "left"): void {
  getDb()
    .prepare("UPDATE tours SET status = ?, ended_at = COALESCE(ended_at, ?) WHERE id = ? AND status = 'in_progress'")
    .run(status, nowIso(), tourId);
}

export function listTours() {
  const db = getDb();
  const tours = db
    .prepare(
      `SELECT t.id, t.status, t.started_at, t.ended_at,
        (SELECT COUNT(*) FROM tour_steps s WHERE s.tour_id = t.id) AS steps,
        (SELECT COUNT(*) FROM tour_notes n WHERE n.tour_id = t.id) AS notes
       FROM tours t ORDER BY t.started_at DESC LIMIT 40`,
    )
    .all() as { id: string; status: string; started_at: string; ended_at: string | null; steps: number; notes: number }[];
  return tours.map((t) => {
    const path = db
      .prepare("SELECT r.name FROM tour_steps s JOIN route_stops r ON r.id = s.stop_id WHERE s.tour_id = ? ORDER BY s.sort")
      .all(t.id) as { name: string }[];
    return {
      id: t.id,
      status: t.status,
      startedAt: t.started_at,
      endedAt: t.ended_at,
      stepCount: t.steps,
      noteCount: t.notes,
      path: path.map((p) => p.name),
    };
  });
}

export function getTour(id: string) {
  const db = getDb();
  const tour = db
    .prepare("SELECT t.*, r.name AS route_name FROM tours t JOIN routes r ON r.id = t.route_id WHERE t.id = ?")
    .get(id) as { id: string; status: string; started_at: string; ended_at: string | null; route_name: string } | undefined;
  if (!tour) throw new HttpError(404, "Tour not found");
  const steps = db
    .prepare(
      `SELECT s.id, s.stop_id, s.via_direction, s.via_label, s.arrived_at, r.name, r.photo_media_id
       FROM tour_steps s JOIN route_stops r ON r.id = s.stop_id WHERE s.tour_id = ? ORDER BY s.sort`,
    )
    .all(id) as {
    id: string;
    stop_id: string;
    via_direction: string | null;
    via_label: string | null;
    arrived_at: string;
    name: string;
    photo_media_id: string;
  }[];
  return {
    id: tour.id,
    routeName: tour.route_name,
    status: tour.status,
    startedAt: tour.started_at,
    endedAt: tour.ended_at,
    steps: steps.map((s) => {
      const notes = db
        .prepare(
          `SELECT n.id, n.media_id, n.kind, n.transcript, n.created_at, m.duration_ms FROM tour_notes n
           JOIN media m ON m.id = n.media_id WHERE n.step_id = ? ORDER BY n.created_at`,
        )
        .all(s.id) as { id: string; media_id: string; kind: string; transcript: string | null; created_at: string; duration_ms: number | null }[];
      return {
        id: s.id,
        stop: { id: s.stop_id, name: s.name, photoUrl: mediaUrl(s.photo_media_id) },
        viaDirection: s.via_direction,
        viaLabel: s.via_label,
        arrivedAt: s.arrived_at,
        notes: notes.map((n) => ({
          id: n.id,
          url: mediaUrl(n.media_id),
          kind: n.kind,
          transcript: n.transcript,
          durationMs: n.duration_ms,
          createdAt: n.created_at,
        })),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Family setup.

export function updatePlayer(input: {
  name?: string;
  familyName?: string;
  pronoun?: Pronoun;
  speechLang?: string;
  patience?: Patience;
  saveTourSpeech?: boolean;
}): void {
  const db = getDb();
  const id = currentPlayerId();
  const p = db.prepare("SELECT * FROM players WHERE id = ?").get(id) as Record<string, unknown>;
  const pronoun = input.pronoun && ["he", "she", "they"].includes(input.pronoun) ? input.pronoun : p.pronoun;
  const patience = input.patience && ["normal", "extra"].includes(input.patience) ? input.patience : p.patience;
  const lang = input.speechLang && /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(input.speechLang) ? input.speechLang : p.speech_lang;
  db.prepare(
    "UPDATE players SET name = ?, family_name = ?, pronoun = ?, speech_lang = ?, patience = ?, save_tour_speech = ? WHERE id = ?",
  ).run(
    input.name?.trim().slice(0, 40) || (p.name as string),
    input.familyName?.trim().slice(0, 40) || (p.family_name as string),
    pronoun as string,
    lang as string,
    patience as string,
    input.saveTourSpeech === undefined ? (p.save_tour_speech as number) : input.saveTourSpeech ? 1 : 0,
    id,
  );
}

export function addCaregiver(input: { name: string; relation: string; kind: CaregiverKind }): { id: string } {
  const db = getDb();
  const id = uid("cg");
  const kind = ["relative", "friend", "professional"].includes(input.kind) ? input.kind : "relative";
  const sort = (db.prepare("SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM caregivers").get() as { n: number }).n;
  db.prepare(
    "INSERT INTO caregivers (id, player_id, name, relation, kind, pair_code, sort, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    currentPlayerId(),
    input.name.trim().slice(0, 40),
    input.relation.trim().slice(0, 60) || "Family",
    kind,
    crypto.randomBytes(9).toString("base64url"),
    sort,
    nowIso(),
  );
  return { id };
}

export function deleteCaregiver(id: string): void {
  const db = getDb();
  db.prepare("UPDATE players SET alert_caregiver_id = NULL WHERE alert_caregiver_id = ?").run(id);
  db.prepare("DELETE FROM caregivers WHERE id = ?").run(id);
}

export function setAlertRecipient(caregiverId: string): void {
  const db = getDb();
  const cg = db.prepare("SELECT id FROM caregivers WHERE id = ?").get(caregiverId);
  if (!cg) throw new HttpError(400, "Unknown person");
  db.prepare("UPDATE players SET alert_caregiver_id = ? WHERE id = ?").run(caregiverId, currentPlayerId());
}

export function getCaregiverForPairing(id: string, code: string) {
  const row = getDb()
    .prepare(
      `SELECT c.id, c.name, c.relation, c.pair_code, p.name AS player_name, p.family_name, p.alert_caregiver_id
       FROM caregivers c JOIN players p ON p.id = c.player_id WHERE c.id = ?`,
    )
    .get(id) as
    | { id: string; name: string; relation: string; pair_code: string; player_name: string; family_name: string; alert_caregiver_id: string | null }
    | undefined;
  if (!row || row.pair_code !== code) throw new HttpError(404, "This pairing link is not valid any more.");
  return {
    id: row.id,
    name: row.name,
    relation: row.relation,
    playerName: row.player_name,
    familyName: row.family_name,
    isAlertRecipient: row.alert_caregiver_id === row.id,
  };
}

export function saveRoom(input: {
  name: string;
  photoMediaId: string;
  difficulty: Difficulty;
  spots: { id: string; label: string; x: number; y: number }[];
  objects: { id: string; name: string; icon: string; question?: string; spotId: string; clueMediaId: string | null }[];
}): void {
  requireMedia(input.photoMediaId, "image");
  if (input.objects.length !== 4) throw new HttpError(400, "Please choose four objects for the round.");
  if (input.spots.length < 4) throw new HttpError(400, "Please mark at least four places on the photo.");
  const spotIds = new Set(input.spots.map((s) => s.id));
  for (const s of input.spots) {
    if (!ID_RE.test(s.id)) throw new HttpError(400, "Invalid place id");
    if (!(s.x >= 0 && s.x <= 1 && s.y >= 0 && s.y <= 1)) throw new HttpError(400, "Place is outside the photo");
    if (!s.label?.trim()) throw new HttpError(400, "Every place needs a name");
  }
  for (const o of input.objects) {
    if (!ID_RE.test(o.id)) throw new HttpError(400, "Invalid object id");
    if (!o.name?.trim()) throw new HttpError(400, "Every object needs a name");
    if (!spotIds.has(o.spotId)) throw new HttpError(400, `Choose where the ${o.name} usually goes`);
    if (o.clueMediaId) requireMedia(o.clueMediaId, "audio");
  }
  tx((db) => {
    const playerId = currentPlayerId();
    const room = db.prepare("SELECT id FROM rooms WHERE player_id = ? LIMIT 1").get(playerId) as { id: string } | undefined;
    const roomId = room?.id ?? uid("room");
    const difficulty = input.difficulty === "gentle" ? "gentle" : "standard";
    if (room) {
      db.prepare("UPDATE rooms SET name = ?, photo_media_id = ?, difficulty = ?, updated_at = ? WHERE id = ?").run(
        input.name.trim().slice(0, 40) || "My room",
        input.photoMediaId,
        difficulty,
        nowIso(),
        roomId,
      );
    } else {
      db.prepare("INSERT INTO rooms (id, player_id, name, photo_media_id, difficulty, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(
        roomId,
        playerId,
        input.name.trim().slice(0, 40) || "My room",
        input.photoMediaId,
        difficulty,
        nowIso(),
      );
    }
    db.prepare("DELETE FROM room_spots WHERE room_id = ?").run(roomId);
    db.prepare("DELETE FROM room_objects WHERE room_id = ?").run(roomId);
    input.spots.forEach((s, i) =>
      db.prepare("INSERT INTO room_spots (id, room_id, label, x, y, sort) VALUES (?, ?, ?, ?, ?, ?)").run(
        s.id,
        roomId,
        s.label.trim().slice(0, 40),
        s.x,
        s.y,
        i,
      ),
    );
    input.objects.forEach((o, i) =>
      db.prepare(
        "INSERT INTO room_objects (id, room_id, name, icon, question, spot_id, clue_media_id, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        o.id,
        roomId,
        o.name.trim().slice(0, 40),
        o.icon || "box",
        o.question?.trim().slice(0, 120) || `Where do you usually keep your ${o.name.trim()}?`,
        o.spotId,
        o.clueMediaId,
        i,
      ),
    );
  });
}

export function saveStoryPhotos(photos: { id?: string; mediaId: string; title: string }[]): void {
  photos.forEach((p) => requireMedia(p.mediaId, "image"));
  tx((db) => {
    const playerId = currentPlayerId();
    const keep = photos.map((p) => p.id).filter((id): id is string => Boolean(id && ID_RE.test(id)));
    const existing = db.prepare("SELECT id FROM story_photos WHERE player_id = ?").all(playerId) as { id: string }[];
    for (const e of existing) {
      if (!keep.includes(e.id)) {
        const used = db.prepare("SELECT COUNT(*) AS n FROM stories WHERE photo_id = ?").get(e.id) as { n: number };
        // Keep photos that already have saved stories (hidden from the game by moving them out of order).
        if (used.n === 0) db.prepare("DELETE FROM story_photos WHERE id = ?").run(e.id);
        else db.prepare("UPDATE story_photos SET sort = 1000 WHERE id = ?").run(e.id);
      }
    }
    photos.forEach((p, i) => {
      const id = p.id && ID_RE.test(p.id) ? p.id : uid("ph");
      db.prepare(
        `INSERT INTO story_photos (id, player_id, media_id, title, sort) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET media_id = excluded.media_id, title = excluded.title, sort = excluded.sort`,
      ).run(id, playerId, p.mediaId, p.title?.trim().slice(0, 80) || "Family photo", i);
    });
  });
}

export function saveRoute(input: {
  name: string;
  startStopId: string;
  stops: { id: string; name: string; photoMediaId: string }[];
  links: { fromStopId: string; toStopId: string; direction: "left" | "right" | "straight"; label: string }[];
}): void {
  if (input.stops.length < 2) throw new HttpError(400, "Add at least two stops.");
  const ids = new Set(input.stops.map((s) => s.id));
  if (!ids.has(input.startStopId)) throw new HttpError(400, "Choose where the tour starts");
  for (const s of input.stops) {
    if (!ID_RE.test(s.id)) throw new HttpError(400, "Invalid stop id");
    if (!s.name?.trim()) throw new HttpError(400, "Every stop needs a name");
    requireMedia(s.photoMediaId, "image");
  }
  const seen = new Set<string>();
  for (const l of input.links) {
    if (!ids.has(l.fromStopId) || !ids.has(l.toStopId)) throw new HttpError(400, "A path points to a missing stop");
    if (!["left", "right", "straight"].includes(l.direction)) throw new HttpError(400, "Invalid direction");
    const key = `${l.fromStopId}:${l.direction}`;
    if (seen.has(key)) throw new HttpError(400, "Each stop can have only one path per direction");
    seen.add(key);
  }
  tx((db) => {
    const playerId = currentPlayerId();
    const route = db.prepare("SELECT id FROM routes WHERE player_id = ? LIMIT 1").get(playerId) as { id: string } | undefined;
    const routeId = route?.id ?? uid("rt");
    if (route) {
      db.prepare("UPDATE routes SET name = ?, start_stop_id = ? WHERE id = ?").run(input.name.trim().slice(0, 60) || "Our street", input.startStopId, routeId);
    } else {
      db.prepare("INSERT INTO routes (id, player_id, name, start_stop_id) VALUES (?, ?, ?, ?)").run(
        routeId,
        playerId,
        input.name.trim().slice(0, 60) || "Our street",
        input.startStopId,
      );
    }
    db.prepare("DELETE FROM route_links WHERE route_id = ?").run(routeId);
    db.prepare("DELETE FROM route_stops WHERE route_id = ?").run(routeId);
    input.stops.forEach((s, i) =>
      db.prepare("INSERT INTO route_stops (id, route_id, name, photo_media_id, sort) VALUES (?, ?, ?, ?, ?)").run(
        s.id,
        routeId,
        s.name.trim().slice(0, 50),
        s.photoMediaId,
        i,
      ),
    );
    input.links.forEach((l) =>
      db.prepare("INSERT INTO route_links (id, route_id, from_stop_id, to_stop_id, direction, label) VALUES (?, ?, ?, ?, ?, ?)").run(
        uid("ln"),
        routeId,
        l.fromStopId,
        l.toStopId,
        l.direction,
        l.label?.trim().slice(0, 60) || `the way ${l.direction}`,
      ),
    );
  });
}
