"use client";

import { useRouter } from "next/navigation";
import { useVoice } from "./AppProvider";
import { Button } from "./ui";
import { HomeIcon, PlayIcon } from "./icons";

export function PauseOverlay() {
  const { engine, snap } = useVoice();
  const router = useRouter();
  if (!snap.paused) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/92 p-5 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pause-title"
    >
      <div className="w-full max-w-md text-center text-ivory-50">
        <div className="mx-auto mb-6 flex size-20 items-center justify-center rounded-full bg-gold-400/15 ring-2 ring-gold-400/60">
          <span className="flex gap-2" aria-hidden="true">
            <span className="h-9 w-3 rounded bg-gold-300" />
            <span className="h-9 w-3 rounded bg-gold-300" />
          </span>
        </div>
        <h2 id="pause-title" className="font-display text-5xl font-bold">
          Paused
        </h2>
        <p className="mt-3 text-xl text-ivory-200">Take your time. Everything will wait right here.</p>
        {snap.active && <p className="mt-2 text-base text-ivory-200/70">The microphone is off while we pause.</p>}
        <div className="mt-8 flex flex-col gap-3">
          <Button variant="gold" size="xl" icon={<PlayIcon size={26} />} onClick={() => void engine.resume()} autoFocus>
            Continue
          </Button>
          <Button
            variant="ivory"
            size="xl"
            icon={<HomeIcon size={26} />}
            onClick={() => {
              void engine.resume({ quiet: true });
              router.push("/");
            }}
          >
            Home
          </Button>
        </div>
      </div>
    </div>
  );
}
