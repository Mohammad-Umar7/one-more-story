"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "@/components/companion/Avatar";
import { Caption } from "@/components/companion/Caption";
import { CheckIcon } from "@/components/icons";
import { CHAPTER_LABEL, fillQuestion, INTERVIEW } from "@/lib/shared/onboarding";
import { RecordPanel } from "./RecordPanel";
import { GoldButton, postForm, type StepProps } from "./shared";

interface AnswerReply {
  heard: boolean;
  transcript?: string;
  reply: string;
  followUp?: string | null;
}

/**
 * The story interview. The guide asks each question out loud, then listens.
 * Each answer is transcribed and answered warmly by the AI, which may ask one
 * follow-up for a vivid detail, then moves on to the next question.
 */
export function StepInterview({ state, guide, refresh, next }: StepProps) {
  const call = state.player.callName;
  const questions = useMemo(
    () => INTERVIEW.map((q) => ({ ...q, text: fillQuestion(q.ask, call, state.player.pronoun) })),
    [call, state.player.pronoun],
  );
  const answeredKeys = new Set(state.answered.map((a) => a.key));
  const firstOpen = questions.findIndex((q) => !answeredKeys.has(q.key));
  const [index, setIndex] = useState(firstOpen === -1 ? questions.length : firstOpen);
  const [followUp, setFollowUp] = useState<string | null>(null);
  const [arm, setArm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastHeard, setLastHeard] = useState<string | null>(null);
  const started = useRef(false);
  const seq = useRef(0);
  const armId = (k: string) => `${k}-${++seq.current}`;
  const q = questions[index] ?? null;
  const finished = index >= questions.length;

  const ask = useCallback(
    async (text: string, armKey: string) => {
      setArm(null);
      await guide.say(text);
      setArm(armKey);
    },
    [guide],
  );

  // First question: a short welcome, then ask.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (finished) {
      void guide.say(`That's everything. Thank you for sharing ${call}'s story with me.`);
      return;
    }
    const intro =
      index === 0
        ? `Now the best part. I'd love to hear ${call}'s story. Just talk to me the way you'd tell a friend. `
        : "Let's carry on. ";
    void ask(intro + questions[index].text, `${questions[index].key}-0`);
  }, [ask, call, finished, guide, index, questions]);

  const goTo = (i: number) => {
    guide.stop();
    setFollowUp(null);
    setLastHeard(null);
    setIndex(i);
    if (i < questions.length) void ask(questions[i].text, armId(questions[i].key));
  };

  const handle = async (res: AnswerReply) => {
    if (!q) return;
    if (!res.heard) {
      await ask(res.reply, armId(`${q.key}-retry`));
      return;
    }
    setLastHeard(res.transcript ?? null);
    void refresh();
    if (res.followUp && !followUp) {
      setFollowUp(res.followUp);
      await ask(`${res.reply} ${res.followUp}`, armId(`${q.key}-more`));
      return;
    }
    setFollowUp(null);
    const nextIndex = index + 1;
    if (nextIndex >= questions.length) {
      setIndex(nextIndex);
      setArm(null);
      await guide.say(`${res.reply} That's everything. Thank you so much for sharing ${call}'s story with me.`);
      return;
    }
    setIndex(nextIndex);
    await ask(`${res.reply} ${questions[nextIndex].text}`, `${questions[nextIndex].key}-0`);
  };

  const send = async (form: FormData) => {
    if (!q) return;
    form.append("key", q.key);
    if (followUp) {
      form.append("followUp", "1");
      form.append("question", followUp);
    }
    setBusy(true);
    setArm(null);
    try {
      const res = await postForm<AnswerReply>("/api/onboarding/answer", form);
      setBusy(false);
      await handle(res);
    } catch (err) {
      setBusy(false);
      throw err;
    }
  };

  const onRecorded = async (wav: Blob, durationMs: number) => {
    const form = new FormData();
    form.append("file", wav, "answer.wav");
    if (durationMs) form.append("durationMs", String(durationMs));
    await send(form);
  };

  const onTyped = async (text: string) => {
    const form = new FormData();
    form.append("text", text);
    await send(form);
  };

  const skip = () => {
    if (!q) return;
    goTo(index + 1);
  };

  const missing = questions.filter((x) => !x.optional && !answeredKeys.has(x.key));

  return (
    <div className="flex flex-col items-center gap-5">
      {/* Progress through the eight questions; tap one to answer it again. */}
      <ol className="flex flex-wrap justify-center gap-2" aria-label="Questions">
        {questions.map((x, i) => {
          const done = answeredKeys.has(x.key);
          const current = i === index;
          return (
            <li key={x.key}>
              <button
                type="button"
                onClick={() => goTo(i)}
                className={`flex size-10 items-center justify-center rounded-full border text-base font-bold transition-all ${
                  current ? "scale-110 border-gold-300 bg-gold-400 text-navy-950" : done ? "border-gold-300/60 bg-gold-400/20 text-gold-200" : "border-white/20 bg-white/5 text-ivory-200"
                }`}
                aria-label={`Question ${i + 1}${done ? ", answered" : ""}`}
                aria-current={current ? "step" : undefined}
              >
                {done && !current ? <CheckIcon size={18} /> : i + 1}
              </button>
            </li>
          );
        })}
      </ol>

      <div className="w-40 md:w-48">
        <Avatar src={null} name="Your guide" speaking={guide.speaking} listening={!!arm && !busy} level={guide.level} />
      </div>

      {q && !finished ? (
        <>
          <div className="text-center">
            <p className="text-sm font-bold tracking-wide text-gold-300">
              Step 3 · {CHAPTER_LABEL[q.chapter]} · {index + 1} of {questions.length}
            </p>
            <div className="mt-2 min-h-24">
              <Caption text={guide.line || q.text} size="lg" />
            </div>
            {!followUp && <p className="mx-auto mt-3 max-w-md text-base leading-relaxed text-ivory-200/90">{q.tip}</p>}
          </div>

          <RecordPanel
            armKey={arm}
            busy={busy}
            busyLabel="Listening to your story…"
            onRecorded={onRecorded}
            onTyped={onTyped}
            recordLabel={followUp ? "Tell me more" : "Record my answer"}
          />

          {lastHeard && (
            <details className="glass w-full rounded-2xl px-4 py-3 text-base text-ivory-200">
              <summary className="cursor-pointer font-bold text-ivory-100">What I heard</summary>
              <p className="mt-2 leading-relaxed">{lastHeard}</p>
            </details>
          )}

          <button type="button" onClick={skip} className="min-h-11 text-base font-bold text-ivory-200/80 underline underline-offset-4">
            {q.optional ? "Skip this one" : "Skip for now"}
          </button>
        </>
      ) : (
        <>
          <div className="min-h-20 text-center">
            <Caption text={guide.line} size="lg" />
          </div>
          {missing.length > 0 && (
            <p className="text-center text-base text-ivory-200">
              {missing.length === 1 ? "One question is" : `${missing.length} questions are`} still open. More answers make better games, but you can carry on.
            </p>
          )}
          <GoldButton
            onClick={() => {
              guide.stop();
              next();
            }}
          >
            Continue
          </GoldButton>
        </>
      )}
    </div>
  );
}
