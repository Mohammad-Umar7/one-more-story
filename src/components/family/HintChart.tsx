"use client";

import { useState } from "react";
import type { MemorySessionView } from "@/lib/shared/types";

// Validated with the dataviz palette checker (light surface): both pass.
const USUAL = "#4f6bb0";
const ELEVATED = "#a2771b";

function shortDate(iso: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(iso));
}

/** Hints per My Memory Room round, with the usual level and the alert level. */
export function HintChart({
  sessions,
  baseline,
  threshold,
  familyName,
}: {
  sessions: MemorySessionView[]; // newest first, as the API returns them
  baseline: number | null;
  threshold: number | null;
  familyName: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const rounds = sessions
    .filter((s) => s.role !== "other-setup" && s.status !== "in_progress")
    .slice(0, 14)
    .reverse();

  if (rounds.length === 0) return <p className="text-lg text-navy-700">No rounds played yet.</p>;

  const W = 640;
  const H = 240;
  const pad = { l: 34, r: 12, t: 16, b: 34 };
  const maxY = Math.max(4, (threshold ?? 0) + 1, ...rounds.map((r) => r.hintCount + 1));
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const slot = plotW / rounds.length;
  const barW = Math.min(34, slot - 8);
  const y = (v: number) => pad.t + plotH - (v / maxY) * plotH;
  const ticks = Array.from({ length: maxY + 1 }, (_, i) => i).filter((v) => maxY <= 6 || v % 2 === 0);
  const tip = active !== null ? rounds[active] : null;

  return (
    <figure className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Hints used per round by ${familyName}`}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="#e9dbbb" strokeWidth={1} />
            <text x={pad.l - 8} y={y(v) + 4} textAnchor="end" fontSize={12} fill="#6d82b8">
              {v}
            </text>
          </g>
        ))}
        {rounds.map((r, i) => {
          const x = pad.l + i * slot + (slot - barW) / 2;
          const h = Math.max(r.hintCount === 0 ? 3 : 0, plotH - (y(r.hintCount) - pad.t));
          const top = pad.t + plotH - h;
          const excluded = !r.valid;
          const color = r.elevated ? ELEVATED : USUAL;
          return (
            <g key={r.id} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} onClick={() => setActive(active === i ? null : i)} className="cursor-pointer">
              {/* hit target larger than the mark */}
              <rect x={pad.l + i * slot} y={pad.t} width={slot} height={plotH} fill="transparent" />
              <path
                d={`M${x},${top + h} V${top + Math.min(4, h)} Q${x},${top} ${x + Math.min(4, barW / 2)},${top} H${x + barW - Math.min(4, barW / 2)} Q${x + barW},${top} ${x + barW},${top + Math.min(4, h)} V${top + h} Z`}
                fill={excluded ? "transparent" : color}
                stroke={excluded ? "#6d82b8" : "none"}
                strokeWidth={excluded ? 2 : 0}
                strokeDasharray={excluded ? "4 3" : undefined}
                opacity={active === null || active === i ? 1 : 0.55}
              />
              <text x={x + barW / 2} y={H - pad.b + 16} textAnchor="middle" fontSize={11} fill="#2b4a90">
                {shortDate(r.endedAt ?? r.startedAt)}
              </text>
              {r.elevated && (
                <text x={x + barW / 2} y={top - 6} textAnchor="middle" fontSize={12} fontWeight={700} fill="#785712">
                  {r.hintCount}
                </text>
              )}
            </g>
          );
        })}
        {baseline !== null && (
          <g>
            <line x1={pad.l} x2={W - pad.r} y1={y(baseline)} y2={y(baseline)} stroke="#0c1a42" strokeWidth={2} strokeDasharray="6 5" />
            <text x={W - pad.r} y={y(baseline) - 6} textAnchor="end" fontSize={12} fontWeight={700} fill="#0c1a42">
              Usual: {baseline}
            </text>
          </g>
        )}
        {threshold !== null && (
          <g>
            <line x1={pad.l} x2={W - pad.r} y1={y(threshold)} y2={y(threshold)} stroke="#785712" strokeWidth={2} strokeDasharray="2 4" />
            <text x={pad.l + 4} y={y(threshold) - 6} fontSize={12} fontWeight={700} fill="#785712">
              Alert level: {threshold}+
            </text>
          </g>
        )}
      </svg>
      {tip && (
        <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 rounded-xl bg-navy-950 px-3 py-2 text-sm text-ivory-50 shadow-photo">
          <b>{new Date(tip.endedAt ?? tip.startedAt).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</b>
          <br />
          {tip.hintCount} hint{tip.hintCount === 1 ? "" : "s"} · {tip.excludedReason ? `not counted: ${tip.excludedReason.toLowerCase()}` : tip.role === "baseline" ? "part of the usual level" : tip.elevated ? "at the alert level" : "compared with the usual level"}
        </div>
      )}
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-navy-700">
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-sm" style={{ background: USUAL }} /> Round
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-sm" style={{ background: ELEVATED }} /> At the alert level
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-sm border-2 border-dashed border-navy-400" /> Not counted
        </span>
      </figcaption>
    </figure>
  );
}
