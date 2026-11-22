"use client";

import { useEffect, useState } from "react";
import { getJson } from "@/lib/client/api";
import { summarizeCheck, type StoryCheckView } from "@/lib/shared/storycheck";

interface Data {
  baseline: StoryCheckView | null;
  checks: StoryCheckView[];
}

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { weekday: "long", hour: "numeric", minute: "2-digit" });

/**
 * The story game's report: the starting point (set by the first game) and how
 * the latest game compares with it. Shown to the family and, after the game,
 * on the player's screen.
 */
export function StoryReport({ name, refreshMs = 5000, className = "" }: { name: string; refreshMs?: number; className?: string }) {
  const [data, setData] = useState<Data | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      getJson<Data>("/api/story-checks")
        .then((d) => alive && setData(d))
        .catch(() => undefined);
    void load();
    const t = setInterval(load, refreshMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [refreshMs]);

  if (!data) return null;
  const { baseline, checks } = data;
  const latest = checks.find((c) => !c.isBaseline) ?? null;

  return (
    <section className={`rounded-[1.75rem] bg-white/90 p-5 text-navy-900 shadow-card ${className}`} aria-live="polite">
      <p className="text-sm font-bold text-gold-700">Story game · starting point</p>
      {!baseline ? (
        <>
          <h2 className="mt-1 font-display text-2xl font-bold leading-tight">Not set yet</h2>
          <p className="mt-2 text-base text-navy-700">{name}&apos;s first story game sets the starting point. Every game after it is compared with it.</p>
        </>
      ) : (
        <>
          <h2 className="mt-1 font-display text-2xl font-bold leading-tight">{name}&apos;s starting point is set</h2>
          <p className="mt-2 text-lg">{summarizeCheck(baseline)}</p>
          <ul className="mt-3 flex flex-col gap-1.5">
            {baseline.answers.map((a) => (
              <li key={a.topic} className="flex items-center gap-2 text-base">
                <span className={`inline-flex size-6 shrink-0 items-center justify-center rounded-full text-sm font-bold ${a.right ? "bg-sage-100 text-sage-700" : "bg-gold-200 text-gold-700"}`} aria-hidden="true">
                  {a.right ? "✓" : "?"}
                </span>
                <span>
                  {a.topic.charAt(0).toUpperCase() + a.topic.slice(1)}: {a.right ? "remembered" : "needed a little help"}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-navy-600">Set {when(baseline.createdAt)}. Every story game from now on is compared with this.</p>
          {latest?.comparison && (
            <div className={`mt-4 rounded-2xl p-4 ${latest.comparison.verdict === "much_fewer" ? "bg-gold-100" : "bg-ivory-100"}`}>
              <p className="text-sm font-bold text-navy-600">Latest game · {when(latest.createdAt)}</p>
              <p className="mt-1 text-lg font-bold">{latest.comparison.sentence}</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
