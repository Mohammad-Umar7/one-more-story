// Glue for the companion: who the player is, who the companion is, today's
// games, the onboarding state and the one-off "build their world" job that
// runs when the family finishes setup.

import fs from "node:fs";
import { getDb, getSetting, nowIso, setSetting } from "./db";
import { getMedia, mediaPath } from "./media";
import { currentPlayerId, getPlayer } from "./bundle";
import { answers, companionView, getCompanionMember, isPlayerOnboarded, updateMember, voiceLines } from "./family";
import { addMemory, listMemories, memoriesNeedingArt } from "./life";
import { extractLifeStory } from "./interview";
import { makeAvatar, paintMemories } from "./art";
import { cloneWithElevenLabs, isElevenLabsConfigured, matchVoice } from "./voices";
import { renderSample } from "./tts";
import { currentBaseline, latestFocus } from "./assess";
import { hydratePlan, isPlanning, latestPlanFor, localDay, makePlan, type PlanContext } from "./planner";
import { clearMemoryHistory } from "./seed";
import { describeAiError } from "./openrouter";
import { INTERVIEW, type OnboardingStep } from "../shared/onboarding";
import type { Baseline, Companion, DailyPlan } from "../shared/companion";
import type { Player } from "../shared/types";

export interface PlayerContext {
  playerId: string;
  player: Player;
  callName: string;
  companion: Companion | null;
}

export function playerContext(): PlayerContext {
  const playerId = currentPlayerId();
  const player = getPlayer(playerId);
  const callName = player.familyName || player.name;
  return { playerId, player, callName, companion: companionView(playerId, callName) };
}

export function isOnboarded(playerId = currentPlayerId()): boolean {
  return isPlayerOnboarded(playerId);
}

export function planContext(ctx = playerContext()): PlanContext {
  const b = currentBaseline(ctx.playerId);
  return {
    playerId: ctx.playerId,
    playerName: ctx.player.name,
    callName: ctx.callName,
    pronoun: ctx.player.pronoun,
    companion: ctx.companion,
    stage: b?.stage ?? "middle",
    level: b?.level ?? 3,
    focus: latestFocus(ctx.playerId),
  };
}

/**
 * Today's plan with fresh pictures; made now if there isn't one yet. A plan
 * that was already finished today comes back with status "done" (the player
 * rests until tomorrow, unless the family asks for new games).
 */
export async function todayPlan(): Promise<DailyPlan> {
  const ctx = playerContext();
  const day = localDay();
  const plan = latestPlanFor(ctx.playerId, day) ?? (await makePlan(planContext(ctx), day));
  return hydratePlan(plan, ctx.companion, listMemories(ctx.playerId));
}

export function servePlan(plan: DailyPlan): DailyPlan {
  const ctx = playerContext();
  return hydratePlan(plan, ctx.companion, listMemories(ctx.playerId));
}

export function planningNow(): boolean {
  return isPlanning(currentPlayerId());
}

// ---- onboarding state --------------------------------------------------------------

export interface OnboardingState {
  step: OnboardingStep;
  onboarded: boolean;
  player: { name: string; callName: string; pronoun: Player["pronoun"]; lang: string };
  member: {
    id: string;
    name: string;
    relation: string;
    consent: boolean;
    photoUrl: string | null;
    avatarUrl: string | null;
    avatarStatus: string;
    look: string | null;
  } | null;
  answered: { key: string; transcript: string; reply: string | null; audioUrl: string | null }[];
  lines: { key: string; url: string; transcript: string | null }[];
  baseline: Baseline | null;
  build: BuildStatus | null;
}

export function onboardingState(): OnboardingState {
  const ctx = playerContext();
  const m = getCompanionMember(ctx.playerId);
  const ans = m ? answers(m.id) : [];
  const lines = m ? voiceLines(m.id).map((l) => ({ key: l.key, url: `/api/media/${l.mediaId}`, transcript: l.transcript })) : [];
  const baseline = currentBaseline(ctx.playerId);
  const build = buildStatus();
  const onboarded = isOnboarded(ctx.playerId);
  const mainAnswered = INTERVIEW.filter((q) => !q.optional).every((q) => ans.some((a) => a.question_key === q.key));
  let step: OnboardingStep = "about";
  if (onboarded) step = "done";
  else if (build && !build.done) step = "build";
  else if (!m || !m.consent_at) step = "about";
  else if (!m.photo_media_id) step = "photo";
  else if (!mainAnswered) step = "interview";
  else if (lines.length < 3) step = "voice";
  else if (!baseline) step = "stage";
  else step = "build";
  return {
    step,
    onboarded,
    player: { name: ctx.player.name, callName: ctx.callName, pronoun: ctx.player.pronoun, lang: ctx.player.speechLang },
    member: m
      ? {
          id: m.id,
          name: m.name,
          relation: m.relation,
          consent: Boolean(m.consent_at),
          photoUrl: ctx.companion?.photoUrl ?? null,
          avatarUrl: m.avatar_media_id ? `/api/media/${m.avatar_media_id}` : null,
          avatarStatus: m.avatar_status,
          look: m.look,
        }
      : null,
    answered: ans.map((a) => ({ key: a.question_key, transcript: a.transcript, reply: a.reply, audioUrl: a.media_id ? `/api/media/${a.media_id}` : null })),
    lines,
    baseline,
    build,
  };
}

// ---- the build job ----------------------------------------------------------------

export interface BuildStep {
  key: "story" | "voice" | "art" | "games";
  label: string;
  status: "waiting" | "working" | "done" | "failed";
  detail: string | null;
}

export interface BuildStatus {
  startedAt: string;
  done: boolean;
  error: string | null;
  steps: BuildStep[];
}

type GlobalBuild = typeof globalThis & { __omsBuild?: BuildStatus; __omsBuilding?: Promise<void> };

function g(): GlobalBuild {
  return globalThis as GlobalBuild;
}

export function buildStatus(): BuildStatus | null {
  if (g().__omsBuild) return g().__omsBuild!;
  const saved = getSetting("build_status");
  if (!saved) return null;
  try {
    const s = JSON.parse(saved) as BuildStatus;
    // A build that was cut off by a server restart is finished or restartable.
    if (!s.done) return { ...s, done: true, error: s.error ?? "interrupted" };
    return s;
  } catch {
    return null;
  }
}

function save(status: BuildStatus) {
  g().__omsBuild = status;
  setSetting("build_status", JSON.stringify(status));
}

function setStep(status: BuildStatus, key: BuildStep["key"], patch: Partial<BuildStep>) {
  status.steps = status.steps.map((s) => (s.key === key ? { ...s, ...patch } : s));
  save(status);
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | "timeout"> =>
  Promise.race([p, new Promise<"timeout">((r) => setTimeout(() => r("timeout"), ms))]);

/** Turn the onboarding into the player's world. Safe to call twice. */
export function startBuild(): BuildStatus {
  if (g().__omsBuilding) return buildStatus()!;
  const ctx = playerContext();
  const member = getCompanionMember(ctx.playerId);
  if (!member) throw new Error("Tell us who you are first");
  const status: BuildStatus = {
    startedAt: nowIso(),
    done: false,
    error: null,
    steps: [
      { key: "story", label: `Writing ${ctx.callName}'s life story`, status: "waiting", detail: null },
      { key: "voice", label: `Learning ${member.name}'s voice`, status: "waiting", detail: null },
      { key: "art", label: "Painting the memories", status: "waiting", detail: null },
      { key: "games", label: "Making today's games", status: "waiting", detail: null },
    ],
  };
  save(status);

  g().__omsBuilding = (async () => {
    const ans = answers(member.id);

    // 1. The life story (keep anything the family already added by hand).
    setStep(status, "story", { status: "working" });
    try {
      const fromInterview = listMemories(ctx.playerId).filter((m) => m.source === "interview");
      if (!fromInterview.length) {
        const extracted = await extractLifeStory({
          callName: ctx.callName,
          playerName: ctx.player.name,
          pronoun: ctx.player.pronoun,
          memberName: member.name,
          relation: member.relation,
          answers: ans,
        });
        for (const e of extracted) {
          const base = e.from_question.split("__")[0];
          const source = ans.find((a) => a.question_key === base) ?? ans.find((a) => a.question_key === e.from_question);
          addMemory(ctx.playerId, {
            kind: e.kind,
            title: e.title,
            detail: e.detail,
            people: e.people,
            place: e.place,
            era: e.era,
            facts: e.facts,
            artPrompt: e.art_prompt,
            clipMediaId: e.kind === "gentle" ? null : source?.media_id ?? null,
            clipBy: member.name,
            source: "interview",
            addedBy: member.name,
          });
        }
      }
      const count = listMemories(ctx.playerId).length;
      setStep(status, "story", { status: count ? "done" : "failed", detail: count ? `${count} memories` : "No memories could be written" });
    } catch (err) {
      console.warn("[build] life story failed:", describeAiError(err));
      setStep(status, "story", { status: "failed", detail: "Couldn't write the story just now" });
    }

    // 2-3. Voice and paintings at the same time.
    const voice = (async () => {
      setStep(status, "voice", { status: "working" });
      try {
        const samples = ans
          .map((a) => (a.media_id ? getMedia(a.media_id) : null))
          .filter((m): m is NonNullable<typeof m> => !!m && m.kind === "audio")
          .map((m) => ({ data: fs.readFileSync(mediaPath(m)), mime: m.mime, filename: m.file }));
        if (!samples.length) throw new Error("No recordings");
        const match = await matchVoice(samples, renderSample);
        updateMember(member.id, { voice_name: match.voice, voice_style: match.style, voice_summary: match.summary });
        let detail = match.summary;
        if (isElevenLabsConfigured()) {
          try {
            const id = await cloneWithElevenLabs(member.name, samples);
            updateMember(member.id, { eleven_voice_id: id });
            detail = `Cloned: ${match.summary}`;
          } catch (err) {
            console.warn("[build] voice clone failed:", describeAiError(err));
          }
        }
        setStep(status, "voice", { status: "done", detail });
      } catch (err) {
        console.warn("[build] voice match failed:", describeAiError(err));
        setStep(status, "voice", { status: "failed", detail: "Using a warm standard voice for now" });
      }
    })();

    const art = (async () => {
      setStep(status, "art", { status: "working" });
      const fresh = getCompanionMember(ctx.playerId);
      const avatar = fresh && fresh.photo_media_id && fresh.avatar_status !== "ready" && fresh.avatar_status !== "working" ? makeAvatar(fresh.id).catch(() => undefined) : Promise.resolve();
      const todo = memoriesNeedingArt(ctx.playerId);
      let painted = 0;
      setStep(status, "art", { detail: `0 of ${todo.length}` });
      // Give the paintings up to two minutes; any still going finish in the background.
      await withTimeout(
        Promise.all([
          avatar,
          paintMemories(
            todo.map((t) => t.id),
            3,
            () => setStep(status, "art", { detail: `${++painted} of ${todo.length}` }),
          ),
        ]),
        120_000,
      );
      setStep(status, "art", { status: "done", detail: `${painted} of ${todo.length} painted` });
    })();

    await Promise.all([voice, art]);

    // 4. The first day's games.
    setStep(status, "games", { status: "working" });
    try {
      const plan = await makePlan(planContext(playerContext()), localDay());
      setStep(status, "games", { status: "done", detail: plan.games.map((x) => x.title).join(", ") });
    } catch (err) {
      console.warn("[build] plan failed:", describeAiError(err));
      setStep(status, "games", { status: "failed", detail: "Games will be made when the app opens" });
    }

    // The old demo's memory-room history belonged to the demo family.
    if (!isOnboarded(ctx.playerId)) clearMemoryHistory();
    getDb().prepare("UPDATE players SET onboarded_at = COALESCE(onboarded_at, ?) WHERE id = ?").run(nowIso(), ctx.playerId);
    save({ ...status, done: true });
  })()
    .catch((err) => {
      console.warn("[build] failed:", describeAiError(err));
      save({ ...status, done: true, error: "Something went wrong while building" });
    })
    .finally(() => {
      g().__omsBuilding = undefined;
    });

  return status;
}
