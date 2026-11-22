"use client";

import { useEffect } from "react";
import { useVoice } from "./AppProvider";
import { MicIcon } from "./icons";

/**
 * Hold to talk: the player presses and holds while speaking, and lets go when
 * they are done. Space does the same on a keyboard. Nothing is heard while
 * the button is up, so other people talking in the room are never answered.
 */
export function HoldToTalk({ className = "" }: { className?: string }) {
  const { engine, snap } = useVoice();
  const ready = snap.active && !snap.paused && snap.ptt;

  // Space bar = the button (for a laptop demo).
  useEffect(() => {
    if (!ready) return;
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || typing(e)) return;
      e.preventDefault();
      engine.pttStart();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space" || typing(e)) return;
      e.preventDefault();
      engine.pttEnd();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [engine, ready]);

  if (!ready) return null;
  const holding = snap.holding;
  const thinking = snap.status === "thinking";
  const label = holding ? "Listening… let go when you're done" : thinking ? "One moment…" : snap.status === "speaking" ? "Hold to answer" : "Hold to talk";

  return (
    <div className={`ptt flex flex-col items-center gap-2 ${className}`}>
      <button
        type="button"
        onPointerDown={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLButtonElement).setPointerCapture?.(e.pointerId);
          engine.unlockAudio();
          engine.pttStart();
        }}
        onPointerUp={() => engine.pttEnd()}
        onPointerCancel={() => engine.pttEnd()}
        onLostPointerCapture={() => engine.pttEnd()}
        onContextMenu={(e) => e.preventDefault()}
        aria-pressed={holding}
        aria-label={label}
        className={`ptt-button relative flex size-24 select-none items-center justify-center rounded-full text-white transition-transform duration-150 md:size-28 ${
          holding ? "scale-110 bg-gradient-to-b from-[#f472b6] to-[#db2777] shadow-[0_0_0_10px_rgb(244_114_182/0.25),0_18px_40px_-12px_rgb(219_39_119/0.7)]" : "bg-gradient-to-b from-[#a78bfa] to-[#7c3aed] shadow-[0_18px_40px_-12px_rgb(124_58_237/0.7)]"
        }`}
        style={{ touchAction: "none", WebkitUserSelect: "none" }}
      >
        {holding && <span className="absolute inset-0 animate-ripple rounded-full bg-[#f472b6]/50" aria-hidden="true" />}
        <MicIcon size={44} />
      </button>
      <p className="text-center text-lg font-bold" role="status" aria-live="polite">
        {label}
      </p>
      {snap.interim && holding && <p className="max-w-md text-center text-base opacity-80">&ldquo;{snap.interim}&rdquo;</p>}
    </div>
  );
}
