import { getDb } from "./db";
import { mediaUrl } from "./media";
import { ensureSeeded, DEMO } from "./seed";
import { agentModel, isAgentConfigured } from "./claude";
import { isTtsConfigured, ttsModel } from "./tts";
import { getVapidKeys } from "./push";
import { roundSignature } from "../shared/baseline";
import { companionView, isPlayerOnboarded } from "./family";
import { currentBaseline } from "./assess";
import type {
  Bundle,
  Caregiver,
  Difficulty,
  Player,
  Pronoun,
  Room,
  StoryPhoto,
  StreetRoute,
  Patience,
} from "../shared/types";

interface PlayerRow {
  id: string;
  name: string;
  family_name: string;
  pronoun: string;
  speech_lang: string;
  patience: string;
  save_tour_speech: number;
  alert_caregiver_id: string | null;
}

export function currentPlayerId(): string {
  ensureSeeded();
  const row = getDb().prepare("SELECT id FROM players ORDER BY created_at LIMIT 1").get() as { id: string } | undefined;
  return row?.id ?? DEMO.playerId;
}

export function getPlayer(playerId = currentPlayerId()): Player {
  const r = getDb().prepare("SELECT * FROM players WHERE id = ?").get(playerId) as PlayerRow | undefined;
  if (!r) throw new Error("Player not found");
  return {
    id: r.id,
    name: r.name,
    familyName: r.family_name,
    pronoun: (r.pronoun as Pronoun) ?? "they",
    speechLang: r.speech_lang,
    patience: (r.patience as Patience) ?? "normal",
    saveTourSpeech: r.save_tour_speech === 1,
    alertCaregiverId: r.alert_caregiver_id,
  };
}

export function getCaregivers(playerId = currentPlayerId()): Caregiver[] {
  const rows = getDb()
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM push_subscriptions s WHERE s.caregiver_id = c.id AND s.disabled_at IS NULL) AS devices
       FROM caregivers c WHERE c.player_id = ? ORDER BY c.sort, c.created_at`,
    )
    .all(playerId) as {
    id: string;
    name: string;
    relation: string;
    kind: Caregiver["kind"];
    pair_code: string;
    devices: number;
  }[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    relation: r.relation,
    kind: r.kind,
    pairCode: r.pair_code,
    deviceCount: r.devices,
  }));
}

export function getRoom(playerId = currentPlayerId()): Room | null {
  const db = getDb();
  const room = db.prepare("SELECT * FROM rooms WHERE player_id = ? LIMIT 1").get(playerId) as
    | { id: string; name: string; photo_media_id: string; difficulty: Difficulty }
    | undefined;
  if (!room) return null;
  const spots = db
    .prepare("SELECT id, label, x, y FROM room_spots WHERE room_id = ? ORDER BY sort")
    .all(room.id) as { id: string; label: string; x: number; y: number }[];
  const objects = db
    .prepare(
      `SELECT o.*, m.transcript AS clue_transcript FROM room_objects o
       LEFT JOIN media m ON m.id = o.clue_media_id
       WHERE o.room_id = ? ORDER BY o.sort`,
    )
    .all(room.id) as {
    id: string;
    name: string;
    icon: string;
    question: string;
    spot_id: string;
    clue_media_id: string | null;
    clue_transcript: string | null;
  }[];
  return {
    id: room.id,
    name: room.name,
    photo: { id: room.photo_media_id, url: mediaUrl(room.photo_media_id) },
    difficulty: room.difficulty,
    spots: spots.map((s) => ({ ...s })),
    objects: objects.map((o) => ({
      id: o.id,
      name: o.name,
      icon: o.icon,
      question: o.question,
      spotId: o.spot_id,
      clue: o.clue_media_id
        ? { mediaId: o.clue_media_id, url: mediaUrl(o.clue_media_id), transcript: o.clue_transcript }
        : null,
    })),
    signature: roundSignature(
      room.difficulty,
      objects.map((o) => ({ id: o.id, spotId: o.spot_id })),
    ),
  };
}

export function getStoryPhotos(playerId = currentPlayerId()): StoryPhoto[] {
  const rows = getDb()
    .prepare("SELECT id, media_id, title FROM story_photos WHERE player_id = ? ORDER BY sort")
    .all(playerId) as { id: string; media_id: string; title: string }[];
  return rows.map((r) => ({ id: r.id, title: r.title, photo: { id: r.media_id, url: mediaUrl(r.media_id) } }));
}

export function getRoute(playerId = currentPlayerId()): StreetRoute | null {
  const db = getDb();
  const route = db.prepare("SELECT * FROM routes WHERE player_id = ? LIMIT 1").get(playerId) as
    | { id: string; name: string; start_stop_id: string }
    | undefined;
  if (!route) return null;
  const stops = db
    .prepare("SELECT id, name, photo_media_id FROM route_stops WHERE route_id = ? ORDER BY sort")
    .all(route.id) as { id: string; name: string; photo_media_id: string }[];
  const links = db
    .prepare("SELECT from_stop_id, to_stop_id, direction, label FROM route_links WHERE route_id = ?")
    .all(route.id) as { from_stop_id: string; to_stop_id: string; direction: "left" | "right" | "straight"; label: string }[];
  return {
    id: route.id,
    name: route.name,
    startStopId: route.start_stop_id,
    stops: stops.map((s) => ({ id: s.id, name: s.name, photo: { id: s.photo_media_id, url: mediaUrl(s.photo_media_id) } })),
    links: links.map((l) => ({ fromStopId: l.from_stop_id, toStopId: l.to_stop_id, direction: l.direction, label: l.label })),
  };
}

export function getBundle(): Bundle {
  const playerId = currentPlayerId();
  const player = getPlayer(playerId);
  return {
    player,
    companion: companionView(playerId, player.familyName || player.name),
    onboarded: isPlayerOnboarded(playerId),
    baseline: currentBaseline(playerId),
    caregivers: getCaregivers(playerId),
    room: getRoom(playerId),
    photos: getStoryPhotos(playerId),
    route: getRoute(playerId),
    config: {
      claude: isAgentConfigured(),
      model: agentModel(),
      tts: isTtsConfigured(),
      ttsModel: ttsModel(),
      vapidPublicKey: getVapidKeys().publicKey,
    },
  };
}
