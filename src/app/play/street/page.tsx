"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp, useScreen, useVoice } from "@/components/AppProvider";
import { GameShell } from "@/components/GameShell";
import { RecordButton } from "@/components/RecordButton";
import { Button, Card, Eyebrow, Spinner } from "@/components/ui";
import { ArrowLeftIcon, ArrowRightIcon, ArrowUpIcon, CheckIcon, HomeIcon, MicIcon, PlayIcon, UndoIcon, CloseIcon } from "@/components/icons";
import { clientKey, sendReliably, uploadMedia } from "@/lib/client/api";
import { MicCapture } from "@/lib/client/recorder";
import { matchGlobalCommand, type ScreenContext } from "@/lib/shared/agent";
import { contentWords } from "@/lib/shared/text";
import type { ActResult, CapturedTurn, ScreenController } from "@/lib/client/voice-engine";
import type { Direction, RouteStop } from "@/lib/shared/types";

type Phase = "intro" | "tour" | "end";

interface Option {
  direction: Direction;
  label: string;
  toStopId: string;
}

interface Visit {
  stopId: string;
  stepPromise: Promise<string | null>;
}

const DIR_ALIASES: Record<Direction, string[]> = {
  left: ["left", "to the left", "turn left", "left side", "go left"],
  right: ["right", "to the right", "turn right", "right side", "go right"],
  straight: ["straight", "straight on", "ahead", "forward", "keep going", "carry on", "walk on", "go on"],
  back: ["back", "go back", "turn back", "the way we came", "return", "turn around"],
};

const ANIM: Record<Direction | "start", string> = {
  left: "animate-from-left",
  right: "animate-from-right",
  straight: "animate-from-ahead",
  back: "animate-fade-in",
  start: "animate-fade-in",
};

export default function StreetPage() {
  const { bundle } = useApp();
  const { engine, snap } = useVoice();
  const router = useRouter();
  const route = bundle?.route ?? null;
  const name = bundle?.player.name ?? "";
  const saveSpeech = bundle?.player.saveTourSpeech ?? true;

  const [, render] = useReducer((x: number) => x + 1, 0);
  const st = useRef({
    phase: "intro" as Phase,
    tourId: null as string | null,
    visits: [] as Visit[],
    via: "start" as Direction | "start",
    prompt: "",
    notesHere: 0,
    noteBusy: false,
    noteSaving: false,
    starting: false,
    moves: 0,
  });
  const [tapMic] = useState(() => new MicCapture());
  const [tapRecording, setTapRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const update = (patch: Partial<typeof st.current>) => {
    st.current = { ...st.current, ...patch };
    render();
  };

  useEffect(() => {
    alive.current = true;
    const leave = () => {
      const s = st.current;
      if (s.tourId && s.phase === "tour") navigator.sendBeacon?.(`/api/tours/${s.tourId}/finish`, JSON.stringify({ status: "left" }));
    };
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      leave();
      alive.current = false;
      tapMic.release();
    };
  }, [tapMic]);

  const s = st.current;
  const stops = route?.stops ?? [];
  const stopById = (id: string | undefined) => stops.find((x) => x.id === id) ?? null;
  const currentVisit = s.visits[s.visits.length - 1] ?? null;
  const stop: RouteStop | null = currentVisit ? stopById(currentVisit.stopId) : stopById(route?.startStopId);

  function optionsFor(stopId: string | undefined, canGoBack: boolean): Option[] {
    if (!route || !stopId) return [];
    const order: Direction[] = ["left", "straight", "right"];
    const opts = route.links
      .filter((l) => l.fromStopId === stopId)
      .sort((a, b) => order.indexOf(a.direction) - order.indexOf(b.direction))
      .map((l) => ({ direction: l.direction as Direction, label: l.label, toStopId: l.toStopId }));
    if (canGoBack) {
      const prev = st.current.visits[st.current.visits.length - 2];
      opts.push({ direction: "back", label: `back to ${stopById(prev?.stopId)?.name ?? "where we were"}`, toStopId: prev?.stopId ?? "" });
    }
    return opts;
  }

  const options = optionsFor(stop?.id, s.visits.length > 1);
  const forward = options.filter((o) => o.direction !== "back");

  function arrivalLine(target: RouteStop, first: boolean): string {
    const onward = optionsFor(target.id, !first).filter((o) => o.direction !== "back");
    const intro = first ? `We're starting at ${target.name}.` : `Here we are at ${target.name}.`;
    if (onward.length === 0) return `${intro} This is as far as the path goes. What can you tell me about it?`;
    return `${intro} What can you tell me about this place?`;
  }

  function choicesLine(): string {
    const visits = st.current.visits;
    const here = visits[visits.length - 1]?.stopId ?? route?.startStopId;
    const opts = optionsFor(here, visits.length > 1);
    const fwd = opts.filter((o) => o.direction !== "back");
    if (fwd.length === 0) return "Shall we turn back, or finish the tour?";
    if (fwd.length === 1) return `Shall we go ${fwd[0].label.replace(/^the /, "on to the ")}?`;
    return `Which way shall we go: ${fwd.map((o) => o.label).join(", or ")}?`;
  }

  function postStep(tourId: string, stopId: string, direction: Direction, label: string | null): Promise<string | null> {
    return sendReliably<{ stepId: string }>(`/api/tours/${tourId}/steps`, {
      clientKey: clientKey("step"),
      stopId,
      direction,
      label,
    })
      .then((r) => r.stepId)
      .catch(() => null);
  }

  async function saveNote(audio: { blob: Blob; durationMs: number }, transcript: string, kind: "note" | "narration") {
    const cur = st.current;
    const visit = cur.visits[cur.visits.length - 1];
    if (!cur.tourId || !visit || audio.blob.size < 800) return false;
    const stepId = await visit.stepPromise;
    if (!stepId) return false;
    try {
      const media = await uploadMedia(audio.blob, { durationMs: audio.durationMs, transcript: transcript || undefined });
      await sendReliably(`/api/tours/${cur.tourId}/notes`, {
        clientKey: clientKey("note"),
        stepId,
        mediaId: media.id,
        kind,
        transcript: transcript || undefined,
      });
      return true;
    } catch {
      return false;
    }
  }

  async function startTour(): Promise<ActResult> {
    if (!route || st.current.starting) return { speak: null };
    update({ starting: true });
    let tourId: string;
    let stepId: string;
    try {
      ({ tourId, stepId } = await sendReliably<{ tourId: string; stepId: string }>("/api/tours", {
        clientKey: clientKey("tour"),
        routeId: route.id,
      }));
    } catch {
      update({ starting: false });
      return { speak: "Sorry, I couldn't start the tour just now." };
    }
    if (!alive.current) return { speak: null };
    const first = stopById(route.startStopId)!;
    const line = arrivalLine(first, true);
    update({
      phase: "tour",
      starting: false,
      tourId,
      visits: [{ stopId: first.id, stepPromise: Promise.resolve(stepId) }],
      via: "start",
      prompt: line,
      notesHere: 0,
      moves: 0,
    });
    await engine.say(line);
    return { speak: null };
  }

  async function go(direction: string | null): Promise<ActResult> {
    const cur = st.current;
    if (cur.phase !== "tour" || !cur.tourId || !direction) return { speak: null };
    const opt = optionsFor(cur.visits[cur.visits.length - 1]?.stopId, cur.visits.length > 1).find((o) => o.direction === direction);
    if (!opt) return { speak: choicesLine() };
    const target = stopById(opt.toStopId);
    if (!target) return { speak: null };
    const visits =
      direction === "back"
        ? cur.visits.slice(0, -1).map((v, i, arr) => (i === arr.length - 1 ? { ...v, stepPromise: postStep(cur.tourId!, target.id, "back", opt.label) } : v))
        : [...cur.visits, { stopId: target.id, stepPromise: postStep(cur.tourId, target.id, opt.direction, opt.label) }];
    update({ visits, via: opt.direction, notesHere: 0, moves: cur.moves + 1 });
    const line = direction === "back" ? `We're back at ${target.name}. ${choicesLine()}` : arrivalLine(target, false);
    update({ prompt: line });
    window.scrollTo({ top: 0, behavior: "smooth" });
    await engine.say(line);
    return { speak: null };
  }

  async function leaveNote(source: "voice" | "tap"): Promise<ActResult> {
    const cur = st.current;
    if (cur.phase !== "tour" || cur.noteBusy) return { speak: null };
    if (source === "tap" || !engine.isActive) {
      setTapRecording(true);
      return { speak: null };
    }
    update({ noteBusy: true });
    await engine.say("I'm listening. Tell me your note for the family, and I'll save it.");
    const turn = await engine.recordNote();
    if (!alive.current) return { speak: null };
    if (!turn || turn.blob.size < 800) {
      update({ noteBusy: false });
      return { speak: "All right, no note this time." };
    }
    update({ noteSaving: true });
    const ok = await saveNote(turn, turn.transcript, "note");
    if (!alive.current) return { speak: null };
    update({ noteBusy: false, noteSaving: false, notesHere: st.current.notesHere + (ok ? 1 : 0) });
    return { speak: ok ? `Saved your note. ${choicesLine()}` : "Sorry, I couldn't save that note." };
  }

  async function finishTour(): Promise<ActResult> {
    const cur = st.current;
    if (!cur.tourId) return { speak: null };
    void sendReliably(`/api/tours/${cur.tourId}/finish`, { status: "completed" }).catch(() => undefined);
    update({ phase: "end" });
    await engine.say(`Thank you for the tour, ${name}. Your family can walk it with you any time.`);
    return { speak: null };
  }

  function context(): ScreenContext {
    const cur = st.current;
    if (cur.phase === "intro") {
      return {
        game: "show_me_your_street",
        screen: "intro",
        version: `intro-${cur.starting}`,
        scene: `The start of Show Me Your Street. ${name} is invited to be the tour guide of their own street.`,
        question: "Will you show me around your street?",
        actions: [
          {
            name: "start_tour",
            description: "The player agrees to start the tour.",
            phrases: ["yes", "let's go", "lets go", "okay", "ok", "sure", "start", "come on", "follow me"],
          },
        ],
      };
    }
    if (cur.phase === "end") {
      return {
        game: "show_me_your_street",
        screen: "end",
        version: `end-${cur.tourId}`,
        scene: "The tour is over and saved for the family.",
        question: "Would you like to walk it again another time?",
        actions: [{ name: "start_tour", description: "Start a new tour.", phrases: ["again", "walk again", "another tour", "one more"] }],
      };
    }
    const here = stop;
    const opts = optionsFor(here?.id, cur.visits.length > 1);
    return {
      game: "show_me_your_street",
      screen: "stop",
      version: `stop-${cur.moves}-${cur.noteBusy}`,
      mode: "conversation",
      talkAction: "none",
      scene: `A photo of a stop on ${name}'s street: "${here?.name}". The player is the tour guide and you are the curious visitor.`,
      question: cur.prompt,
      facts: [`This stop is called "${here?.name}" (the family's name for it).`, `Ways on from here: ${opts.map((o) => o.label).join("; ") || "none"}.`],
      actions: [
        {
          name: "go",
          description: "The player chooses which way to walk next. Both directions are fine choices.",
          targets: opts.map((o) => {
            const to = stopById(o.toStopId);
            const extra = to ? [to.name, ...contentWords(to.name)] : [];
            return { id: o.direction, label: o.label, aliases: [...DIR_ALIASES[o.direction], ...extra].slice(0, 12) };
          }),
        },
        {
          name: "leave_note",
          description: "The player wants to leave a voice note at this stop for the family.",
          phrases: ["leave a note", "voice note", "record a note", "leave a message", "message for the family", "record something"],
        },
        {
          name: "finish_tour",
          description: "The player wants to end the tour.",
          phrases: ["end the tour", "finish the tour", "that's the tour", "stop the tour", "the end of the tour", "let's finish"],
        },
      ],
    };
  }

  const ctrl: ScreenController | null = route
    ? {
        id: "show-me-your-street",
        context,
        greeting: () => {
          const cur = st.current;
          if (cur.phase === "intro") return "Today you're the tour guide. Will you show me around your street?";
          if (cur.phase === "end") return "Thank you for the tour.";
          return cur.prompt || choicesLine();
        },
        repeatLine: () => context().question ?? null,
        captureAnswers: () => saveSpeech && st.current.phase === "tour",
        onTurnAudio: (turn: CapturedTurn) => {
          // The guide's own words, saved at this stop so the family can replay the tour.
          if (st.current.phase !== "tour") return;
          if (matchGlobalCommand(turn.transcript, context())) return;
          void saveNote(turn, turn.transcript, "narration");
        },
        act: async (action, target, meta) => {
          switch (action) {
            case "start_tour":
              return startTour();
            case "go":
              return go(target);
            case "leave_note":
              return leaveNote(meta.source);
            case "finish_tour":
              return finishTour();
          }
        },
      }
    : null;
  useScreen(ctrl);

  const tap = (action: string, target: string | null = null) => void engine.tap(action, target);

  if (!bundle) {
    return (
      <GameShell title="Show Me Your Street">
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      </GameShell>
    );
  }
  if (!route || !stop) {
    return (
      <GameShell title="Show Me Your Street">
        <Card className="mx-auto mt-6 max-w-lg p-6 text-center">
          <p className="font-display text-2xl">The family hasn&apos;t added street photos yet.</p>
          <Button variant="navy" className="mt-5" onClick={() => router.push("/family/setup/street")}>
            Add a street
          </Button>
        </Card>
      </GameShell>
    );
  }

  const arrowFor = (d: Direction, size = 30) =>
    d === "left" ? <ArrowLeftIcon size={size} /> : d === "right" ? <ArrowRightIcon size={size} /> : d === "back" ? <UndoIcon size={size} /> : <ArrowUpIcon size={size} />;
  const voiceOn = snap.active && !snap.paused;
  const pathNames = s.visits.map((v) => stopById(v.stopId)?.name ?? "");

  return (
    <GameShell title="Show Me Your Street">
      {s.phase === "intro" && (
        <div className="grid gap-5 md:grid-cols-[1.4fr_1fr] md:items-center">
          <div className="photo-frame animate-fade-up">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={stop.photo.url} alt={stop.name} className="aspect-[4/3] w-full rounded-[0.9rem] object-cover" />
          </div>
          <div className="animate-fade-up [animation-delay:120ms]">
            <Eyebrow>You&apos;re the guide</Eyebrow>
            <h2 className="mt-1 font-display text-[1.7rem] font-semibold leading-tight md:text-4xl">Will you show me around your street?</h2>
            <p className="mt-2 text-lg text-navy-700">We&apos;ll start at {stop.name}. You choose the way.</p>
            <Button variant="gold" size="xl" className="mt-5 w-full" icon={s.starting ? <Spinner /> : <PlayIcon size={26} />} disabled={s.starting} onClick={() => tap("start_tour")}>
              Start the tour
            </Button>
          </div>
        </div>
      )}

      {s.phase === "tour" && (
        <div className="grid gap-4 md:grid-cols-[1.5fr_1fr] md:items-start md:gap-6">
          <section aria-label="Where we are" className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-2xl font-semibold md:text-3xl">{stop.name}</h2>
              <span className="shrink-0 rounded-full bg-white px-3 py-1 text-base font-bold text-navy-600 shadow-card">Stop {s.visits.length}</span>
            </div>
            <div className="photo-frame">
              <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[0.9rem] bg-navy-900">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img key={`${stop.id}-${s.moves}`} src={stop.photo.url} alt={stop.name} className={`absolute inset-0 h-full w-full object-cover ${ANIM[s.via]}`} />
                {forward.map((o) => (
                  <button
                    key={o.direction}
                    type="button"
                    onClick={() => tap("go", o.direction)}
                    aria-label={`Go ${o.direction}: ${o.label}`}
                    className={`absolute flex size-16 items-center justify-center rounded-full border-4 border-white bg-gold-400 text-navy-950 shadow-photo animate-glow active:scale-95 ${
                      o.direction === "left"
                        ? "left-3 top-1/2 -translate-y-1/2"
                        : o.direction === "right"
                          ? "right-3 top-1/2 -translate-y-1/2"
                          : "bottom-3 left-1/2 -translate-x-1/2"
                    }`}
                  >
                    {arrowFor(o.direction, 32)}
                  </button>
                ))}
              </div>
            </div>
            {pathNames.length > 1 && (
              <ol className="flex flex-wrap items-center gap-1.5 text-sm font-bold text-navy-600" aria-label="The way so far">
                {pathNames.map((n, i) => (
                  <li key={`${n}-${i}`} className="flex items-center gap-1.5">
                    {i > 0 && <span aria-hidden="true">→</span>}
                    <span className={`rounded-full px-2.5 py-1 ${i === pathNames.length - 1 ? "bg-navy-800 text-ivory-50" : "bg-white shadow-card"}`}>{n}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section aria-label="Which way" className="flex flex-col gap-2">
            <p className="text-base font-bold text-navy-600">{forward.length ? "Which way shall we go?" : "This is as far as the path goes."}</p>
            {options.map((o) => (
              <Button
                key={o.direction}
                variant={o.direction === "back" ? "ivory" : "navy"}
                size="lg"
                className="w-full justify-start text-left"
                icon={arrowFor(o.direction, 26)}
                onClick={() => tap("go", o.direction)}
              >
                <span className="first-letter:uppercase">{o.label}</span>
              </Button>
            ))}

            <div className="mt-2 rounded-3xl bg-white/80 p-3 shadow-card">
              {s.noteBusy && voiceOn ? (
                <div className="flex flex-col gap-2">
                  <p className="flex items-center gap-2 px-1 text-lg font-bold text-clay-500">
                    <span className="size-2.5 animate-pulse rounded-full bg-clay-500" />
                    {s.noteSaving ? "Saving your note…" : "Recording your note. Just talk."}
                  </p>
                  {!s.noteSaving && (
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="gold" size="md" icon={<CheckIcon size={20} />} onClick={() => engine.finishTurnNow()}>
                        I&apos;m finished
                      </Button>
                      <Button variant="ivory" size="md" icon={<CloseIcon size={20} />} onClick={() => engine.cancelNote()}>
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>
              ) : tapRecording ? (
                <RecordButton
                  mic={tapMic}
                  size="lg"
                  label="Start my note"
                  stopLabel="Save my note"
                  onRecorded={async (rec) => {
                    setTapRecording(false);
                    update({ noteSaving: true });
                    const ok = await saveNote(rec, "", "note");
                    update({ noteSaving: false, notesHere: st.current.notesHere + (ok ? 1 : 0) });
                    void engine.say(ok ? "Saved your note for the family." : "Sorry, I couldn't save that note.");
                  }}
                  onError={(m) => {
                    setTapRecording(false);
                    setError(m);
                  }}
                />
              ) : (
                <Button variant="gold" size="lg" className="w-full" icon={s.noteSaving ? <Spinner /> : <MicIcon size={24} />} disabled={s.noteSaving} onClick={() => tap("leave_note")}>
                  Leave a voice note here
                </Button>
              )}
              {s.notesHere > 0 && (
                <p className="mt-2 flex items-center gap-1.5 px-1 text-base font-bold text-sage-700">
                  <CheckIcon size={18} /> {s.notesHere} note{s.notesHere === 1 ? "" : "s"} saved at this stop
                </p>
              )}
              {voiceOn && saveSpeech && snap.capturing && !s.noteBusy && (
                <p className="mt-2 px-1 text-sm text-navy-600">Your words on this tour are saved for your family to replay.</p>
              )}
            </div>

            <Button variant="ghost" size="md" icon={<CheckIcon size={20} />} onClick={() => tap("finish_tour")}>
              Finish the tour
            </Button>
            {error && <p className="rounded-2xl bg-white p-3 text-lg font-bold text-clay-500 shadow-card">{error}</p>}
          </section>
        </div>
      )}

      {s.phase === "end" && (
        <Card className="mx-auto mt-4 w-full max-w-xl p-6 text-center animate-fade-up">
          <span className="mx-auto mb-3 flex size-16 items-center justify-center rounded-full bg-sage-100 text-sage-700 animate-pop">
            <CheckIcon size={34} strokeWidth={3} />
          </span>
          <h2 className="font-display text-3xl font-semibold">Thank you for the tour.</h2>
          <p className="mt-2 text-lg text-navy-700">Saved for your family to walk again with you.</p>
          <ol className="mt-4 flex flex-wrap justify-center gap-1.5 text-sm font-bold text-navy-600">
            {pathNames.map((n, i) => (
              <li key={`${n}-${i}`} className="flex items-center gap-1.5">
                {i > 0 && <span aria-hidden="true">→</span>}
                <span className="rounded-full bg-white px-2.5 py-1 shadow-card">{n}</span>
              </li>
            ))}
          </ol>
          <div className="mt-6 flex flex-col gap-2">
            <Button variant="gold" size="lg" icon={<PlayIcon size={22} />} onClick={() => tap("start_tour")}>
              Walk again
            </Button>
            <Button variant="ivory" size="lg" icon={<HomeIcon size={24} />} onClick={() => router.push("/")}>
              Choose another game
            </Button>
          </div>
        </Card>
      )}
    </GameShell>
  );
}
