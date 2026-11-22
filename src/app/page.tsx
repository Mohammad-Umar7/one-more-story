"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp, useScreen, useVoice } from "@/components/AppProvider";
import { NightSky } from "@/components/companion/NightSky";
import { Avatar } from "@/components/companion/Avatar";
import { Caption, Confetti } from "@/components/companion/Caption";
import { ChoiceCard, type ChoiceState } from "@/components/companion/ChoiceCard";
import { BreatheGame, SparkleGame } from "@/components/companion/CalmGames";
import { MicIcon, MicOffIcon, PauseIcon, UsersIcon } from "@/components/icons";
import { sendReliably } from "@/lib/client/api";
import { startChain } from "@/lib/client/chain";
import { sparkleChord, unlockChime } from "@/lib/client/chime";
import { words } from "@/lib/shared/text";
import { isScored, KIND_LABEL, type DailyPlan, type Game, type GameChoice, type GameItem, type ItemResult, type Memory } from "@/lib/shared/companion";
import type { ActMeta, ActResult, ScreenController } from "@/lib/client/voice-engine";
import type { ScreenContext } from "@/lib/shared/agent";

// The player's screen. A familiar face in the middle starts talking as soon
// as the app opens and leads the day's games itself: there are no menus and
// nothing to choose. Answers can be spoken or tapped. When the games are
// done the AI sets tomorrow's baseline and makes tomorrow's games.

type Phase = "loading" | "wake" | "talking" | "playing" | "closing" | "rest";

interface Track {
  attempts: number;
  hints: number;
  revealed: boolean;
  correct: boolean;
  spoke: boolean;
  words: number;
  askedAt: number;
  firstAt: number | null;
  done: boolean;
}

interface Outcome {
  feedback: string;
  celebrate: boolean;
  skipped?: boolean;
}

const newTrack = (): Track => ({ attempts: 0, hints: 0, revealed: false, correct: false, spoke: false, words: 0, askedAt: 0, firstAt: null, done: false });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
class Stopped extends Error {}

/** Lead the day with Umar's classic games (voice-led: room, street, story). */
const USE_CLASSIC_GAMES = true;

const RETRY = ["Let's have another look.", "Hmm, have another look.", "Nearly. Look again."];

function greetingWord(h: number) {
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function CompanionPage() {
  const { bundle, engine, loadError } = useApp();
  const { snap } = useVoice();
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("loading");
  const [plan, setPlan] = useState<DailyPlan | null>(null);
  const [played, setPlayed] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState<{ g: number; i: number } | null>(null);
  const [states, setStates] = useState<Record<string, ChoiceState>>({});
  const [seq, setSeq] = useState<string[]>([]);
  const [locked, setLocked] = useState(true);
  const [burst, setBurst] = useState(0);
  const [planError, setPlanError] = useState<string | null>(null);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [showNext, setShowNext] = useState(false);

  const companion = bundle?.companion ?? null;
  const call = bundle ? bundle.player.familyName || bundle.player.name : "";
  const stage = plan?.stage ?? bundle?.baseline?.stage ?? "middle";

  // Refs the director and the voice controller read (always the latest).
  const planRef = useRef<DailyPlan | null>(null);
  const cursorRef = useRef<{ g: number; i: number } | null>(null);
  const trackRef = useRef<Track>(newTrack());
  const seqRef = useRef<string[]>([]);
  const pending = useRef<((o: Outcome) => void) | null>(null);
  const calmDone = useRef<(() => void) | null>(null);
  const nudge = useRef<ReturnType<typeof setTimeout>[]>([]);
  const runToken = useRef(0);
  const mounted = useRef(true);
  const lastLine = useRef("");
  const idleItems = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      runToken.current++;
      nudge.current.forEach(clearTimeout);
    };
  }, []);

  const current: { game: Game; item: GameItem } | null = useMemo(() => {
    if (!plan || !cursor || cursor.i < 0) return null;
    const game = plan.games[cursor.g];
    const item = game?.items[cursor.i];
    return game && item ? { game, item } : null;
  }, [plan, cursor]);
  const currentGame = plan && cursor ? plan.games[cursor.g] ?? null : null;

  // ---- loading -------------------------------------------------------------------

  useEffect(() => {
    if (!bundle) return;
    if (!bundle.onboarded) {
      router.replace("/welcome");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/companion/today", { cache: "no-store" });
        const data = (await res.json()) as { plan: DailyPlan; played: string[]; error?: string };
        if (!res.ok) throw new Error(data.error ?? "Couldn't make today's games");
        if (cancelled) return;
        planRef.current = data.plan;
        setPlan(data.plan);
        setPlayed(new Set(data.played));
      } catch (err) {
        if (!cancelled) setPlanError((err as Error).message);
      }
    })();
    void fetch("/api/memories", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ memories: Memory[] }>)
      .then((d) => !cancelled && setMemories((d.memories ?? []).filter((m) => m.kind !== "gentle")))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [bundle, router]);

  // ---- speaking helpers ----------------------------------------------------------

  const alive = useCallback((token: number) => mounted.current && token === runToken.current, []);

  const ensure = useCallback(
    async (token: number) => {
      if (!alive(token)) throw new Stopped();
      if (!engine.isActive) {
        await engine.waitUntilActive();
        if (!alive(token)) throw new Stopped();
      }
    },
    [alive, engine],
  );

  const say = useCallback(
    async (token: number, text: string | null | undefined) => {
      if (!text) return;
      await ensure(token);
      lastLine.current = text;
      await engine.say(text);
      if (!alive(token)) throw new Stopped();
    },
    [alive, engine, ensure],
  );

  /** One of the family member's real recordings (falls back to the matched voice). */
  const real = useCallback(
    async (token: number, key: keyof NonNullable<typeof companion>["lines"], fallback: string) => {
      const line = companion?.lines[key];
      if (!line) return say(token, fallback);
      await ensure(token);
      lastLine.current = line.text;
      await engine.playClip(line.url, { knownText: line.text });
      if (!alive(token)) throw new Stopped();
    },
    [alive, companion, engine, ensure, say],
  );

  // ---- answering -------------------------------------------------------------------

  const clearNudges = () => {
    nudge.current.forEach(clearTimeout);
    nudge.current = [];
  };

  const postResult = useCallback((game: Game, item: GameItem, t: Track, skipped = false) => {
    const p = planRef.current;
    if (!p) return;
    const result: ItemResult = {
      gameId: game.id,
      itemId: item.id,
      kind: game.kind,
      scored: isScored(p.stage, game.kind) && !!item.answerId,
      correct: t.correct,
      attempts: t.attempts,
      hints: t.hints,
      revealed: t.revealed,
      responseMs: t.firstAt && t.askedAt ? Math.max(0, t.firstAt - t.askedAt) : null,
      spoke: t.spoke,
      words: t.words,
      skipped,
    };
    setPlayed((s) => new Set(s).add(`${game.id}/${item.id}`));
    void sendReliably(`/api/companion/plan/${p.id}/result`, result).catch(() => undefined);
  }, []);

  const finish = (o: Outcome) => {
    clearNudges();
    trackRef.current.done = true;
    const r = pending.current;
    pending.current = null;
    r?.(o);
  };

  const revealAnswer = (item: GameItem) => {
    const t = trackRef.current;
    t.revealed = true;
    if (item.order) {
      seqRef.current = [...item.order];
      setSeq([...item.order]);
    } else if (item.answerId) {
      setStates((s) => ({ ...s, [item.answerId!]: "right" }));
    }
    finish({ feedback: item.reveal, celebrate: false });
  };

  const giveHint = (item: GameItem, auto = false) => {
    const t = trackRef.current;
    if (t.done) return;
    t.hints++;
    if (t.hints >= 3 && item.answerId) return revealAnswer(item);
    if (t.hints >= 2 && item.answerId) setStates((s) => ({ ...s, [item.answerId!]: "hint" }));
    const line = auto ? `Take your time. ${item.hint}` : item.hint;
    lastLine.current = line;
    void engine.say(line);
  };

  const choose = (choiceId: string, source: "voice" | "tap") => {
    const cur = cursorRef.current;
    const p = planRef.current;
    if (!cur || !p || !pending.current) return;
    const game = p.games[cur.g];
    const item = game?.items[cur.i];
    const t = trackRef.current;
    if (!item || t.done || !item.choices.some((c) => c.id === choiceId)) return;
    idleItems.current = 0;
    if (!t.firstAt) t.firstAt = Date.now();
    if (source === "voice") t.spoke = true;
    clearNudges();

    // In order: each choice adds the next number.
    if (item.order) {
      if (seqRef.current.includes(choiceId)) return;
      const nextSeq = [...seqRef.current, choiceId];
      seqRef.current = nextSeq;
      setSeq(nextSeq);
      if (nextSeq.length < item.order.length) return;
      t.attempts++;
      if (nextSeq.every((id, i) => id === item.order![i])) {
        t.correct = t.attempts === 1;
        return finish({ feedback: item.praise, celebrate: true });
      }
      if (t.attempts < 2) {
        setTimeout(() => {
          seqRef.current = [];
          setSeq([]);
        }, 900);
        t.hints++;
        void engine.say(`Nearly. Let's try once more. ${item.hint}`);
        return;
      }
      return revealAnswer(item);
    }

    t.attempts++;
    const errorless = !isScored(p.stage, game.kind) || !item.answerId;
    if (choiceId === item.answerId || (!item.answerId && errorless)) {
      t.correct = t.attempts === 1;
      setStates((s) => ({ ...s, [choiceId]: "right" }));
      return finish({ feedback: item.praise, celebrate: true });
    }
    if (errorless) {
      // Nothing is ever wrong here: show theirs warmly, then the family's answer.
      setStates((s) => ({ ...s, [choiceId]: "right", ...(item.answerId ? { [item.answerId]: "right" } : {}) }));
      return finish({ feedback: `That's lovely too. ${item.reveal}`, celebrate: true });
    }
    if (t.attempts < 2) {
      setStates((s) => ({ ...s, [choiceId]: "tried" }));
      t.hints++;
      const line = `${RETRY[t.hints % RETRY.length]} ${item.hint}`;
      lastLine.current = line;
      void engine.say(line);
      return;
    }
    setStates((s) => ({ ...s, [choiceId]: "tried" }));
    revealAnswer(item);
  };

  // ---- the voice controller ---------------------------------------------------------

  const ctrl: ScreenController | null = bundle?.onboarded
    ? {
        id: cursor && cursor.i >= 0 ? `companion-${cursor.g}-${cursor.i}` : `companion-${phase}`,
        context: (): ScreenContext => {
          const it = current?.item;
          const kind = current?.game.kind;
          const base = {
            game: "companion" as const,
            version: `${plan?.id ?? "-"}-${cursor?.g ?? -1}-${cursor?.i ?? -1}-${trackRef.current.attempts}-${trackRef.current.hints}`,
          };
          if (!it || !kind || phase !== "playing") {
            return { ...base, screen: "talk", scene: `${companion?.name ?? "The companion"} is talking with ${call}.`, actions: [] };
          }
          if (kind === "reminisce") {
            return {
              ...base,
              screen: kind,
              scene: `A picture from ${call}'s life. ${it.narration ?? ""}`.slice(0, 500),
              question: it.prompt,
              mode: "conversation",
              talkAction: "share",
              actions: [{ name: "share", description: "The player talks about the memory or the picture (anything they say about it)." }],
            };
          }
          if (kind === "sparkle" || kind === "breathe") {
            return { ...base, screen: kind, scene: kind === "sparkle" ? "Glowing stars to touch." : "A slow breathing exercise.", question: it.prompt, actions: [] };
          }
          const open = it.choices.filter((c) => states[c.id] !== "tried" && !seq.includes(c.id));
          return {
            ...base,
            screen: kind,
            scene: `${it.imageUrl ? "A picture is shown. " : ""}${it.narration ? `Story just told: ${it.narration} ` : ""}Choices on screen: ${it.choices.map((c) => c.label).join(", ")}.`.slice(0, 590),
            question: it.prompt,
            actions: [
              {
                name: "choose",
                description: it.order ? "Pick the next moment in time order." : "Pick one of the answers on screen.",
                targets: open.map((c) => ({ id: c.id, label: c.label, aliases: [c.label.toLowerCase()] })),
              },
              { name: "hint", description: "The player asks for help, a clue, or says they don't know or can't remember." },
              { name: "skip", description: "The player clearly wants to move on to the next one." },
            ],
          };
        },
        greeting: () => null,
        repeatLine: () => current?.item.prompt ?? (lastLine.current || null),
        act: (action: string, target: string | null, meta: ActMeta): ActResult => {
          const it = current?.item;
          if (!it) return { speak: null };
          if (action === "choose" && target) choose(target, meta.source);
          else if (action === "hint") giveHint(it);
          else if (action === "skip" && pending.current) {
            postResult(current.game, it, trackRef.current, true);
            finish({ feedback: "That's all right. Let's try another one.", celebrate: false, skipped: true });
          } else if (action === "share") {
            const t = trackRef.current;
            t.spoke = true;
            t.words += words(meta.utterance ?? "").length;
            if (!t.firstAt) t.firstAt = Date.now();
            idleItems.current = 0;
            if (pending.current) finish({ feedback: it.praise, celebrate: false });
          }
          return { speak: null };
        },
      }
    : null;
  useScreen(ctrl);

  // ---- the director: leads the whole day -----------------------------------------

  const runItem = useCallback(
    async (token: number, g: number, i: number) => {
      const p = planRef.current!;
      const game = p.games[g];
      const item = game.items[i];
      trackRef.current = newTrack();
      seqRef.current = [];
      setSeq([]);
      setStates({});
      setShowNext(false);
      setLocked(true);
      cursorRef.current = { g, i };
      setCursor({ g, i });
      await sleep(350);

      if (game.kind === "sparkle" || game.kind === "breathe") {
        const done = new Promise<void>((r) => (calmDone.current = r));
        await say(token, item.prompt);
        setLocked(false);
        trackRef.current.askedAt = Date.now();
        await Promise.race([done, sleep(game.kind === "sparkle" ? 90_000 : 45_000)]);
        calmDone.current = null;
        setLocked(true);
        postResult(game, item, { ...trackRef.current, correct: false, done: true });
        setBurst((b) => b + 1);
        sparkleChord();
        await say(token, item.praise);
        return;
      }

      // A story first: the family's own recording, or the companion telling it.
      if (item.clipUrl) {
        await say(token, `${item.clipBy ?? companion?.name ?? "Your family"} recorded this for you. Listen.`);
        await ensure(token);
        await engine.playClip(item.clipUrl);
        if (!alive(token)) throw new Stopped();
      } else if (item.narration) {
        await say(token, item.narration);
      }

      const answer = new Promise<Outcome>((r) => (pending.current = r));
      setLocked(false);
      await say(token, item.prompt);
      const t = trackRef.current;
      t.askedAt = Date.now();

      if (game.kind === "reminisce") {
        // Open question: talking is the whole game. Carry on after a while either way.
        setShowNext(true);
        nudge.current.push(
          setTimeout(() => {
            if (!t.done) finish({ feedback: t.spoke ? item.praise : "That's a lovely one to think about.", celebrate: false });
          }, 40_000),
        );
      } else if (!t.done) {
        // No answer for a while: a gentle clue, then show it kindly and move on.
        nudge.current.push(setTimeout(() => !t.done && giveHint(item, true), 22_000));
        nudge.current.push(
          setTimeout(() => {
            if (t.done) return;
            idleItems.current++;
            revealAnswer(item);
          }, 50_000),
        );
      }

      const o = await answer;
      setLocked(true);
      setShowNext(false);
      if (!o.skipped) postResult(game, item, t);
      if (o.celebrate) {
        sparkleChord();
        setBurst((b) => b + 1);
      }
      await say(token, o.feedback);
      await sleep(700);
      // Nobody has answered for two items in a row: rest until someone is back.
      if (idleItems.current >= 2) {
        idleItems.current = 0;
        await say(token, `I'll wait right here, ${call}. Touch the screen when you'd like to carry on.`);
        engine.pause();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [alive, call, companion, engine, ensure, postResult, say],
  );

  const captureMemory = useCallback(
    async (token: number) => {
      if (!engine.isActive || snap.recognition !== "supported" || snap.mic === "denied" || snap.mic === "error") return;
      await say(token, `Before we finish, ${call}, tell me about something that made you happy. I'm listening.`);
      const turn = await Promise.race([engine.recordNote(), sleep(30_000).then(() => null)]);
      engine.cancelNote();
      if (!alive(token)) throw new Stopped();
      if (!turn || words(turn.transcript).length < 3) {
        await say(token, "That's all right. You can tell me another time.");
        return;
      }
      const form = new FormData();
      form.append("source", "patient");
      form.append("transcript", turn.transcript);
      form.append("text", turn.transcript);
      if (turn.blob.size > 1000 && turn.mime) form.append("audio", turn.blob, "story.webm");
      void fetch("/api/memories", { method: "POST", body: form }).catch(() => undefined);
      await say(token, "Thank you for telling me. I'll remember that, and I'll share it with the family.");
    },
    [alive, call, engine, say, snap.mic, snap.recognition],
  );

  const direct = useCallback(
    async (p: DailyPlan, already: Set<string>) => {
      const token = ++runToken.current;
      try {
        await ensure(token);
        setPhase("talking");
        // Back from the games: say goodbye.
        if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("after")) {
          setPhase("closing");
          setBurst((b) => b + 1);
          await real(token, "well_done", `Well done, ${call}.`);
          await say(token, `That was wonderful, ${call}. Thank you for playing with me.`);
          await real(token, "love_you", `See you tomorrow, ${call}.`);
          setPhase("rest");
          window.history.replaceState(null, "", "/");
          return;
        }
        // The companion leads Umar's three games: the memory room, the street tour, a story.
        if (USE_CLASSIC_GAMES) {
          await real(token, "hello", `Hello ${call}, it's me, ${companion?.name ?? "your friend"}.`);
          await say(token, `Good morning, ${call}. It's so lovely to see you today.`);
          await real(token, "lets_play", "Let's play a little game together.");
          await say(token, "First, let's find a few of your things in the living room.");
          router.push(startChain());
          return;
        }
        cursorRef.current = null;
        setCursor(null);
        void sendReliably(`/api/companion/plan/${p.id}/start`, {}).catch(() => undefined);
        const resuming = already.size > 0;
        await real(token, "hello", `Hello ${call}, it's me, ${companion?.name ?? "your friend"}.`);
        if (resuming) await say(token, `Let's carry on with our games.`);
        else {
          await say(token, p.greeting);
          await real(token, "lets_play", "Let's play a little game together.");
        }

        for (let g = 0; g < p.games.length; g++) {
          const game = p.games[g];
          const todo = game.items.map((it, i) => ({ it, i })).filter(({ it }) => !already.has(`${game.id}/${it.id}`));
          if (!todo.length) continue;
          setPhase("playing");
          cursorRef.current = { g, i: -1 };
          setCursor({ g, i: -1 });
          await say(token, game.intro);
          for (const { i } of todo) await runItem(token, g, i);
          if (g < p.games.length - 1 && game.kind !== "sparkle" && game.kind !== "breathe") {
            setBurst((b) => b + 1);
            if (g === 0) await real(token, "well_done", `Well done, ${call}.`);
            else await say(token, "Lovely. On to the next one.");
          }
        }

        setPhase("closing");
        cursorRef.current = null;
        setCursor(null);
        setBurst((b) => b + 1);
        await say(token, p.closing);
        await captureMemory(token);
        await real(token, "love_you", `See you tomorrow, ${call}.`);
        setPhase("rest");
        // The AI sets the new baseline and makes tomorrow's games.
        void sendReliably(`/api/companion/plan/${p.id}/complete`, {}).catch(() => undefined);
        setPlan((x) => (x ? { ...x, status: "done" } : x));
      } catch (err) {
        if (!(err instanceof Stopped)) console.warn("[companion]", err);
      }
    },
    [call, captureMemory, companion, ensure, real, router, runItem, say],
  );

  // Once there is a plan, wake up: by ourselves if the browser allows it, otherwise on the first touch.
  const woke = useRef(false);
  useEffect(() => {
    if (!plan || !bundle || woke.current) return;
    woke.current = true;
    if (plan.status === "done") {
      queueMicrotask(() => setPhase("rest"));
      return;
    }
    if (engine.isActive) {
      void direct(plan, played);
      return;
    }
    void engine.canStartWithoutTap(bundle.config.tts).then((ok) => {
      if (!mounted.current) return;
      if (ok) {
        void engine.start({ silent: true });
        void direct(plan, played);
      } else {
        setPhase("wake");
      }
    });
  }, [plan, bundle, engine, direct, played]);

  const wake = () => {
    unlockChime();
    engine.unlockAudio();
    const p = planRef.current;
    if (!engine.isActive) void engine.start({ silent: true });
    if (phase === "wake" && p) void direct(p, played);
    if (phase === "rest") void restTalk();
  };

  // At rest: touching the face tells a story from their life, in the family's voice.
  const restStory = useRef(0);
  const restTalk = async () => {
    const token = ++runToken.current;
    try {
      if (!engine.isActive) await engine.start({ silent: true });
      const pool = memories.filter((m) => m.detail);
      if (!pool.length) {
        await say(token, `Hello ${call}. We've played our games today. I'll see you tomorrow.`);
        return;
      }
      const m = pool[restStory.current++ % pool.length];
      if (m.clip && (m.clip.durationMs ?? 0) < 70_000 && restStory.current % 2 === 0) {
        await say(token, `${m.clip.by ?? companion?.name ?? "Your family"} told me about this.`);
        await engine.playClip(m.clip.url);
      } else {
        await say(token, m.detail);
      }
    } catch {
      // stopped
    }
  };

  // The voice was switched off mid-game ("I'm done"): rest, and carry on when touched.
  const voiceOff = !snap.active && (phase === "playing" || phase === "talking" || phase === "closing");

  // ---- family corner: press and hold ------------------------------------------------
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [holding, setHolding] = useState(false);
  const startHold = () => {
    setHolding(true);
    holdTimer.current = setTimeout(() => router.push("/family"), 1200);
  };
  const endHold = () => {
    setHolding(false);
    if (holdTimer.current) clearTimeout(holdTimer.current);
  };

  // ---- layout ------------------------------------------------------------------------
  const big = phase !== "playing" || !current;
  const caption = snap.agentLine;
  const showCaption = caption && !(current && caption === current.item.prompt);
  const kind = current?.game.kind;
  const scored = current ? isScored(stage, current.game.kind) : false;
  const tapOnly = snap.recognition === "unsupported" || snap.mic === "denied";
  const now = new Date();

  if (!bundle || (bundle && !bundle.onboarded)) {
    return (
      <div className="night flex items-center justify-center">
        <NightSky />
        {loadError && <p className="relative z-10 p-6 text-center text-xl">Couldn&apos;t connect. Please check the internet and try again.</p>}
      </div>
    );
  }

  return (
    <div className="night">
      <NightSky />
      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-4 safe-top safe-bottom">
        {/* Top: today's progress (not buttons), pause, and the family corner (press and hold). */}
        <header className="flex h-14 items-center justify-between">
          <button type="button" onClick={() => engine.pause()} className="flex size-11 items-center justify-center rounded-full bg-white/8 text-ivory-200/70" aria-label="Pause">
            <PauseIcon size={18} />
          </button>
          {plan && (
            <ol className="flex items-center gap-2" aria-label="Today's games">
              {plan.games.map((g, i) => (
                <li
                  key={g.id}
                  className={`h-2.5 rounded-full transition-all duration-500 ${cursor && i === cursor.g && phase === "playing" ? "w-8 bg-gold-300" : (cursor && i < cursor.g) || phase === "closing" || phase === "rest" ? "w-2.5 bg-gold-400/80" : "w-2.5 bg-white/20"}`}
                  aria-label={g.title}
                />
              ))}
            </ol>
          )}
          <button
            type="button"
            onPointerDown={startHold}
            onPointerUp={endHold}
            onPointerLeave={endHold}
            onContextMenu={(e) => e.preventDefault()}
            className={`relative flex size-11 items-center justify-center rounded-full text-ivory-200/60 transition-colors ${holding ? "bg-gold-400/30" : "bg-white/8"}`}
            aria-label="Family corner: press and hold"
          >
            <UsersIcon size={18} />
          </button>
        </header>

        {/* The companion. */}
        <section className={`flex flex-col items-center text-center transition-all duration-700 ${big ? "flex-1 justify-center gap-5" : "gap-2 pt-1"}`}>
          <button
            type="button"
            onClick={phase === "rest" || phase === "wake" || voiceOff ? wake : undefined}
            className={`transition-all duration-700 ease-out ${big ? "w-[68vw] max-w-[20rem]" : "w-28 md:w-36"}`}
            aria-label={companion?.name ?? "Companion"}
            tabIndex={phase === "rest" || phase === "wake" ? 0 : -1}
          >
            <Avatar src={companion?.avatarUrl} name={companion?.name ?? ""} speaking={snap.status === "speaking"} listening={snap.status === "listening" && !locked} level={() => engine.outputLevel()} />
          </button>

          {big && companion && (
            <p className="text-lg font-bold text-ivory-200">
              {companion.name} <span className="text-ivory-200/60">· your {companion.relation.toLowerCase()}</span>
            </p>
          )}

          {phase === "wake" || voiceOff ? (
            <div className="flex flex-col items-center gap-3">
              <h1 className="text-glow text-[2.1rem] font-bold leading-tight">
                {greetingWord(now.getHours())}, {call}
              </h1>
              <p className="glass glow-pulse flex items-center gap-2 rounded-full px-6 py-3 text-xl font-bold text-gold-200">Touch to say hello</p>
            </div>
          ) : phase === "loading" ? (
            <p className="text-xl text-ivory-200">{planError ? "I'm having trouble getting today's games. Let's try again in a moment." : `Getting today ready for you, ${call}…`}</p>
          ) : (
            <div className={big ? "min-h-28 px-2" : "min-h-10 px-2"}>{showCaption && <Caption text={caption} size={big ? "xl" : "md"} />}</div>
          )}

          {phase === "rest" && !snap.agentLine && (
            <p className="text-lg text-ivory-200">Touch my picture to hear a story.</p>
          )}
        </section>

        {/* The game. */}
        {phase === "playing" && currentGame && (
          <section className="flex flex-1 flex-col items-center gap-4 pb-6 pt-3">
            {!current ? (
              <div className="glass mt-6 w-full rounded-[2rem] px-6 py-8 text-center animate-pop">
                <p className="text-sm font-bold text-gold-300">{KIND_LABEL[currentGame.kind]}</p>
                <h2 className="gold-text mt-1 text-4xl font-bold leading-tight">{currentGame.title}</h2>
              </div>
            ) : kind === "sparkle" ? (
              <SparkleGame
                key={current.item.id}
                onTouch={() => {
                  const t = trackRef.current;
                  t.attempts++;
                  if (!t.firstAt) t.firstAt = Date.now();
                  idleItems.current = 0;
                }}
                onDone={() => calmDone.current?.()}
              />
            ) : kind === "breathe" ? (
              <BreatheGame key={current.item.id} onPhase={(ph) => void engine.say(ph === "in" ? "Breathe in, slowly." : "And out.")} onDone={() => calmDone.current?.()} />
            ) : kind === "reminisce" ? (
              <div key={current.item.id} className="flex w-full flex-col items-center gap-4">
                {current.item.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={current.item.imageUrl} alt="" className="photo-float aspect-[4/3] max-h-[40dvh] w-full max-w-md rounded-[2rem] object-cover animate-from-ahead" />
                )}
                <h2 className="text-glow text-center text-[1.7rem] font-bold leading-tight">{current.item.prompt}</h2>
                {showNext && (
                  <button
                    type="button"
                    onClick={() => engine.tap("share")}
                    className="glass min-h-16 rounded-full px-8 text-xl font-bold text-ivory-50 active:scale-[0.98]"
                  >
                    Next
                  </button>
                )}
              </div>
            ) : (
              <ChoiceCard
                key={current.item.id}
                item={current.item}
                states={states}
                order={current.item.order ? seq : null}
                locked={locked}
                onChoose={(c: GameChoice) => void engine.tap("choose", c.id)}
              />
            )}
            {current && scored && !locked && kind !== "sparkle" && kind !== "breathe" && kind !== "reminisce" && (
              <button type="button" onClick={() => void engine.tap("hint")} className="min-h-12 px-4 text-lg font-bold text-ivory-200/80 underline underline-offset-4">
                Give me a clue
              </button>
            )}
          </section>
        )}

        {/* How to answer, quietly. */}
        {snap.active && phase !== "rest" && (
          <footer className="flex justify-center pb-3">
            <span className="flex items-center gap-2 rounded-full bg-white/8 px-4 py-2 text-sm font-bold text-ivory-200/80" role="status">
              {tapOnly ? <MicOffIcon size={16} /> : <MicIcon size={16} />}
              {snap.status === "speaking" ? `${companion?.name ?? "I"} is talking` : snap.status === "thinking" ? "One moment" : tapOnly ? "Touch your answer" : "Say it or touch it"}
            </span>
          </footer>
        )}
      </div>

      {(phase === "wake" || voiceOff) && <button type="button" onClick={wake} className="fixed inset-0 z-20" aria-label="Start" />}
      <Confetti burst={burst} />
    </div>
  );
}
