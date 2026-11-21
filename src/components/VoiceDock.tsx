"use client";

import { useVoice } from "./AppProvider";
import { Button } from "./ui";
import { MicIcon, MicOffIcon, StopIcon, DoorIcon } from "./icons";
import type { VoiceSnapshot } from "@/lib/client/voice-engine";

function StatusPill({ snap }: { snap: VoiceSnapshot }) {
  const listening = snap.status === "listening";
  const label =
    snap.status === "speaking"
      ? snap.playing === "clip"
        ? "Playing"
        : "Speaking"
      : snap.status === "thinking"
        ? "One moment"
        : snap.status === "paused"
          ? "Paused"
          : snap.noteMode
            ? "Recording"
            : snap.recognition === "unsupported" || snap.mic === "denied"
              ? "Your turn: tap"
              : "Listening";
  return (
    <div
      className="flex min-h-14 flex-1 items-center gap-3 rounded-2xl bg-navy-800 px-4 text-ivory-50"
      role="status"
      aria-live="polite"
    >
      <span className="relative flex size-8 shrink-0 items-center justify-center">
        {listening && snap.mic !== "denied" && (
          <span className="absolute inset-0 rounded-full bg-gold-400/50 animate-ripple" aria-hidden="true" />
        )}
        <span
          className={`relative flex size-8 items-center justify-center rounded-full ${
            snap.noteMode ? "bg-clay-500 text-white" : "bg-gold-400 text-navy-950"
          }`}
        >
          {snap.status === "speaking" ? (
            <span className="speaking-bars flex items-center text-navy-950" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          ) : snap.status === "thinking" ? (
            <span className="flex gap-0.5" aria-hidden="true">
              <span className="size-1.5 animate-pulse rounded-full bg-navy-950" />
              <span className="size-1.5 animate-pulse rounded-full bg-navy-950 [animation-delay:150ms]" />
              <span className="size-1.5 animate-pulse rounded-full bg-navy-950 [animation-delay:300ms]" />
            </span>
          ) : snap.mic === "denied" ? (
            <MicOffIcon size={18} />
          ) : (
            <MicIcon size={18} />
          )}
        </span>
      </span>
      <span className="text-lg font-bold">{label}</span>
    </div>
  );
}

/** Bottom dock: what the companion is saying, what was heard, and the voice controls. */
export function VoiceDock({ hint }: { hint?: string }) {
  const { engine, snap } = useVoice();
  const active = snap.active;
  const speaking = snap.status === "speaking";
  const caption = snap.agentLine || hint || "";

  return (
    <div className="sticky bottom-0 z-20 mt-auto">
      <div className="mx-auto w-full max-w-3xl rounded-t-[1.75rem] bg-navy-900 px-4 pt-3 text-ivory-50 shadow-[0_-12px_40px_-20px_rgb(7_16_41/0.6)] safe-bottom md:mb-4 md:rounded-[1.75rem] md:pb-4 md:pt-4">
        {caption ? (
          <p className="mb-2 line-clamp-3 font-display text-lg leading-snug text-ivory-50 md:text-2xl" aria-live="polite">
            {caption}
          </p>
        ) : null}
        {(snap.interim || (snap.heard && active)) && (
          <p className="mb-3 line-clamp-2 text-base text-ivory-200/80">
            {snap.interim ? (
              <>
                <span className="font-bold text-gold-300">Hearing: </span>“{snap.interim}”
              </>
            ) : (
              <>
                <span className="font-bold text-gold-300">You said: </span>“{snap.heard}”
              </>
            )}
          </p>
        )}
        {snap.micMessage && active && <p className="mb-3 text-base font-bold text-gold-200">{snap.micMessage}</p>}

        {!active ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="gold"
              size="lg"
              className="w-full md:min-h-[4.5rem] md:text-2xl"
              icon={<MicIcon size={28} />}
              onClick={() => void engine.start()}
            >
              Start voice
            </Button>
            {snap.playing === "clip" && (
              <Button variant="ivory" size="lg" className="w-full sm:w-auto" icon={<StopIcon size={24} />} onClick={() => engine.stopSpeaking()}>
                Stop playing
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-stretch gap-2">
            <StatusPill snap={snap} />
            {speaking && (
              <Button variant="gold" size="md" icon={<StopIcon size={20} />} onClick={() => engine.stopSpeaking()}>
                Stop speaking
              </Button>
            )}
            <Button variant="ivory" size="md" icon={<DoorIcon size={22} />} onClick={() => void engine.stop({ goodbye: true })}>
              I&apos;m done
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
