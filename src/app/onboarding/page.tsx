"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { NightSky } from "@/components/companion/NightSky";
import { Avatar } from "@/components/companion/Avatar";
import { Caption } from "@/components/companion/Caption";
import { Spinner } from "@/components/ui";
import { useGuide } from "@/components/onboarding/useGuide";
import { GoldButton, type OnboardingState } from "@/components/onboarding/shared";
import { StepAbout } from "@/components/onboarding/StepAbout";
import { StepPhoto } from "@/components/onboarding/StepPhoto";
import { StepInterview } from "@/components/onboarding/StepInterview";
import { StepVoice } from "@/components/onboarding/StepVoice";
import { StepStage } from "@/components/onboarding/StepStage";
import { StepBuild } from "@/components/onboarding/StepBuild";
import { ONBOARDING_STEPS, type OnboardingStep } from "@/lib/shared/onboarding";

const ORDER: OnboardingStep[] = ["welcome", "about", "photo", "interview", "voice", "stage", "build", "done"];

/**
 * Setup for the family, led by voice: who you are, your face, their story,
 * your voice, how they are, then their world is built. About fifteen minutes.
 */
export default function OnboardingPage() {
  const guide = useGuide();
  const [state, setState] = useState<OnboardingState | null>(null);
  const [view, setView] = useState<OnboardingStep | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/onboarding", { cache: "no-store" });
      if (!res.ok) throw new Error("Couldn't load setup");
      const s = (await res.json()) as OnboardingState;
      setState(s);
      return s;
    } catch (err) {
      setError((err as Error).message);
      return null;
    }
  }, []);

  useEffect(() => {
    void refresh().then((s) => {
      if (!s) return;
      setView(s.step === "about" && !s.member ? "welcome" : s.step);
    });
  }, [refresh]);

  const next = useCallback(() => {
    setView((v) => ORDER[Math.min(ORDER.length - 1, ORDER.indexOf(v ?? "welcome") + 1)]);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const go = (step: OnboardingStep) => {
    guide.stop();
    setView(step);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const props = state ? { state, guide, refresh, setState, next } : null;
  const reached = state ? ORDER.indexOf(state.step) : 0;

  return (
    <div className="night">
      <NightSky />
      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-xl flex-col px-4 pb-10 safe-top">
        <header className="flex items-center justify-between gap-3 py-4">
          <Link href="/welcome" className="text-lg font-bold">
            <span className="gold-text">One More Story</span>
          </Link>
          {view && view !== "welcome" && view !== "done" && (
            <span className="text-sm font-bold text-ivory-200">Family setup</span>
          )}
        </header>

        {view && view !== "welcome" && view !== "done" && (
          <nav aria-label="Setup steps" className="mb-6">
            <ol className="flex gap-1.5">
              {ONBOARDING_STEPS.map((s) => {
                const idx = ORDER.indexOf(s.key);
                const active = s.key === view;
                const open = idx <= Math.max(reached, ORDER.indexOf(view)) && s.key !== "build";
                return (
                  <li key={s.key} className="flex-1">
                    <button
                      type="button"
                      disabled={!open || active}
                      onClick={() => go(s.key)}
                      className="group flex w-full flex-col gap-1.5 text-left disabled:cursor-default"
                      aria-current={active ? "step" : undefined}
                    >
                      <span className={`h-1.5 w-full rounded-full ${active ? "bg-gold-300" : idx < ORDER.indexOf(view) ? "bg-gold-400/60" : "bg-white/15"}`} />
                      <span className={`hidden text-xs font-bold sm:block ${active ? "text-gold-200" : "text-ivory-200/70"}`}>{s.label}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
        )}

        <main className="flex flex-1 flex-col">
          {!state || !view ? (
            <div className="flex flex-1 items-center justify-center gap-3 text-lg">
              {error ? <p className="text-gold-200">{error}</p> : <Spinner />}
            </div>
          ) : view === "welcome" ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-7 text-center animate-fade-up">
              <div className="w-56 md:w-64">
                <Avatar src={null} name="Your guide" speaking={guide.speaking} level={guide.level} />
              </div>
              <div>
                <h1 className="text-[2.3rem] font-bold leading-tight md:text-5xl">
                  Let&apos;s build a little world <span className="gold-text">for someone you love</span>
                </h1>
                <p className="mx-auto mt-4 max-w-md text-xl leading-relaxed text-ivory-200">
                  I&apos;ll ask you about their life and learn your voice and your face. Then every day they&apos;ll play gentle games with you, made from their own story.
                </p>
              </div>
              <ul className="flex flex-wrap justify-center gap-2 text-base font-bold text-ivory-100">
                {["About 15 minutes", "Mostly talking", "Your voice, your face"].map((t) => (
                  <li key={t} className="glass rounded-full px-4 py-2">
                    {t}
                  </li>
                ))}
              </ul>
              <GoldButton
                onClick={() => {
                  guide.unlock();
                  void guide.say("Hello, and welcome. I'll help you build a little world for someone you love. First, tell me about the two of you.");
                  next();
                }}
              >
                Begin
              </GoldButton>
            </div>
          ) : view === "done" ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center animate-fade-up">
              <div className="w-56">
                <Avatar src={state.member?.avatarUrl ?? state.member?.photoUrl} name={state.member?.name ?? ""} speaking={guide.speaking} level={guide.level} />
              </div>
              <h1 className="text-[2rem] font-bold leading-tight">Setup is complete</h1>
              <p className="max-w-md text-lg text-ivory-200">
                {state.player.callName}&apos;s companion is ready. You can add more of their story any time from the family corner.
              </p>
              <div className="flex w-full flex-col gap-3">
                <GoldButton onClick={() => (window.location.href = "/")}>Open {state.player.callName}&apos;s games</GoldButton>
                <Link href="/family" className="min-h-12 text-lg font-bold text-ivory-200 underline underline-offset-4">
                  Family corner
                </Link>
                <button type="button" onClick={() => go("interview")} className="min-h-12 text-lg font-bold text-ivory-200 underline underline-offset-4">
                  Answer the story questions again
                </button>
              </div>
            </div>
          ) : (
            <div key={view} className="animate-fade-up">
              {view === "about" && props && (
                <>
                  {guide.line && (
                    <div className="mb-4 text-center">
                      <Caption text={guide.line} size="md" />
                    </div>
                  )}
                  <StepAbout {...props} />
                </>
              )}
              {view === "photo" && props && <StepPhoto {...props} />}
              {view === "interview" && props && <StepInterview {...props} />}
              {view === "voice" && props && <StepVoice {...props} />}
              {view === "stage" && props && <StepStage {...props} />}
              {view === "build" && props && <StepBuild {...props} />}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
