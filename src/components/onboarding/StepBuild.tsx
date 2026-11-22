"use client";

import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/companion/Avatar";
import { Caption } from "@/components/companion/Caption";
import { CheckIcon, CloseIcon } from "@/components/icons";
import { Spinner } from "@/components/ui";
import type { BuildStatus } from "@/lib/server/companion";
import type { Companion, Memory } from "@/lib/shared/companion";
import type { Bundle } from "@/lib/shared/types";
import { GoldButton, type StepProps } from "./shared";

/**
 * Everything the family gave us becomes the player's world: the life story,
 * the matched voice, a painting for each memory and the first day's games.
 * Ends by introducing the companion, in the family member's real voice.
 */
export function StepBuild({ state, guide }: StepProps) {
  const call = state.player.callName;
  const [build, setBuild] = useState<BuildStatus | null>(state.build);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [companion, setCompanion] = useState<Companion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const revealed = useRef(false);

  // Start (or restart after an interruption), then follow along.
  useEffect(() => {
    let stop = false;
    const go = async () => {
      if (!started.current) {
        started.current = true;
        void guide.say(`Thank you. I'm building ${call}'s world now: the life story, your voice and a painting for each memory. It takes a minute or two.`);
        if (!state.build || (state.build.done && state.build.error)) {
          const res = await fetch("/api/onboarding/build", { method: "POST" });
          const data = await res.json().catch(() => null);
          if (!res.ok) setError((data as { error?: string })?.error ?? "Couldn't start");
          else setBuild(data as BuildStatus);
        }
      }
      while (!stop) {
        try {
          const [b, m] = await Promise.all([
            fetch("/api/onboarding/build", { cache: "no-store" }).then((r) => r.json() as Promise<BuildStatus | null>),
            fetch("/api/memories", { cache: "no-store" }).then((r) => r.json() as Promise<{ memories: Memory[] }>),
          ]);
          if (stop) return;
          if (b) setBuild(b);
          setMemories(m.memories ?? []);
          if (b?.done) return;
        } catch {
          // keep trying
        }
        await new Promise((r) => setTimeout(r, 2500));
      }
    };
    void go();
    return () => {
      stop = true;
    };
  }, [call, guide, state.build]);

  // When it's ready: meet the companion.
  useEffect(() => {
    if (!build?.done || revealed.current) return;
    revealed.current = true;
    void (async () => {
      const bundle = (await fetch("/api/bundle", { cache: "no-store" }).then((r) => r.json())) as Bundle;
      const c = bundle.companion;
      setCompanion(c);
      const mem = await fetch("/api/memories", { cache: "no-store" }).then((r) => r.json() as Promise<{ memories: Memory[] }>);
      setMemories(mem.memories ?? []);
      if (c?.lines.hello) await guide.playClip(c.lines.hello.url);
      await guide.say(`Everything is ready. From now on, when ${call} opens the app, ${c?.name ?? "I"} will be right here, with today's games.`);
    })();
  }, [build?.done, call, guide]);

  const painted = memories.filter((m) => m.art || m.photo);
  const done = build?.done && companion;

  return (
    <div className="flex flex-col items-center gap-6">
      {done ? (
        <>
          <p className="text-sm font-bold tracking-wide text-gold-300">All set</p>
          <h1 className="text-center text-[2rem] font-bold leading-tight md:text-4xl">
            Meet <span className="gold-text">{call}&apos;s companion</span>
          </h1>
          <div className="w-64 md:w-72">
            <Avatar src={companion.avatarUrl} name={companion.name} speaking={guide.speaking} level={guide.level} />
          </div>
          <p className="text-2xl font-bold">
            {companion.name} <span className="text-ivory-200">· {companion.relation}</span>
          </p>
          <div className="min-h-16 text-center">
            <Caption text={guide.line} size="md" />
          </div>
          {companion.voice.summary && (
            <p className="glass rounded-2xl px-4 py-3 text-center text-base text-ivory-200">
              <span className="font-bold text-gold-200">{companion.voice.cloned ? "Your cloned voice" : "Your matched voice"}:</span> {companion.voice.summary}
            </p>
          )}
          <div className="flex w-full flex-col gap-3">
            <GoldButton onClick={() => (window.location.href = "/")}>Start {call}&apos;s games</GoldButton>
            <a href="/family" className="min-h-12 text-center text-lg font-bold text-ivory-200 underline underline-offset-4">
              Go to the family corner
            </a>
          </div>
        </>
      ) : (
        <>
          <div className="w-44 md:w-52">
            <Avatar src={null} name="Your guide" speaking={guide.speaking} level={guide.level} />
          </div>
          <h1 className="text-center text-[2rem] font-bold leading-tight md:text-4xl">Building {call}&apos;s world</h1>
          <ul className="glass flex w-full flex-col gap-1 rounded-[2rem] p-4">
            {(build?.steps ?? []).map((s) => (
              <li key={s.key} className="flex items-center gap-3 rounded-2xl px-2 py-2.5">
                <span
                  className={`flex size-9 shrink-0 items-center justify-center rounded-full ${
                    s.status === "done" ? "bg-gold-400 text-navy-950" : s.status === "failed" ? "bg-white/10 text-ivory-200" : s.status === "working" ? "bg-gold-400/20 text-gold-200" : "bg-white/5 text-ivory-200/50"
                  }`}
                >
                  {s.status === "done" ? <CheckIcon size={18} /> : s.status === "failed" ? <CloseIcon size={16} /> : s.status === "working" ? <Spinner className="size-4" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-lg font-bold ${s.status === "waiting" ? "text-ivory-200/60" : "text-ivory-50"}`}>{s.label}</span>
                  {s.detail && <span className="block truncate text-sm text-ivory-200">{s.detail}</span>}
                </span>
              </li>
            ))}
            {!build && !error && (
              <li className="flex items-center gap-3 p-3 text-lg">
                <Spinner /> Starting…
              </li>
            )}
          </ul>
          {error && <p className="text-center text-lg font-bold text-gold-200">{error}</p>}
        </>
      )}

      {memories.length > 0 && (
        <section className="w-full">
          <h2 className="mb-3 text-center text-base font-bold text-ivory-200">
            {memories.length} memories · {painted.length} painted
          </h2>
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {memories
              .filter((m) => m.kind !== "gentle")
              .map((m, i) => (
                <li key={m.id} className="animate-pop overflow-hidden rounded-2xl border border-white/12 bg-white/5" style={{ animationDelay: `${(i % 6) * 60}ms` }}>
                  <div className={`aspect-[4/3] w-full bg-navy-800 ${m.artStatus === "working" && !m.photo ? "shimmer" : ""}`}>
                    {(m.photo || m.art) && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={(m.photo ?? m.art)!.url} alt="" className="h-full w-full object-cover" />
                    )}
                  </div>
                  <p className="truncate px-3 py-2 text-sm font-bold text-ivory-100">{m.title}</p>
                </li>
              ))}
          </ul>
        </section>
      )}
    </div>
  );
}
