"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Avatar } from "@/components/companion/Avatar";
import { RecordPanel } from "@/components/onboarding/RecordPanel";
import { Spinner } from "@/components/ui";
import { ImageIcon, RefreshIcon, SparkleIcon, TrashIcon } from "@/components/icons";
import { shrinkImage } from "@/lib/client/api";
import { KIND_LABEL, STAGE_LABEL, toScale, type Baseline, type DayMetrics, type GameKind, type Memory } from "@/lib/shared/companion";

interface Progress {
  history: (Baseline & { metrics: DayMetrics | null; focus: string | null })[];
  plans: { id: string; day: string; stage: Baseline["stage"]; level: number; status: string; source: string; games: { kind: GameKind; title: string; items: number }[] }[];
  planning: boolean;
  aiSpendThisSession: number;
}

const TREND: Record<Baseline["trend"], { label: string; cls: string }> = {
  first: { label: "Starting point", cls: "bg-[#ede9fe] text-[#5b21b6]" },
  steadier: { label: "A little more challenge", cls: "bg-[#dcfce7] text-[#166534]" },
  steady: { label: "Staying the same", cls: "bg-[#e0e7ff] text-[#3730a3]" },
  needs_more_support: { label: "More support", cls: "bg-[#fce7f3] text-[#9d174d]" },
};

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

/**
 * The family's view of the companion: who it is, today's baseline and the
 * AI's note, today's games, the life story, and adding a memory by voice.
 */
export function CompanionPanel() {
  const { bundle, reload } = useApp();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const [p, m] = await Promise.all([
      fetch("/api/companion/progress", { cache: "no-store" }).then((r) => r.json() as Promise<Progress>),
      fetch("/api/memories", { cache: "no-store" }).then((r) => r.json() as Promise<{ memories: Memory[] }>),
    ]).catch(() => [null, null] as const);
    if (p) setProgress(p);
    if (m) setMemories(m.memories ?? []);
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 8000);
    return () => clearInterval(t);
  }, [load]);

  if (!bundle) return null;
  const call = bundle.player.familyName || bundle.player.name;
  const c = bundle.companion;

  if (!bundle.onboarded || !c) {
    return (
      <section className="sky glass mb-8 rounded-[2rem] p-6 text-center">
        <p className="text-sm font-bold text-gold-200">The companion</p>
        <h2 className="mt-1 text-2xl font-bold">Set up {call}&apos;s companion</h2>
        <p className="mt-2 text-lg text-ivory-200">Tell their story by voice, add your photo, and their daily games are made for them.</p>
        <Link href="/onboarding" className="mt-4 inline-flex min-h-14 items-center rounded-2xl bg-gold-400 px-6 text-lg font-bold text-navy-950 shadow-gold">
          Begin setup
        </Link>
      </section>
    );
  }

  const latest = progress?.history[0] ?? bundle.baseline;
  const today = progress?.plans[0] ?? null;
  const scale = progress ? [...progress.history].reverse().slice(-14) : [];

  const newGames = async () => {
    setBusy("games");
    setMessage(null);
    try {
      const res = await fetch("/api/companion/new-games", { method: "POST" });
      if (!res.ok) throw new Error();
      await load();
      setMessage("New games are ready. They'll start next time the app opens.");
    } catch {
      setMessage("Couldn't make new games just now.");
    } finally {
      setBusy(null);
    }
  };

  const startOver = async () => {
    if (!window.confirm(`Start ${call}'s companion over? The life story, recordings, baselines and games are removed, and setup begins again.`)) return;
    setBusy("reset");
    try {
      await fetch("/api/companion/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: "start-over" }) });
      await reload();
      window.location.href = "/onboarding";
    } finally {
      setBusy(null);
    }
  };

  const addMemory = async (audio: Blob | null, durationMs = 0) => {
    const form = new FormData();
    form.append("source", "family");
    form.append("by", c.name);
    if (text.trim()) form.append("text", text.trim());
    if (audio) {
      form.append("audio", audio, "memory.wav");
      if (durationMs) form.append("durationMs", String(durationMs));
    }
    if (photo) form.append("photo", await shrinkImage(photo, 1600, 0.88), "photo.jpg");
    const res = await fetch("/api/memories", { method: "POST", body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error ?? "Couldn't add that memory");
    setText("");
    setPhoto(null);
    setAdding(false);
    setMessage(`Added: ${(data as { memories: Memory[] }).memories.map((m) => m.title).join(", ")}. It will appear in tomorrow's games.`);
    await load();
  };

  const remove = async (m: Memory) => {
    if (!window.confirm(`Take "${m.title}" out of the games?`)) return;
    await fetch(`/api/memories/${m.id}`, { method: "DELETE" });
    await load();
  };

  return (
    <div className="sky mb-8 flex flex-col gap-5">
      {/* The companion */}
      <section className="glass flex items-center gap-4 rounded-[2rem] p-4">
        <div className="w-24 shrink-0">
          <Avatar src={c.avatarUrl} name={c.name} speaking={false} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-gold-200">{call}&apos;s companion</p>
          <p className="text-2xl font-bold leading-tight">
            {c.name} <span className="text-lg text-ivory-200">· {c.relation}</span>
          </p>
          {c.voice.summary && (
            <p className="mt-1 line-clamp-2 text-sm text-ivory-200">
              {c.voice.cloned ? "Cloned voice" : "Matched voice"}: {c.voice.summary}
            </p>
          )}
          <p className="mt-1 text-sm text-ivory-200">{Object.keys(c.lines).length} lines in {c.name}&apos;s real voice</p>
        </div>
      </section>

      {/* Today's baseline */}
      {latest && (
        <section className="glass rounded-[2rem] p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-bold text-gold-200">Baseline for the next games</p>
            <span className={`rounded-full px-3 py-1 text-sm font-bold ${TREND[latest.trend].cls}`}>{TREND[latest.trend].label}</span>
          </div>
          <p className="mt-1 text-3xl font-bold">
            {STAGE_LABEL[latest.stage]} <span className="text-ivory-200">· level {latest.level} of 5</span>
          </p>
          {/* Where they are on the 15 steps from late (most support) to early (asks the most). */}
          <div className="mt-3 flex items-center gap-1" aria-hidden="true">
            {Array.from({ length: 15 }, (_, i) => i + 1).map((n) => (
              <span
                key={n}
                className={`h-2.5 flex-1 rounded-full ${n === toScale(latest.stage, latest.level) ? "bg-gold-400 shadow-gold" : n < toScale(latest.stage, latest.level) ? "bg-[#c4b5fd]" : "bg-[#ede9fe]"} ${n === 5 || n === 10 ? "mr-1.5" : ""}`}
              />
            ))}
          </div>
          <div className="mt-1 flex justify-between text-xs font-bold text-ivory-200">
            <span>Late</span>
            <span>Middle</span>
            <span>Early</span>
          </div>
          {latest.familyNote && <p className="mt-4 text-lg leading-relaxed">{latest.familyNote}</p>}
          <p className="mt-2 text-base leading-relaxed text-ivory-200">{latest.reason}</p>
          {scale.length > 1 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-base font-bold text-gold-200">How it has changed</summary>
              <ul className="mt-2 flex flex-col gap-1.5">
                {[...scale].reverse().map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/5 px-3 py-2 text-base">
                    <span>{day(b.createdAt)}</span>
                    <span className="font-bold">
                      {STAGE_LABEL[b.stage]} · L{b.level}
                    </span>
                    <span className="text-sm text-ivory-200">{b.decidedBy === "ai" ? "AI" : b.decidedBy === "onboarding" ? "Setup" : "Rule"}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {/* Today's games */}
      <section className="glass rounded-[2rem] p-5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-bold text-gold-200">{today ? `Games for ${new Date(today.day + "T12:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}` : "Today's games"}</p>
          {today && <span className="text-sm font-bold text-ivory-200">{today.status === "done" ? "Played" : today.status === "playing" ? "In progress" : "Ready"}</span>}
        </div>
        {today ? (
          <ul className="mt-3 flex flex-col gap-2">
            {today.games.map((g) => (
              <li key={g.title} className="flex items-center gap-3 rounded-2xl bg-white/5 px-3 py-2.5">
                <SparkleIcon size={18} className="shrink-0 text-gold-300" />
                <span className="min-w-0 flex-1">
                  <span className="block text-lg font-bold leading-tight">{g.title}</span>
                  <span className="block text-sm text-ivory-200">
                    {KIND_LABEL[g.kind]} · {g.items} {g.items === 1 ? "item" : "items"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-base text-ivory-200">{progress?.planning ? "Making today's games…" : "Games are made when the app opens."}</p>
        )}
        <button
          type="button"
          onClick={() => void newGames()}
          disabled={!!busy}
          className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-white/25 text-base font-bold text-gold-200 disabled:opacity-50"
        >
          {busy === "games" ? <Spinner className="size-4" /> : <RefreshIcon size={18} />} Make new games now
        </button>
      </section>

      {message && <p className="rounded-2xl bg-[#ede9fe] px-4 py-3 text-base font-bold text-[#5b21b6]">{message}</p>}

      {/* The life story */}
      <section className="glass rounded-[2rem] p-5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-bold text-gold-200">
            {call}&apos;s life story · {memories.filter((m) => m.kind !== "gentle").length} memories
          </p>
          {!adding && (
            <button type="button" onClick={() => setAdding(true)} className="min-h-11 rounded-full bg-gold-400 px-4 text-base font-bold text-navy-950 shadow-gold">
              Add a memory
            </button>
          )}
        </div>

        {adding && (
          <div className="mt-4 flex flex-col gap-3 rounded-[1.6rem] bg-white/5 p-4">
            <p className="text-lg font-bold">Tell me something from {call}&apos;s life</p>
            <p className="text-base text-ivory-200">A story, a person, a favourite thing. Talk, or write it, and add a photo if you have one.</p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              placeholder="Optional: write it here…"
              className="w-full rounded-2xl border border-white/20 bg-[#fff] p-3 text-lg text-ivory-50 placeholder:text-ivory-200/60 focus:border-gold-300 focus:outline-none"
            />
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => photoRef.current?.click()} className="flex min-h-11 items-center gap-2 rounded-full border border-white/25 px-4 text-base font-bold text-gold-200">
                <ImageIcon size={18} /> {photo ? "Photo added" : "Add a photo"}
              </button>
              <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
            </div>
            <RecordPanel compact onRecorded={(wav, ms) => addMemory(wav, ms)} onTyped={undefined} allowType={false} recordLabel="Tell it by voice" busyLabel="Adding the memory…" />
            {text.trim() && (
              <button type="button" onClick={() => void addMemory(null).catch((e) => setMessage((e as Error).message))} className="min-h-12 rounded-2xl bg-gold-400 text-lg font-bold text-navy-950">
                Add what I wrote
              </button>
            )}
            <button type="button" onClick={() => setAdding(false)} className="min-h-11 text-base font-bold text-ivory-200 underline underline-offset-4">
              Cancel
            </button>
          </div>
        )}

        <ul className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
          {memories
            .filter((m) => m.kind !== "gentle")
            .map((m) => (
              <li key={m.id} className="group relative overflow-hidden rounded-2xl border border-white/15 bg-[#fff]">
                <div className={`aspect-[4/3] w-full bg-[#f3edff] ${m.artStatus === "working" && !m.photo ? "shimmer" : ""}`}>
                  {(m.photo || m.art) && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={(m.photo ?? m.art)!.url} alt="" className="h-full w-full object-cover" />
                  )}
                </div>
                <div className="px-3 py-2">
                  <p className="truncate text-base font-bold">{m.title}</p>
                  <p className="truncate text-xs text-ivory-200">
                    {m.source === "patient" ? `Told by ${call}` : m.addedBy ? `From ${m.addedBy}` : "From the interview"}
                  </p>
                </div>
                <button type="button" onClick={() => void remove(m)} className="absolute right-2 top-2 flex size-9 items-center justify-center rounded-full bg-[#fff]/90 text-ivory-200 opacity-80" aria-label={`Remove ${m.title}`}>
                  <TrashIcon size={16} />
                </button>
              </li>
            ))}
        </ul>
        {memories.some((m) => m.kind === "gentle") && (
          <p className="mt-3 text-sm text-ivory-200">The games also steer clear of: {memories.filter((m) => m.kind === "gentle").map((m) => m.title.toLowerCase()).join("; ")}.</p>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-base font-bold text-gold-200">
        <Link href="/doctor" className="underline underline-offset-4">
          Doctor&apos;s QR card
        </Link>
        <Link href="/onboarding" className="underline underline-offset-4">
          Setup answers
        </Link>
        <button type="button" onClick={() => void startOver()} disabled={!!busy} className="flex items-center gap-1 text-[#9d174d] underline underline-offset-4">
          <TrashIcon size={16} /> Start over
        </button>
      </div>
    </div>
  );
}
