"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { useApp, useScreen } from "@/components/AppProvider";
import { GameShell } from "@/components/GameShell";
import { RoomPhoto } from "@/components/memory/RoomPhoto";
import { ObjectIcon } from "@/components/ObjectIcon";
import { Button, Card, Spinner } from "@/components/ui";
import { HomeIcon, PlayIcon, RefreshIcon, SparkleIcon, SpeakerIcon } from "@/components/icons";
import { clientKey, sendReliably } from "@/lib/client/api";
import { spotAliases } from "@/lib/shared/aliases";
import { isPluralNoun } from "@/lib/shared/text";
import type { ActResult, ScreenController } from "@/lib/client/voice-engine";
import type { ScreenContext } from "@/lib/shared/agent";
import type { RoomObject } from "@/lib/shared/types";
import { useRouter } from "next/navigation";

type Phase = "intro" | "asking" | "celebrating" | "done";

interface RoundState {
  phase: Phase;
  sessionId: string | null;
  index: number;
  attempts: number;
  revealed: boolean;
  offeredClue: boolean;
  found: { objectId: string; spotId: string }[];
  wrongSpotId: string | null;
  hints: number;
  clueBusy: boolean;
  starting: boolean;
  result: { hintCount: number; excludedReason: string | null; alert: { id: string; created: boolean } | null } | null;
}

const fresh = (): RoundState => ({
  phase: "intro",
  sessionId: null,
  index: 0,
  attempts: 0,
  revealed: false,
  offeredClue: false,
  found: [],
  wrongSpotId: null,
  hints: 0,
  clueBusy: false,
  starting: false,
  result: null,
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function live(o: RoomObject) {
  return isPluralNoun(o.name) ? "live" : "lives";
}

function praise(o: RoomObject, spot: string, i: number) {
  const lines = [
    `Yes, the ${spot}. That's where your ${o.name} ${live(o)}.`,
    `That's right, the ${spot}.`,
    `Lovely. Your ${o.name} ${isPluralNoun(o.name) ? "go" : "goes"} in the ${spot}.`,
    `Yes, the ${spot}. Just where ${isPluralNoun(o.name) ? "they belong" : "it belongs"}.`,
  ];
  return lines[i % lines.length];
}

export default function MemoryRoomPage() {
  const { bundle, engine } = useApp();
  const router = useRouter();
  const room = bundle?.room ?? null;
  const name = bundle?.player.name ?? "";
  const st = useRef<RoundState>(fresh());
  const [, render] = useReducer((x: number) => x + 1, 0);
  const alive = useRef(true);
  const debug = useRef(false);

  const update = useCallback((patch: Partial<RoundState>) => {
    st.current = { ...st.current, ...patch };
    render();
  }, []);

  // Leaving mid-round (Home, closing the tab) marks the round interrupted.
  useEffect(() => {
    alive.current = true;
    try {
      debug.current = sessionStorage.getItem("oms-debug") === "1";
    } catch {
      debug.current = false;
    }
    const interruptIfOpen = () => {
      const s = st.current;
      if (s.sessionId && (s.phase === "asking" || s.phase === "celebrating")) {
        navigator.sendBeacon?.(`/api/memory/sessions/${s.sessionId}/interrupt`);
      }
    };
    window.addEventListener("pagehide", interruptIfOpen);
    return () => {
      window.removeEventListener("pagehide", interruptIfOpen);
      interruptIfOpen();
      alive.current = false;
    };
  }, []);

  const objects = room?.objects ?? [];
  const spots = room?.spots ?? [];
  const s = st.current;

  // One question per screen: bring each new question into view (phones scroll).
  const questionKey = `${s.phase}-${s.index}`;
  useEffect(() => {
    if (st.current.phase === "asking" || st.current.phase === "done") window.scrollTo({ top: 0, behavior: "smooth" });
  }, [questionKey]);
  const current = objects[s.index] ?? null;
  const canShowMe = s.phase === "asking" && s.attempts >= 2 && !s.revealed;

  const recordEvent = useCallback((kind: string, eventId: string, detail?: string) => {
    const sid = st.current.sessionId;
    if (!sid) return;
    void sendReliably(`/api/memory/sessions/${sid}/events`, { kind, clientEventId: eventId, detail }).catch(() => undefined);
  }, []);

  const stillHere = (sid: string | null) => alive.current && st.current.sessionId === sid;

  async function startRound(): Promise<ActResult> {
    if (!room || st.current.starting) return { speak: null };
    update({ ...fresh(), starting: true });
    let sessionId: string;
    try {
      ({ sessionId } = await sendReliably<{ sessionId: string }>("/api/memory/sessions", { clientKey: clientKey("round") }));
    } catch {
      update({ starting: false });
      return { speak: "Sorry, I couldn't start the game just now. Let's try again in a moment." };
    }
    if (!alive.current) return { speak: null };
    update({ ...fresh(), phase: "asking", sessionId });
    if (engine.isActive) recordEvent("voice_used", `voice-${sessionId}`);
    engine.prefetch([...objects.map((o, i) => (i === 0 ? o.question : `Now, ${lowerFirst(o.question)}`)), "Here's your clue, in your own voice."]);
    await engine.say(objects[0].question);
    return { speak: null };
  }

  async function finishRound(sid: string) {
    try {
      const res = await sendReliably<RoundState["result"]>(`/api/memory/sessions/${sid}/complete`, {});
      if (alive.current && st.current.sessionId === sid) update({ result: res });
    } catch {
      // The round stays saved as unfinished; nothing to show the player.
    }
  }

  async function choose(spotId: string | null): Promise<ActResult> {
    const cur = st.current;
    if (cur.phase !== "asking" || !spotId || !current) return { speak: null };
    const spot = spots.find((p) => p.id === spotId);
    if (!spot) return { speak: null };
    const sid = cur.sessionId;
    if (spotId === current.spotId) {
      update({
        phase: "celebrating",
        found: [...cur.found, { objectId: current.id, spotId }],
        wrongSpotId: null,
        revealed: false,
      });
      recordEvent("correct", `ok-${sid}-${cur.index}`, `${current.id}@${spotId}`);
      await engine.say(praise(current, spot.label, cur.index));
      if (!engine.isActive) await sleep(1600);
      if (!stillHere(sid)) return { speak: null };
      const next = cur.index + 1;
      if (next < objects.length) {
        update({ phase: "asking", index: next, attempts: 0, revealed: false, offeredClue: false });
        await engine.say(`Now, ${lowerFirst(objects[next].question)}`);
      } else {
        update({ phase: "done" });
        void finishRound(sid!);
        await engine.say(`All four, back where they belong. Thank you, ${name}. Would you like to play again?`);
      }
      return { speak: null };
    }

    const attempts = cur.attempts + 1;
    update({ attempts, wrongSpotId: spotId, offeredClue: Boolean(current.clue) });
    recordEvent("wrong_choice", `wrong-${sid}-${cur.index}-${attempts}`, spotId);
    setTimeout(() => {
      if (alive.current && st.current.wrongSpotId === spotId) update({ wrongSpotId: null });
    }, 2600);
    const other = cur.found.find((f) => f.spotId === spotId);
    const otherObj = other ? objects.find((o) => o.id === other.objectId) : null;
    const opener = otherObj
      ? `That's where your ${otherObj.name} ${live(otherObj)}.`
      : `That's the ${spot.label}. Your ${current.name} usually ${live(current)} somewhere else.`;
    const offer =
      attempts >= 2
        ? current.clue
          ? " Would you like your clue, or shall I show you?"
          : " Shall I show you?"
        : current.clue
          ? " Would you like to hear your clue?"
          : " Have another look.";
    await engine.say(opener + offer);
    return { speak: null };
  }

  async function playClue(): Promise<ActResult> {
    const cur = st.current;
    if (cur.phase !== "asking" || cur.clueBusy || !current) return { speak: null };
    if (!current.clue) {
      await engine.say(`There isn't a recorded clue for your ${current.name} yet.`);
      return { speak: null };
    }
    const sid = cur.sessionId!;
    const obj = current;
    const playbackId = clientKey("pb");
    update({ clueBusy: true, offeredClue: false });
    await engine.say("Here's your clue, in your own voice.");
    if (!stillHere(sid)) return { speak: null };
    const result = await engine.playClip(obj.clue!.url, {
      knownText: obj.clue!.transcript,
      onStarted: () => {
        // The hint counts now: the requested clue has actually started playing.
        void sendReliably<{ hintCount: number }>(`/api/memory/sessions/${sid}/hints`, { playbackId, objectId: obj.id })
          .then((r) => {
            if (stillHere(sid)) update({ hints: r.hintCount });
          })
          .catch(() => undefined);
      },
    });
    if (!stillHere(sid)) return { speak: null };
    update({ clueBusy: false });
    if (result === "failed") {
      recordEvent("playback_failure", `clue-fail-${playbackId}`, obj.id);
      await engine.say("Sorry, I couldn't play your clue just now.");
    } else if (result === "completed") {
      await engine.say(`Where do you think ${isPluralNoun(obj.name) ? "they are" : "it is"}?`);
    }
    return { speak: null };
  }

  async function showMe(): Promise<ActResult> {
    const cur = st.current;
    if (cur.phase !== "asking" || !current) return { speak: null };
    const spot = spots.find((p) => p.id === current.spotId);
    update({ revealed: true });
    recordEvent("reveal", `reveal-${cur.sessionId}-${cur.index}`, current.id);
    await engine.say(`Your ${current.name} ${live(current)} in the ${spot?.label}. Tap it, or tell me, when you're ready.`);
    return { speak: null };
  }

  function context(): ScreenContext {
    const cur = st.current;
    if (cur.phase === "intro" || !current) {
      return {
        game: "memory_room",
        screen: "intro",
        version: `intro-${cur.starting}`,
        scene: `The start of My Memory Room: a photo of ${name}'s ${room?.name.toLowerCase() ?? "room"}, with ${objects.length} everyday things to find.`,
        question: "Shall we start?",
        actions: [
          {
            name: "start_round",
            description: "The player agrees to start the round (yes, okay, let's go, ready).",
            phrases: ["yes", "start", "let's go", "lets go", "ok", "okay", "ready", "sure", "go on", "alright"],
          },
        ],
      };
    }
    if (cur.phase === "done") {
      return {
        game: "memory_room",
        screen: "done",
        version: `done-${cur.sessionId}`,
        scene: "The round is finished: all four things were found.",
        question: "Would you like to play again?",
        actions: [
          {
            name: "play_again",
            description: "The player wants another round.",
            phrases: ["again", "play again", "one more", "yes", "another", "okay", "sure"],
          },
        ],
      };
    }
    const clueYes = cur.offeredClue ? ["yes", "yes please", "please", "okay", "ok", "go on"] : [];
    return {
      game: "memory_room",
      screen: "question",
      version: `q-${cur.sessionId}-${cur.index}-${cur.attempts >= 2 ? "help" : "ask"}-${cur.phase}`,
      scene: `A photo of ${name}'s ${room?.name.toLowerCase() ?? "room"} with ${spots.length} places marked. Thing ${cur.index + 1} of ${objects.length}: ${current.name}.${
        cur.offeredClue ? " The companion just offered to play the player's recorded clue." : ""
      }`,
      question: current.question,
      facts: [`Places marked on the photo: ${spots.map((p) => p.label).join(", ")}.`],
      actions: [
        {
          name: "choose_spot",
          description: `The player names, describes or points to the place where they think their ${current.name} ${live(current)}.`,
          targets: spots.map((p) => ({ id: p.id, label: p.label, aliases: spotAliases(p.label) })),
        },
        {
          name: "play_clue",
          description: `The player asks to hear their own recorded clue for the ${current.name}, a hint, or help${
            cur.offeredClue ? ", or says yes to the offer to hear it" : ""
          }.`,
          phrases: ["clue", "hint", "help me", "remind me", "hear my", "my recording", ...clueYes],
        },
        ...(canShowMe
          ? [
              {
                name: "show_me",
                description: "The player asks to be shown where it is.",
                phrases: ["show me", "where is it", "tell me where", "just show"],
              },
            ]
          : []),
      ],
    };
  }

  const ctrl: ScreenController | null = room
    ? {
        id: "memory-room",
        context,
        greeting: () => {
          const cur = st.current;
          if (cur.phase === "asking" && current) return current.question;
          if (cur.phase === "done") return "Would you like to play again?";
          return `Let's find ${objects.length === 4 ? "four" : objects.length} things in your ${room.name.toLowerCase()}. Shall we start?`;
        },
        repeatLine: () => {
          const cur = st.current;
          if (cur.phase === "asking" && current) return current.question;
          if (cur.phase === "done") return "Would you like to play again?";
          return "Shall we start?";
        },
        act: async (action, target) => {
          switch (action) {
            case "start_round":
            case "play_again":
              return startRound();
            case "choose_spot":
              return choose(target);
            case "play_clue":
              return playClue();
            case "show_me":
              return showMe();
          }
        },
        onFailure: (kind, detail) => {
          const cur = st.current;
          if (cur.sessionId && (cur.phase === "asking" || cur.phase === "celebrating")) {
            // Excludes this round from the baseline. Never counted as a mistake.
            recordEvent(kind === "mic" ? "mic_failure" : "playback_failure", `${kind}-${cur.sessionId}`, detail);
          }
        },
      }
    : null;
  useScreen(ctrl);

  const tap = (action: string, target: string | null = null) => void engine.tap(action, target);

  if (!bundle) {
    return (
      <GameShell title="My Memory Room">
        <div className="flex flex-1 items-center justify-center text-navy-700">
          <Spinner />
        </div>
      </GameShell>
    );
  }

  if (!room || objects.length === 0) {
    return (
      <GameShell title="My Memory Room">
        <Card className="mx-auto mt-6 max-w-lg p-6 text-center">
          <p className="font-display text-2xl">The family hasn&apos;t set up a room yet.</p>
          <Button variant="navy" className="mt-5" onClick={() => router.push("/family/setup/room")}>
            Set up a room
          </Button>
        </Card>
      </GameShell>
    );
  }

  const found = s.found.map((f) => ({ object: objects.find((o) => o.id === f.objectId)!, spotId: f.spotId }));
  const asking = s.phase === "asking" || s.phase === "celebrating";

  return (
    <GameShell title="My Memory Room" screenText={asking && current ? current.question : null}>
      {s.phase === "intro" && (
        <div className="grid gap-4 md:grid-cols-[1.5fr_1fr] md:items-center md:gap-8">
          <div className="animate-fade-up">
            <RoomPhoto photoUrl={room.photo.url} spots={spots} found={[]} wrongSpotId={null} revealSpotId={null} labels="never" interactive={false} onChoose={() => undefined} />
          </div>
          <div className="animate-fade-up [animation-delay:100ms]">
            <h2 className="font-display text-[1.7rem] font-semibold leading-tight md:text-4xl">
              Let&apos;s find four things in your {room.name.toLowerCase()}.
            </h2>
            <ul className="mt-4 grid grid-cols-4 gap-2" aria-label="Things to find">
              {objects.map((o) => (
                <li key={o.id} className="flex flex-col items-center gap-1 text-center text-sm font-bold leading-tight">
                  <span className="flex size-14 items-center justify-center rounded-2xl bg-white shadow-card">
                    <ObjectIcon icon={o.icon} size={36} />
                  </span>
                  <span className="first-letter:uppercase">{o.name}</span>
                </li>
              ))}
            </ul>
            <Button variant="gold" size="xl" className="mt-5 w-full" icon={s.starting ? <Spinner /> : <PlayIcon size={26} />} onClick={() => tap("start_round")} disabled={s.starting}>
              Begin
            </Button>
          </div>
        </div>
      )}

      {asking && current && (
        <div className="grid gap-3 md:grid-cols-[1.45fr_1fr] md:items-start md:gap-x-8 md:gap-y-4">
          <section className="flex flex-col gap-3 md:col-start-2" aria-label="Question">
            <div className="flex items-center gap-3" key={current.id}>
              <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-white shadow-card animate-pop md:size-16">
                <ObjectIcon icon={current.icon} size={40} />
              </span>
              <h2 className="font-display text-[1.55rem] font-semibold leading-tight animate-fade-up md:text-3xl">
                {s.phase === "celebrating" ? (
                  <span className="text-sage-700">{isPluralNoun(current.name) ? "Found them!" : "Found it!"}</span>
                ) : (
                  current.question
                )}
              </h2>
            </div>
            <ol className="flex gap-1.5" aria-label={`Thing ${s.index + 1} of ${objects.length}`}>
              {objects.map((o, i) => (
                <li
                  key={o.id}
                  className={`h-1.5 flex-1 rounded-full transition-colors ${
                    s.found.some((f) => f.objectId === o.id) ? "bg-sage-500" : i === s.index ? "bg-gold-400" : "bg-ivory-300"
                  }`}
                />
              ))}
            </ol>
          </section>

          <section className="md:col-start-1 md:row-span-2 md:row-start-1" aria-label="Your room">
            <RoomPhoto
              photoUrl={room.photo.url}
              spots={spots}
              found={found}
              wrongSpotId={s.wrongSpotId}
              revealSpotId={s.revealed ? current.spotId : null}
              labels={room.difficulty === "gentle" ? "always" : "tablet"}
              interactive={s.phase === "asking"}
              onChoose={(id) => tap("choose_spot", id)}
            />
          </section>

          <section className="flex gap-2 md:col-start-2" aria-label="Help">
            <Button
              variant="ivory"
              size="lg"
              className="flex-1"
              icon={s.clueBusy ? <Spinner /> : <SpeakerIcon size={24} className="text-gold-600" />}
              onClick={() => tap("play_clue")}
              disabled={s.phase !== "asking" || s.clueBusy || !current.clue}
            >
              {current.clue ? "Hear my clue" : "No clue yet"}
            </Button>
            {canShowMe && (
              <Button variant="navy" size="lg" icon={<SparkleIcon size={22} />} onClick={() => tap("show_me")}>
                Show me
              </Button>
            )}
          </section>
        </div>
      )}

      {s.phase === "done" && (
        <div className="grid gap-4 md:grid-cols-[1.45fr_1fr] md:items-center md:gap-8">
          <RoomPhoto photoUrl={room.photo.url} spots={spots} found={found} wrongSpotId={null} revealSpotId={null} labels="never" interactive={false} onChoose={() => undefined} />
          <div className="animate-fade-up">
            <h2 className="font-display text-[1.7rem] font-semibold leading-tight md:text-4xl">All four, back where they belong.</h2>
            <p className="mt-1 text-lg text-navy-700">Thank you, {name}.</p>
            <div className="mt-5 grid gap-2">
              <Button variant="gold" size="xl" icon={<RefreshIcon size={26} />} onClick={() => tap("play_again")}>
                Play again
              </Button>
              <Button variant="ivory" size="lg" icon={<HomeIcon size={24} />} onClick={() => router.push("/")}>
                Another game
              </Button>
            </div>
            {debug.current && s.result && (
              <p className="mt-4 rounded-xl bg-navy-900 p-3 text-sm text-ivory-100">
                debug: {s.result.hintCount} hints · {s.result.excludedReason ?? "valid round"} ·{" "}
                {s.result.alert ? `alert ${s.result.alert.created ? "created" : "already existed"}` : "no alert"}
              </p>
            )}
          </div>
        </div>
      )}
    </GameShell>
  );
}
