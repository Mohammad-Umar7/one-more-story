"use client";

import { useVoice } from "./AppProvider";
import { Button } from "./ui";
import { MicIcon, MicOffIcon, StopIcon, DoorIcon } from "./icons";
import type { VoiceSnapshot } from "@/lib/client/voice-engine";

function Bars() {
  return (
    <span className="speaking-bars flex h-5 items-center" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

function StatusPill({ snap }: { snap: VoiceSnapshot }) {
  const tapOnly = snap.recognition === "unsupported" || snap.mic === "denied";
  const label =
    snap.status === "thinking"
      ? "One moment"
      : snap.status === "paused"
        ? "Paused"
        : snap.noteMode
          ? "Recording"
          : tapOnly
            ? "Microphone off"
            : "Listening";
  return (
    <div className="flex min-h-14 flex-1 items-center gap-3 rounded-2xl bg-navy-800 px-4" role="status" aria-live="polite">
      <span className="relative flex size-7 shrink-0 items-center justify-center">
        {snap.status === "listening" && !tapOnly && (
          <span className="absolute inset-0 animate-ripple rounded-full bg-gold-400/50" aria-hidden="true" />
        )}
        <span className={`relative flex size-7 items-center justify-center rounded-full ${snap.noteMode ? "bg-clay-500 text-white" : "bg-gold-400 text-navy-950"}`}>
          {snap.status === "thinking" ? (
            <span className="flex gap-0.5" aria-hidden="true">
              <span className="size-1.5 animate-pulse rounded-full bg-navy-950" />
              <span className="size-1.5 animate-pulse rounded-full bg-navy-950 [animation-delay:150ms]" />
              <span className="size-1.5 animate-pulse rounded-full bg-navy-950 [animation-delay:300ms]" />
            </span>
          ) : tapOnly ? (
            <MicOffIcon size={16} />
          ) : (
            <MicIcon size={16} />
          )}
        </span>
      </span>
      <span className="text-lg font-bold">{label}</span>
    </div>
  );
}

/**
 * Bottom dock: what the companion just said, what it heard, and the voice
 * controls. `screenText` is the question already shown on screen, so it
 * isn't repeated here.
 */
export function VoiceDock({ screenText }: { screenText?: string | null }) {
  const { engine, snap } = useVoice();
  const active = snap.active;
  const caption = snap.agentLine && snap.agentLine !== screenText ? snap.agentLine : "";
  const heard = snap.interim ? { label: "Hearing", text: snap.interim } : active && snap.heard ? { label: "You said", text: snap.heard } : null;

  return (
    <div className="voice-dock sticky bottom-0 z-20 mt-auto">
      <div className="mx-auto w-full max-w-3xl rounded-t-3xl bg-navy-900 px-3 pt-3 text-ivory-50 shadow-[0_-10px_30px_-18px_rgb(7_16_41/0.55)] safe-bottom md:mb-4 md:rounded-3xl md:px-4 md:pb-4">
        {caption && (
          <p className="mb-2 line-clamp-4 px-1 font-display text-lg leading-snug md:text-xl" aria-live="polite">
            {caption}
          </p>
        )}
        {heard && (
          <p className="mb-2 truncate px-1 text-base text-ivory-200/75">
            <span className="font-bold text-gold-300">{heard.label}:</span> &ldquo;{heard.text}&rdquo;
          </p>
        )}
        {active && snap.micMessage && <p className="mb-2 px-1 text-sm font-bold text-gold-200">{snap.micMessage}</p>}

        {!active ? (
          <div className="flex gap-2">
            <Button variant="gold" size="lg" className="flex-1" icon={<MicIcon size={26} />} onClick={() => void engine.start()}>
              Start voice
            </Button>
            {snap.playing === "clip" && (
              <Button variant="ivory" size="lg" icon={<StopIcon size={22} />} onClick={() => engine.stopSpeaking()}>
                Stop
              </Button>
            )}
          </div>
        ) : (
          <div className="flex gap-2">
            {snap.status === "speaking" ? (
              <button
                type="button"
                onClick={() => engine.stopSpeaking()}
                className="flex min-h-14 flex-1 items-center justify-center gap-3 rounded-2xl bg-gold-400 px-4 text-lg font-bold text-navy-950 active:scale-[0.98]"
              >
                <Bars />
                <span className="text-left leading-tight">
                  <span className="block text-sm opacity-75" role="status">
                    Speaking
                  </span>
                  <span className="block">Stop speaking</span>
                </span>
              </button>
            ) : (
              <StatusPill snap={snap} />
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
