"use client";

import { useEffect, useRef, useState } from "react";
import { STAGE_CHECK, STAGE_CHECK_SCALE, STAGE_LABEL, type DoctorSaid } from "@/lib/shared/companion";
import { Chip, GoldButton, postJson, StepTitle, type OnboardingState, type StepProps } from "./shared";

const DOCTOR: { key: DoctorSaid; label: string }[] = [
  { key: "early", label: "Early stage" },
  { key: "middle", label: "Middle stage" },
  { key: "late", label: "Late stage" },
  { key: "unsure", label: "Not sure" },
];

/** The starting baseline: five quick questions and what the doctor said. */
export function StepStage({ state, setState, guide, next }: StepProps) {
  const call = state.player.callName;
  const [answers, setAnswers] = useState<(number | null)[]>(STAGE_CHECK.map(() => null));
  const [doctor, setDoctor] = useState<DoctorSaid | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const result = state.baseline;

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void guide.say(`Nearly done. A few quick questions about how ${call} is these days. There are no wrong answers, and the games keep adjusting every day.`);
  }, [call, guide]);

  const ready = answers.every((a) => a !== null) && doctor !== null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const s = await postJson<OnboardingState>("/api/onboarding/stage", { answers, doctor });
      setState(s);
      if (s.baseline) void guide.say(`Thank you. We'll start gently, at the ${STAGE_LABEL[s.baseline.stage].toLowerCase()}, level ${s.baseline.level}. Every day after ${call} plays, I'll adjust it.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <StepTitle eyebrow="Step 5 · How they are" title={`How is ${call} these days?`}>
        This sets where the games begin. It&apos;s not a test, and nothing here is a diagnosis.
      </StepTitle>

      {STAGE_CHECK.map((q, i) => (
        <fieldset key={q.key} className="glass rounded-[2rem] p-5">
          <legend className="sr-only">{q.question}</legend>
          <p className="text-xl font-bold leading-snug text-ivory-50">{q.question}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {STAGE_CHECK_SCALE.map((label, v) => (
              <Chip key={label} active={answers[i] === v} onClick={() => setAnswers((a) => a.map((x, j) => (j === i ? v : x)))}>
                {label}
              </Chip>
            ))}
          </div>
        </fieldset>
      ))}

      <fieldset className="glass rounded-[2rem] p-5">
        <legend className="sr-only">What did the doctor say?</legend>
        <p className="text-xl font-bold leading-snug text-ivory-50">What did the doctor say?</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {DOCTOR.map((d) => (
            <Chip key={d.key} active={doctor === d.key} onClick={() => setDoctor(d.key)}>
              {d.label}
            </Chip>
          ))}
        </div>
      </fieldset>

      {result && (
        <div className="rounded-[2rem] border border-gold-300/50 bg-gold-400/15 p-5 text-center">
          <p className="text-sm font-bold text-gold-200">We&apos;ll start at</p>
          <p className="mt-1 text-3xl font-bold text-ivory-50">
            {STAGE_LABEL[result.stage]} · level {result.level}
          </p>
          <p className="mt-2 text-base leading-relaxed text-ivory-200">{result.reason}</p>
        </div>
      )}

      {error && <p className="text-center text-lg font-bold text-gold-200">{error}</p>}
      {result ? (
        <div className="flex flex-col gap-2">
          <GoldButton
            onClick={() => {
              guide.stop();
              next();
            }}
          >
            Build {call}&apos;s world
          </GoldButton>
          <button type="button" disabled={!ready || busy} onClick={() => void submit()} className="min-h-11 text-base font-bold text-ivory-200 underline underline-offset-4 disabled:opacity-40">
            Update the starting point
          </button>
        </div>
      ) : (
        <GoldButton disabled={!ready || busy} onClick={() => void submit()}>
          {busy ? "Working it out…" : "Set the starting point"}
        </GoldButton>
      )}
    </div>
  );
}
