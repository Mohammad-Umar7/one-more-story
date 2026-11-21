"use client";

import { useEffect, useRef, useState } from "react";
import type { MicCapture, Recording } from "@/lib/client/recorder";
import { Button } from "./ui";
import { MicIcon, StopIcon } from "./icons";

/**
 * Tap-to-record, tap-to-stop. Used when the voice session is off, and in
 * Family setup to record clues. Shows a live level meter so people can see
 * they are being heard.
 */
export function RecordButton({
  mic,
  onRecorded,
  label = "Record",
  stopLabel = "Stop recording",
  maxMs = 120_000,
  size = "xl",
  className = "",
  onError,
}: {
  mic: MicCapture;
  onRecorded: (rec: Recording) => void;
  label?: string;
  stopLabel?: string;
  maxMs?: number;
  size?: "xl" | "lg" | "md";
  className?: string;
  onError?: (message: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const raf = useRef<number | null>(null);
  const started = useRef(0);
  const limit = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      if (limit.current) clearTimeout(limit.current);
    };
  }, []);

  const tick = () => {
    setLevel(mic.level());
    setElapsed(Date.now() - started.current);
    raf.current = requestAnimationFrame(tick);
  };

  async function start() {
    const ok = await mic.ensure();
    if (!ok || !mic.begin()) {
      onError?.("The microphone isn't available. Please allow microphone access and try again.");
      return;
    }
    started.current = Date.now();
    setRecording(true);
    raf.current = requestAnimationFrame(tick);
    limit.current = setTimeout(() => void stop(), maxMs);
  }

  async function stop() {
    if (raf.current) cancelAnimationFrame(raf.current);
    if (limit.current) clearTimeout(limit.current);
    raf.current = null;
    setRecording(false);
    setLevel(0);
    const rec = await mic.end();
    mic.release();
    if (rec) onRecorded(rec);
    else onError?.("Nothing was recorded. Please try again a little closer to the microphone.");
  }

  if (!recording) {
    return (
      <Button variant="gold" size={size} className={className} icon={<MicIcon size={26} />} onClick={() => void start()}>
        {label}
      </Button>
    );
  }
  const secs = Math.floor(elapsed / 1000);
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div className="flex items-center gap-3 rounded-2xl bg-clay-500/10 px-4 py-3 text-clay-500" role="status">
        <span className="relative flex size-4">
          <span className="absolute inset-0 animate-ripple rounded-full bg-clay-500/60" />
          <span className="relative size-4 rounded-full bg-clay-500" />
        </span>
        <span className="font-bold">
          Recording {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
        </span>
        <span className="ml-auto flex h-6 items-end gap-0.5" aria-hidden="true">
          {[0.3, 0.6, 1, 0.7, 0.4].map((k, i) => (
            <span key={i} className="w-1.5 rounded bg-clay-500 transition-[height] duration-75" style={{ height: `${Math.max(4, Math.min(24, level * 24 * k + 4))}px` }} />
          ))}
        </span>
      </div>
      <Button variant="navy" size={size} icon={<StopIcon size={22} />} onClick={() => void stop()}>
        {stopLabel}
      </Button>
    </div>
  );
}
