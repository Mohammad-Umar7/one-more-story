// Shapes shared by the server (route handlers) and the client (screens).

export type Pronoun = "he" | "she" | "they";
export type Difficulty = "gentle" | "standard";
export type CaregiverKind = "relative" | "friend" | "professional";
export type Direction = "left" | "right" | "straight" | "back";
export type Patience = "normal" | "extra";

export interface MediaRef {
  id: string;
  url: string;
}

export interface Player {
  id: string;
  name: string; // what the game calls the player: "Yusuf"
  familyName: string; // what the family calls them in alerts: "Dad"
  pronoun: Pronoun;
  speechLang: string; // BCP-47 tag for SpeechRecognition, e.g. "en-US"
  patience: Patience; // how long to wait through pauses before answering
  saveTourSpeech: boolean; // keep the player's spoken words during street tours
  alertCaregiverId: string | null;
}

export interface Caregiver {
  id: string;
  name: string;
  relation: string; // "Daughter", "Home-care nurse"
  kind: CaregiverKind;
  pairCode: string;
  deviceCount: number; // push subscriptions currently active
}

export interface RoomSpot {
  id: string;
  label: string;
  x: number; // 0..1 from the left of the photo
  y: number; // 0..1 from the top of the photo
}

export interface RoomObject {
  id: string;
  name: string; // "glasses"
  icon: string; // key into the object icon set
  question: string; // "Where do you usually keep your glasses?"
  spotId: string;
  clue: { mediaId: string; url: string; transcript: string | null } | null;
}

export interface Room {
  id: string;
  name: string;
  photo: MediaRef;
  difficulty: Difficulty;
  spots: RoomSpot[];
  objects: RoomObject[];
  signature: string; // same objects + places + difficulty => comparable rounds
}

export interface StoryPhoto {
  id: string;
  photo: MediaRef;
  title: string; // family-only label, never read to the player
}

export interface RouteStop {
  id: string;
  name: string;
  photo: MediaRef;
}

export interface RouteLink {
  fromStopId: string;
  toStopId: string;
  direction: Exclude<Direction, "back">;
  label: string; // "the lane on the left"
}

export interface StreetRoute {
  id: string;
  name: string;
  startStopId: string;
  stops: RouteStop[];
  links: RouteLink[];
}

export interface AppConfigStatus {
  claude: boolean; // ANTHROPIC_API_KEY present on the server
  model: string;
  tts: boolean; // OPENROUTER_API_KEY present on the server
  ttsModel: string;
  vapidPublicKey: string;
}

export interface Bundle {
  player: Player;
  caregivers: Caregiver[];
  room: Room | null;
  photos: StoryPhoto[];
  route: StreetRoute | null;
  config: AppConfigStatus;
}

export interface AlertView {
  id: string;
  game: string;
  message: string;
  baseline: number;
  threshold: number;
  hintCounts: number[];
  sessionIds: string[];
  createdAt: string;
  seenAt: string | null;
  caregiverId: string | null;
  caregiverName: string | null;
  deliveries: { status: string; statusCode: number | null; device: string | null; at: string }[];
}

export interface MemorySessionView {
  id: string;
  status: "in_progress" | "completed" | "interrupted";
  startedAt: string;
  endedAt: string | null;
  hintCount: number;
  micFailures: number;
  playbackFailures: number;
  wrongChoices: number;
  objectCount: number;
  signature: string;
  difficulty: Difficulty;
  seeded: boolean;
  valid: boolean;
  excludedReason: string | null;
  role: "baseline" | "compared" | "excluded" | "other-setup";
  elevated: boolean;
}
