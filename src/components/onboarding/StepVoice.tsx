"use client";

import { useEffect, useRef, useState } from "react";
import { CheckIcon, PlayIcon } from "@/components/icons";
import { fillLine, VOICE_LINES } from "@/lib/shared/companion";
import { RecordPanel } from "./RecordPanel";
import { GoldButton, postForm, StepTitle, type StepProps } from "./shared";

/**
 * A few short lines in the family member's own voice. The player hears these
 * real recordings at the warmest moments: hello, well done, goodbye.
 */
export function StepVoice({ state, guide, refresh, next }: StepProps) {
  const call = state.player.callName;
  const member = state.member?.name ?? "me";
  const recorded = new Map(state.lines.map((l) => [l.key, l]));
  const firstOpen = VOICE_LINES.findIndex((l) => !recorded.has(l.key));
  const [current, setCurrent] = useState(firstOpen === -1 ? 0 : firstOpen);
  const [busy, setBusy] = useState(false);
  const [arm, setArm] = useState<string | null>(null);
  const seq = useRef(0);
  const started = useRef(false);
  const line = VOICE_LINES[current];
  const text = fillLine(line.template, call, member);
  const doneCount = VOICE_LINES.filter((l) => recorded.has(l.key)).length;

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void guide
      .say(`Now a few short lines in your own voice. ${call} will hear them exactly as you say them. Say each one warmly, the way you would at home.`)
      .then(() => setArm(`${VOICE_LINES[current].key}-${++seq.current}`));
  }, [call, current, guide]);

  const pick = (i: number) => {
    guide.stop();
    setCurrent(i);
    setArm(null);
  };

  const onRecorded = async (wav: Blob, durationMs: number) => {
    const form = new FormData();
    form.append("key", line.key);
    form.append("file", wav, `${line.key}.wav`);
    if (durationMs) form.append("durationMs", String(durationMs));
    setBusy(true);
    try {
      await postForm("/api/onboarding/line", form);
      const fresh = await refresh();
      const have = new Set((fresh?.lines ?? []).map((l) => l.key));
      const nextOpen = VOICE_LINES.findIndex((l, i) => i > current && !have.has(l.key));
      const anyOpen = nextOpen !== -1 ? nextOpen : VOICE_LINES.findIndex((l) => !have.has(l.key));
      if (anyOpen !== -1) {
        setCurrent(anyOpen);
        setArm(`${VOICE_LINES[anyOpen].key}-${++seq.current}`);
      } else {
        setArm(null);
        void guide.say(`Beautiful. ${call} is going to love hearing you.`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-5">
      <StepTitle eyebrow={`Step 4 · Your voice · ${doneCount} of ${VOICE_LINES.length}`} title="Say it like you mean it">
        Short lines, in your own voice. Record at least three; all six is best.
      </StepTitle>

      <div className="glass w-full rounded-[2rem] p-6 text-center">
        <p className="text-sm font-bold text-gold-300">{line.label}. Please say:</p>
        <p className="mt-2 text-[1.7rem] font-bold leading-snug text-ivory-50">&ldquo;{text}&rdquo;</p>
      </div>

      <RecordPanel armKey={arm} busy={busy} busyLabel="Saving your voice…" silenceMs={1500} maxMs={20_000} allowType={false} recordLabel={recorded.has(line.key) ? "Record it again" : "Record this line"} onRecorded={onRecorded} />

      <ul className="flex w-full flex-col gap-2">
        {VOICE_LINES.map((l, i) => {
          const rec = recorded.get(l.key);
          return (
            <li key={l.key} className={`flex items-center gap-3 rounded-2xl border px-3 py-2 ${i === current ? "border-gold-300/70 bg-gold-400/10" : "border-white/10 bg-white/5"}`}>
              <span className={`flex size-8 shrink-0 items-center justify-center rounded-full ${rec ? "bg-gold-400 text-navy-950" : "bg-white/10 text-ivory-200"}`}>
                {rec ? <CheckIcon size={16} /> : <span className="text-sm font-bold">{i + 1}</span>}
              </span>
              <button type="button" onClick={() => pick(i)} className="min-h-11 flex-1 text-left text-base text-ivory-100">
                {fillLine(l.template, call, member)}
              </button>
              {rec && (
                <button type="button" onClick={() => void guide.playClip(rec.url)} className="flex size-11 items-center justify-center rounded-full bg-white/10 text-gold-200" aria-label="Play">
                  <PlayIcon size={18} />
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <GoldButton
        disabled={doneCount < 3 || busy}
        onClick={() => {
          guide.stop();
          next();
        }}
      >
        {doneCount < 3 ? `Record ${3 - doneCount} more to continue` : "Continue"}
      </GoldButton>
    </div>
  );
}
