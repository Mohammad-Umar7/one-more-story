"use client";

import Link from "next/link";
import { useVoice } from "./AppProvider";
import { HomeIcon, PauseIcon } from "./icons";
import { VoiceDock } from "./VoiceDock";

/** Frame for every game screen: Home and Pause at the top, voice at the bottom. */
export function GameShell({
  title,
  children,
  hint,
  onHome,
}: {
  title: string;
  children: React.ReactNode;
  hint?: string;
  onHome?: () => void;
}) {
  const { engine } = useVoice();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-ivory-300/60 bg-ivory-100/92 backdrop-blur-md safe-top">
        <div className="mx-auto flex h-[4.25rem] w-full max-w-6xl items-center gap-2 px-2 md:h-16 md:px-6">
          <Link
            href="/"
            onClick={onHome}
            className="flex h-14 w-[4.25rem] shrink-0 flex-col items-center justify-center rounded-2xl border border-ivory-300 bg-white text-sm font-bold text-navy-900 shadow-card active:scale-[0.98] md:h-12 md:w-auto md:flex-row md:gap-2 md:px-3 md:text-lg"
          >
            <HomeIcon size={24} />
            <span>Home</span>
          </Link>
          <h1 className="min-w-0 flex-1 text-center font-display text-[1.35rem] font-semibold leading-tight text-navy-900 md:text-2xl">
            {title}
          </h1>
          <button
            type="button"
            onClick={() => engine.pause()}
            className="flex h-14 w-[4.25rem] shrink-0 flex-col items-center justify-center rounded-2xl border border-ivory-300 bg-white text-sm font-bold text-navy-900 shadow-card active:scale-[0.98] md:h-12 md:w-auto md:flex-row md:gap-2 md:px-3 md:text-lg"
          >
            <PauseIcon size={22} />
            <span>Pause</span>
          </button>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-3 pb-4 pt-3 md:px-6 md:pt-5">{children}</main>
      <VoiceDock hint={hint} />
    </div>
  );
}
