"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useApp, useVoice } from "./AppProvider";
import { MicIcon } from "./icons";

const KEY = "oms-welcomed";

function alreadyWelcomed(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function markWelcomed() {
  try {
    sessionStorage.setItem(KEY, "1");
  } catch {
    // private mode: the gate may show again next time, which is harmless
  }
}

function greetingWord(h: number) {
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/**
 * The first thing the player sees: one big Start button that turns the voice
 * on and gets a spoken hello. Browsers only allow a page to talk and listen
 * after one tap, so this is that tap. When the browser already allows it
 * (sound allowed for this site, mic already permitted, natural voice set up),
 * the companion starts talking straight away and the screen never shows.
 */
export function WelcomeGate() {
  const { bundle } = useApp();
  const { engine } = useVoice();
  const pathname = usePathname();
  const [state, setState] = useState<"checking" | "show" | "hidden">("checking");
  const checked = useRef(false);
  const playerScreen = pathname === "/" || pathname.startsWith("/play");

  useEffect(() => {
    if (!bundle || checked.current) return;
    checked.current = true;
    if (!playerScreen || alreadyWelcomed() || engine.isActive) {
      setState("hidden");
      return;
    }
    let cancelled = false;
    void engine.canStartWithoutTap(bundle.config.tts).then((ok) => {
      if (cancelled) return;
      if (ok) {
        markWelcomed();
        setState("hidden");
        void engine.start();
      } else {
        setState("show");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [bundle, engine, playerScreen]);

  if (state !== "show" || !playerScreen || !bundle) return null;

  const start = () => {
    markWelcomed();
    setState("hidden");
    void engine.start(); // the tap unlocks sound and the mic; the screen's greeting is spoken
  };
  const skip = () => {
    markWelcomed();
    setState("hidden");
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-navy-900 px-6 text-center text-ivory-50 safe-top safe-bottom animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
    >
      <button type="button" onClick={start} className="absolute inset-0" aria-label="Start, and talk with me" tabIndex={-1} />
      <div className="pointer-events-none relative flex w-full max-w-sm flex-col items-center">
        <span className="relative flex size-28 items-center justify-center">
          <span className="absolute inset-0 animate-ripple rounded-full bg-gold-400/30" aria-hidden="true" />
          <span className="relative flex size-24 items-center justify-center rounded-full bg-gold-400 text-navy-950 shadow-gold">
            <MicIcon size={44} />
          </span>
        </span>
        <p className="mt-8 text-sm font-bold uppercase tracking-[0.18em] text-gold-300">One More Story</p>
        <h1 id="welcome-title" className="mt-2 font-display text-[2.4rem] font-semibold leading-tight">
          {greetingWord(new Date().getHours())}, {bundle.player.name}
        </h1>
        <p className="mt-3 text-xl leading-relaxed text-ivory-200">Shall we play a game together? Tap below and I&apos;ll talk with you.</p>
        <button
          type="button"
          onClick={start}
          autoFocus
          className="pointer-events-auto mt-10 flex min-h-20 w-full items-center justify-center gap-3 rounded-3xl bg-gold-400 px-6 text-2xl font-bold text-navy-950 shadow-gold active:scale-[0.98]"
        >
          <MicIcon size={30} /> Start
        </button>
        <button
          type="button"
          onClick={skip}
          className="pointer-events-auto mt-5 min-h-12 px-4 text-lg font-bold text-ivory-200 underline underline-offset-4"
        >
          Play without voice
        </button>
      </div>
    </div>
  );
}
