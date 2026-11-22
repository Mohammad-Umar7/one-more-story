"use client";

import Link from "next/link";
import { useVoice } from "./AppProvider";
import { HomeIcon, PauseIcon } from "./icons";
import { VoiceDock } from "./VoiceDock";

const barButton =
  "flex h-14 w-[4.25rem] shrink-0 flex-col items-center justify-center rounded-2xl bg-white text-sm font-bold text-navy-900 shadow-card active:scale-[0.98] md:h-12 md:w-auto md:flex-row md:gap-2 md:px-4 md:text-base";

/** Frame for every game screen: Home and Pause on top, the voice dock at the bottom. */
export function GameShell({
  title,
  children,
  screenText,
}: {
  title: string;
  children: React.ReactNode;
  /** The question currently on screen; the dock won't repeat it. */
  screenText?: string | null;
}) {
  const { engine } = useVoice();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 bg-ivory-100/90 backdrop-blur-md safe-top">
        <div className="mx-auto flex h-[4.5rem] w-full max-w-6xl items-center gap-2 px-3 md:h-16 md:px-6">
          <Link href="/" className={barButton}>
            <HomeIcon size={22} />
            <span>Home</span>
          </Link>
          <h1 className="min-w-0 flex-1 text-center font-display text-xl font-bold leading-tight md:text-2xl">{title}</h1>
          <button type="button" onClick={() => engine.pause()} className={barButton}>
            <PauseIcon size={20} />
            <span>Pause</span>
          </button>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-3 pb-4 md:px-6 md:pt-2">{children}</main>
      <VoiceDock screenText={screenText} />
    </div>
  );
}
