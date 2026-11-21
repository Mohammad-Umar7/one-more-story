"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { FamilyShell, Section } from "@/components/family/FamilyShell";
import { AlertCard } from "@/components/family/AlertCard";
import { HelpSummary } from "@/components/family/HelpSummary";
import { Button, Card, Spinner } from "@/components/ui";
import { BellIcon, ChevronRightIcon, MapIcon, PlayIcon, RefreshIcon, TrashIcon } from "@/components/icons";
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
  stepCount: number;
  noteCount: number;
  path: string[];
}

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function FamilyHome() {
  const { bundle } = useApp();
  const [alerts, setAlerts] = useState<AlertView[] | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [stories, setStories] = useState<Story[]>([]);
  const [tours, setTours] = useState<TourSummary[]>([]);
  const [resetting, setResetting] = useState<string | null>(null);
  const familyName = bundle?.player.familyName ?? "your relative";

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
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [load]);

  async function reset(scope: "history" | "all") {
    const msg =
      scope === "all"
        ? "Restore all demo content? Saved stories and tours will be removed. Phone alert settings are kept."
        : "Reset My Memory Room history to the demo baseline (1, 0, 1, 2, 1 then 3, 3)? Alerts will be cleared.";
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

  const recipient = bundle?.caregivers.find((c) => c.id === bundle.player.alertCaregiverId);

  return (
    <FamilyShell title={`How ${familyName} is doing`}>
      <Section
        title="Alerts"
        id="alerts"
        action={
          <Link href="/caregiver" className="flex items-center gap-1 text-base font-bold text-navy-600 underline-offset-4 hover:underline">
            Phone view <ChevronRightIcon size={18} />
          </Link>
        }
      >
        {!recipient && (
          <Card className="mb-3 p-4 text-lg">
            No trusted person chosen yet.{" "}
            <Link className="font-bold text-navy-700 underline" href="/family/setup/people">
              Choose who gets alerts
            </Link>
          </Card>
        )}
        {alerts === null ? (
          <Spinner />
        ) : alerts.length === 0 ? (
          <Card className="flex items-start gap-3 p-5">
            <BellIcon size={26} className="mt-0.5 shrink-0 text-gold-500" />
            <p className="text-lg text-navy-700">
              No alerts. {recipient ? `${recipient.name} will` : "Your trusted person will"} get a notification if {familyName} needs more
              help than usual in My Memory Room for three rounds in a row.
            </p>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {alerts.map((a) => (
              <AlertCard key={a.id} alert={a} familyName={familyName} onChange={() => void load()} />
            ))}
          </div>
        )}
      </Section>

      <Section title="Help in My Memory Room" id="help">
        <Card className="p-5">
          {history ? (
            <>
              <HelpSummary history={history} familyName={familyName} recipient={recipient?.name ?? null} />
              <details className="mt-4 rounded-2xl bg-ivory-100 px-4 py-3">
                <summary className="cursor-pointer text-base font-bold text-navy-700">How this works</summary>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-base text-navy-700">
                  <li>We count each time {familyName} plays a clue in My Memory Room.</li>
                  <li>The usual number comes from the first five full rounds with the same things in the same places.</li>
                  <li>If three rounds in a row each need at least two more clues than usual, one alert is sent. Never twice for the same run.</li>
                  <li>Rounds that were stopped early, or had a microphone or sound problem, are left out.</li>
                  <li>This shows a change in one game. It is not a medical assessment.</li>
                </ul>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[30rem] text-left text-base">
                    <thead className="text-sm text-navy-600">
                      <tr>
                        <th className="py-2 pr-3">When</th>
                        <th className="py-2 pr-3">Clues</th>
                        <th className="py-2 pr-3">Counted as</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.sessions.map((s) => (
                        <tr key={s.id} className="border-t border-ivory-300">
                          <td className="py-2 pr-3">{dateTime(s.endedAt ?? s.startedAt)}</td>
                          <td className="py-2 pr-3 font-bold">{s.status === "in_progress" ? "…" : s.hintCount}</td>
                          <td className="py-2 pr-3 text-navy-700">
                            {s.status === "in_progress"
                              ? "Playing now"
                              : s.excludedReason
                                ? `Left out: ${s.excludedReason}`
                                : s.role === "baseline"
                                  ? "Usual level"
                                  : s.elevated
                                    ? "At the alert level"
                                    : "Compared"}
                            {s.seeded ? " · demo history" : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          ) : (
            <Spinner />
          )}
        </Card>
      </Section>

      <Section title="Saved stories" id="stories">
        {stories.length === 0 ? (
          <Card className="p-5 text-lg text-navy-700">No stories saved yet. They appear here when {familyName} saves one in Tell the Story.</Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {stories.map((s) => (
              <Card key={s.id} className="overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.photo.url} alt={s.photo.title} className="aspect-[16/9] w-full object-cover" />
                <div className="p-4">
                  <p className="text-sm font-bold text-navy-600">
                    {s.photo.title} · {dateTime(s.createdAt)}
                  </p>
                  <ol className="mt-3 space-y-3">
                    {s.clips.map((c, i) => (
                      <li key={c.id}>
                        {c.prompt && i > 0 && <p className="text-sm italic text-navy-600">Asked: “{c.prompt}”</p>}
                        <audio controls preload="none" src={c.url} className="mt-1 w-full" />
                        {c.transcript && <p className="mt-1 text-base text-navy-800">“{c.transcript}”</p>}
                      </li>
                    ))}
                  </ol>
                  <Button variant="danger" size="sm" className="mt-3" icon={<TrashIcon size={18} />} onClick={() => void deleteStory(s.id)}>
                    Delete
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Section>

      <Section title="Street tours" id="tours">
        {tours.length === 0 ? (
          <Card className="p-5 text-lg text-navy-700">No tours yet. When {familyName} guides a walk in Show Me Your Street, you can replay it here.</Card>
        ) : (
          <ul className="grid gap-3">
            {tours.map((t) => (
              <li key={t.id}>
                <Link href={`/family/tours/${t.id}`} className="flex items-center gap-4 rounded-3xl border border-ivory-300 bg-white p-4 shadow-card">
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gold-100 text-gold-700">
                    <MapIcon size={26} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-navy-600">
                      {dateTime(t.startedAt)} · {t.noteCount} recording{t.noteCount === 1 ? "" : "s"}
                      {t.status === "left" ? " · ended early" : ""}
                    </span>
                    <span className="block truncate text-lg font-bold">{t.path.join(" → ")}</span>
                  </span>
                  <span className="flex items-center gap-1 font-bold text-navy-700">
                    <PlayIcon size={18} /> Replay
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Demo controls" id="demo">
        <Card className="p-5">
          <p className="text-base text-navy-700">
            For judging: put My Memory Room back to the seeded history (usual level 1; two rounds with 3 hints already), so the next
            round with 3 clues triggers the real alert and phone notification.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Button variant="gold" size="md" icon={resetting === "history" ? <Spinner /> : <RefreshIcon size={20} />} onClick={() => void reset("history")} disabled={!!resetting}>
              Reset the alert demo
            </Button>
            <Button variant="ivory" size="md" icon={resetting === "all" ? <Spinner /> : <RefreshIcon size={20} />} onClick={() => void reset("all")} disabled={!!resetting}>
              Restore all demo content
            </Button>
          </div>
        </Card>
      </Section>
    </FamilyShell>
  );
}
