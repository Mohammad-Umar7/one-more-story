"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { FamilyShell, Section } from "@/components/family/FamilyShell";
import { AlertCard } from "@/components/family/AlertCard";
import { HelpSummary } from "@/components/family/HelpSummary";
import { Button, Spinner } from "@/components/ui";
import { BellIcon, BookIcon, CheckIcon, ChevronRightIcon, HomeIcon, ImageIcon, MapIcon, RefreshIcon, TrashIcon, UsersIcon } from "@/components/icons";
import { getJson, sendJson } from "@/lib/client/api";
import type { AlertView, MemorySessionView } from "@/lib/shared/types";

interface History {
  sessions: MemorySessionView[];
  pattern: { state: string; baseline: number | null; threshold: number | null; needed: number; streak: number };
}
interface Story {
  id: string;
  createdAt: string;
  photo: { id: string; title: string; url: string };
  clips: { id: string; url: string; prompt: string | null; transcript: string | null; durationMs: number | null }[];
}
interface TourSummary {
  id: string;
  status: string;
  startedAt: string;
  noteCount: number;
  path: string[];
}

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

const SETUP = [
  { href: "/family/setup/people", label: "People & alerts", hint: "Who gets alerts", Icon: UsersIcon },
  { href: "/family/setup/room", label: "Memory Room", hint: "Room, things, clues", Icon: HomeIcon },
  { href: "/family/setup/photos", label: "Story photos", hint: "Family photos", Icon: ImageIcon },
  { href: "/family/setup/street", label: "Street walk", hint: "Photos and paths", Icon: MapIcon },
];

export default function FamilyHome() {
  const { bundle, reload } = useApp();
  const [alerts, setAlerts] = useState<AlertView[] | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [stories, setStories] = useState<Story[]>([]);
  const [tours, setTours] = useState<TourSummary[]>([]);
  const [resetting, setResetting] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [a, h, s, t] = await Promise.all([
      getJson<{ alerts: AlertView[] }>("/api/alerts"),
      getJson<History>("/api/memory/history"),
      getJson<{ stories: Story[] }>("/api/stories"),
      getJson<{ tours: TourSummary[] }>("/api/tours"),
    ]).catch(() => [null, null, null, null] as const);
    if (a) setAlerts(a.alerts);
    if (h) setHistory(h);
    if (s) setStories(s.stories);
    if (t) setTours(t.tours);
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => {
      void load();
      void reload(); // picks up a caregiver phone being paired
    }, 5000);
    return () => clearInterval(t);
  }, [load, reload]);

  async function reset(scope: "history" | "all" | "fresh") {
    const msg =
      scope === "all"
        ? "Restore all demo content? Saved stories and walks will be removed. Paired phones are kept."
        : scope === "fresh"
          ? "Start fresh for a real person? All Memory Room rounds and alerts are cleared. Their usual level is then learned from their own first five rounds."
          : "Reset the Memory Room history to the demo (1, 0, 1, 2, 1 then 3, 3) and clear alerts?";
    if (!window.confirm(msg)) return;
    setResetting(scope);
    try {
      await sendJson("/api/demo/reset", { scope });
      await load();
    } finally {
      setResetting(null);
    }
  }

  async function deleteStory(id: string) {
    if (!window.confirm("Delete this saved story? This can't be undone.")) return;
    await fetch(`/api/stories/${id}`, { method: "DELETE" });
    await load();
  }

  if (!bundle) {
    return (
      <FamilyShell>
        <Spinner />
      </FamilyShell>
    );
  }

  const { player } = bundle;
  const familyName = player.familyName;
  const recipient = bundle.caregivers.find((c) => c.id === player.alertCaregiverId) ?? null;
  const unseen = (alerts ?? []).filter((a) => !a.seenAt);
  const earlier = (alerts ?? []).filter((a) => a.seenAt);
  const needsCheck = unseen.length > 0;
  const subj = player.pronoun === "she" ? "she" : player.pronoun === "they" ? "they" : "he";
  const poss = player.pronoun === "she" ? "her" : player.pronoun === "they" ? "their" : "his";
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

  return (
    <FamilyShell>
      {/* How things are, in one glance */}
      <section className={`rounded-[1.75rem] p-5 shadow-card ${needsCheck ? "bg-gold-100" : "bg-navy-900 text-ivory-50"}`}>
        <div className="flex items-center gap-3">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-gold-400 font-display text-2xl font-bold text-navy-950">
            {player.name.charAt(0)}
          </span>
          <div>
            <p className={`text-sm font-bold ${needsCheck ? "text-gold-700" : "text-gold-300"}`}>
              {player.name} · {familyName}
            </p>
            <h1 className="font-display text-[1.75rem] font-bold leading-tight">
              {needsCheck ? `${familyName} may need a little more help` : `All is well with ${familyName}`}
            </h1>
          </div>
        </div>
        <p className={`mt-3 text-lg ${needsCheck ? "text-navy-800" : "text-ivory-100"}`}>
          {needsCheck
            ? `${cap(subj)} asked for more clues than usual in ${poss} last three rounds of My Memory Room.`
            : "Nothing needs your attention right now."}
        </p>
        <Link
          href="/family/setup/people"
          className={`mt-4 flex items-center gap-3 rounded-2xl px-4 py-3 text-base font-bold ${needsCheck ? "bg-white text-navy-800" : "bg-navy-800 text-ivory-50"}`}
        >
          {recipient && recipient.deviceCount > 0 ? (
            <CheckIcon size={20} className="shrink-0 text-gold-400" />
          ) : (
            <BellIcon size={20} className="shrink-0 text-gold-400" />
          )}
          <span className="flex-1">
            {!recipient
              ? "Choose who gets alerts"
              : recipient.deviceCount > 0
                ? `Alerts go to ${recipient.name}'s phone`
                : `Set up ${recipient.name}'s phone for alerts`}
          </span>
          <ChevronRightIcon size={20} className="shrink-0" />
        </Link>
      </section>

      {unseen.length > 0 && (
        <div className="mt-6 flex flex-col gap-4">
          {unseen.map((a) => (
            <AlertCard key={a.id} alert={a} familyName={familyName} highlight onChange={() => void load()} />
          ))}
        </div>
      )}

      <div className="mt-8">
        <Section title="My Memory Room">
          <div className="rounded-3xl bg-white p-5 shadow-card">
            {history ? (
              <>
                <HelpSummary history={history} familyName={familyName} recipient={recipient?.name ?? null} />
                <details className="mt-4 rounded-2xl bg-ivory-100 px-4 py-3">
                  <summary className="cursor-pointer text-base font-bold text-navy-700">How alerts work</summary>
                  <ul className="mt-3 list-disc space-y-1.5 pl-5 text-base text-navy-700">
                    <li>We count each time {familyName} plays a clue in My Memory Room.</li>
                    <li>{cap(poss)} usual number comes from {poss} first five full rounds.</li>
                    <li>If three rounds in a row each need at least two more clues than usual, {recipient?.name ?? "your trusted person"} gets one alert. Never twice for the same run.</li>
                    <li>Rounds stopped early, or with a microphone or sound problem, are left out.</li>
                    <li>It shows a change in one game. It is not a medical assessment.</li>
                  </ul>
                </details>
              </>
            ) : (
              <Spinner />
            )}
          </div>
        </Section>

        <Section title="Memories">
          {stories.length === 0 && tours.length === 0 ? (
            <p className="rounded-3xl bg-white p-5 text-lg text-navy-700 shadow-card">
              Stories {familyName} saves, and walks {subj} guides, will appear here for you to listen to.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {tours.map((t) => (
                <li key={t.id}>
                  <Link href={`/family/tours/${t.id}`} className="flex items-center gap-4 rounded-3xl bg-white p-3 pr-4 shadow-card">
                    <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-gold-100 text-gold-700">
                      <MapIcon size={28} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-lg font-bold">A walk down the street</span>
                      <span className="block truncate text-base text-navy-700">{t.path.join(" → ")}</span>
                      <span className="block text-sm text-navy-500">
                        {day(t.startedAt)}
                        {t.noteCount ? ` · ${t.noteCount} recording${t.noteCount === 1 ? "" : "s"}` : ""}
                      </span>
                    </span>
                    <ChevronRightIcon size={22} className="shrink-0 text-gold-500" />
                  </Link>
                </li>
              ))}
              {stories.map((s) => (
                <li key={s.id}>
                  <details className="group rounded-3xl bg-white shadow-card">
                    <summary className="flex cursor-pointer list-none items-center gap-4 p-3 pr-4">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s.photo.url} alt="" className="size-14 shrink-0 rounded-2xl object-cover" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-lg font-bold">A story about a photo</span>
                        <span className="block truncate text-base text-navy-700">
                          {s.clips.find((c) => c.transcript)?.transcript ?? s.photo.title}
                        </span>
                        <span className="block text-sm text-navy-500">{day(s.createdAt)}</span>
                      </span>
                      <BookIcon size={22} className="shrink-0 text-gold-500" />
                    </summary>
                    <div className="border-t border-ivory-200 px-4 pb-4 pt-3">
                      {s.clips.map((c) => (
                        <div key={c.id} className="mb-3">
                          <audio controls preload="none" src={c.url} className="w-full" />
                          {c.transcript && <p className="mt-1 text-base text-navy-800">&ldquo;{c.transcript}&rdquo;</p>}
                        </div>
                      ))}
                      <Button variant="danger" size="sm" icon={<TrashIcon size={18} />} onClick={() => void deleteStory(s.id)}>
                        Delete
                      </Button>
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {earlier.length > 0 && (
          <Section title="Earlier alerts">
            <div className="flex flex-col gap-3">
              {earlier.map((a) => (
                <AlertCard key={a.id} alert={a} familyName={familyName} onChange={() => void load()} />
              ))}
            </div>
          </Section>
        )}

        <Section title="Set up">
          <ul className="grid grid-cols-2 gap-3">
            {SETUP.map(({ href, label, hint, Icon }) => (
              <li key={href}>
                <Link href={href} className="flex h-full flex-col gap-2 rounded-3xl bg-white p-4 shadow-card active:scale-[0.99]">
                  <span className="flex size-11 items-center justify-center rounded-2xl bg-navy-100 text-navy-700">
                    <Icon size={24} />
                  </span>
                  <span className="text-lg font-bold leading-tight">{label}</span>
                  <span className="text-sm text-navy-600">{hint}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>

        <details className="rounded-3xl border border-ivory-300 px-4 py-3">
          <summary className="cursor-pointer text-base font-bold text-navy-600">Demo controls</summary>
          <p className="mt-2 text-base text-navy-700">
            Puts the Memory Room back to the demo history, so the next round with 3 clues sends the real alert.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Button variant="gold" size="md" icon={resetting === "history" ? <Spinner /> : <RefreshIcon size={20} />} onClick={() => void reset("history")} disabled={!!resetting}>
              Reset the alert demo
            </Button>
            <Button variant="ivory" size="md" icon={resetting === "all" ? <Spinner /> : <RefreshIcon size={20} />} onClick={() => void reset("all")} disabled={!!resetting}>
              Restore all demo content
            </Button>
          </div>
          <div className="mt-4 rounded-2xl bg-ivory-100 p-4">
            <p className="text-base font-bold text-navy-800">Using it with a real person?</p>
            <p className="mt-1 text-base text-navy-700">
              Start with no history. Nobody shares a default: {poss} usual number is learned from {poss} own first five rounds, and there are no alerts until then.
            </p>
            <Button variant="navy" size="md" className="mt-3" icon={resetting === "fresh" ? <Spinner /> : <RefreshIcon size={20} />} onClick={() => void reset("fresh")} disabled={!!resetting}>
              Start fresh
            </Button>
          </div>
          <Link href="/caregiver" className="mt-3 inline-block text-base font-bold text-navy-600 underline underline-offset-4">
            Open the caregiver phone view
          </Link>
        </details>
      </div>
    </FamilyShell>
  );
}
