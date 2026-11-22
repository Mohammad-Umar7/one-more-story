"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { canRecord, toWav, VoiceRecorder } from "@/lib/client/audio";
import { MicIcon, StopIcon } from "@/components/icons";
import { Spinner } from "@/components/ui";

export interface RecordPanelProps {
  /** Changes whenever a new recording should start by itself (e.g. after the question is asked). */
  armKey?: string | number | null;
  silenceMs?: number;
  maxMs?: number;
  busy?: boolean;
  busyLabel?: string;
  allowType?: boolean;
  allowUpload?: boolean;
  compact?: boolean;
  recordLabel?: string;
  onRecorded: (wav: Blob, durationMs: number) => Promise<void> | void;
  onTyped?: (text: string) => Promise<void> | void;
}

function Meter({ level }: { level: number }) {
  const bars = [0.35, 0.6, 0.85, 1, 0.85, 0.6, 0.35];
  return (
    <span className="meter flex h-10 items-center gap-1.5" aria-hidden="true">
      {bars.map((b, i) => (
        <span key={i} style={{ height: `${Math.max(6, Math.min(40, 6 + level * 46 * b))}px` }} />
      ))}
    </span>
  );
}

/**
 * Record one answer: starts by itself when armed, stops by itself after a
 * quiet moment (or "I'm finished"). Uploading a ready-made recording and
 * typing are always there too.
 */
export function RecordPanel({
  armKey,
  silenceMs = 3400,
  maxMs = 240_000,
  busy = false,
  busyLabel = "Listening to your answer…",
  allowType = true,
  allowUpload = true,
  compact = false,
  recordLabel = "Record my answer",
  onRecorded,
  onTyped,
}: RecordPanelProps) {
  const recorder = useRef<VoiceRecorder | null>(null);
  const [state, setState] = useState<"idle" | "recording" | "working">("idle");
  const [level, setLevel] = useState(0);
  const [talking, setTalking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const supported = typeof window === "undefined" ? true : canRecord();

  useEffect(() => {
    return () => recorder.current?.close();
  }, []);

  const deliver = useCallback(
    async (raw: Blob) => {
      setState("working");
      try {
        let wav: { blob: Blob; durationMs: number };
        try {
          wav = await toWav(raw);
        } catch {
          // The browser couldn't decode it: send the original and let the server try.
          wav = { blob: raw, durationMs: 0 };
        }
        await onRecorded(wav.blob, wav.durationMs);
      } catch (err) {
        setError((err as Error).message || "That didn't work. Please try again.");
      } finally {
        setState("idle");
      }
    },
    [onRecorded],
  );

  const start = useCallback(async () => {
    if (state !== "idle") return;
    setError(null);
    recorder.current ??= new VoiceRecorder();
    const ok = await recorder.current.open();
    if (!ok) {
      setError("I can't reach the microphone. You can upload a recording or type instead.");
      return;
    }
    setState("recording");
    const res = await recorder.current.record({ silenceMs, maxMs, onLevel: setLevel, onSpeaking: setTalking });
    if (!res) {
      setState("idle");
      return;
    }
    if (!res.heardVoice) {
      setState("idle");
      setError("I didn't hear anything. Tap the microphone and try again.");
      return;
    }
    await deliver(res.blob);
  }, [state, silenceMs, maxMs, deliver]);

  // Start by itself when the question has been asked.
  const lastArm = useRef<RecordPanelProps["armKey"]>(null);
  useEffect(() => {
    if (armKey === null || armKey === undefined || armKey === lastArm.current) return;
    lastArm.current = armKey;
    // Deferred so the recorder starts after this render, not inside it.
    if (supported && !busy) queueMicrotask(() => void start());
  }, [armKey, busy, start, supported]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    await deliver(file);
  };

  const working = busy || state === "working";

  return (
    <div className={`w-full ${compact ? "" : "glass rounded-[2rem] p-5"}`}>
      {working ? (
        <div className="flex min-h-20 items-center justify-center gap-3 text-lg font-bold text-gold-200" role="status">
          <Spinner /> {busyLabel}
        </div>
      ) : state === "recording" ? (
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-4">
            <span className="relative flex size-14 items-center justify-center">
              <span className="absolute inset-0 animate-ripple rounded-full bg-clay-500/50" aria-hidden="true" />
              <span className="relative flex size-12 items-center justify-center rounded-full bg-clay-500 text-navy-950">
                <MicIcon size={24} />
              </span>
            </span>
            <Meter level={level} />
          </div>
          <p className="text-base font-bold text-ivory-200" role="status">
            {talking ? "I'm listening…" : "Go ahead, I'm listening. Take your time."}
          </p>
          <div className="flex w-full gap-2">
            <button
              type="button"
              onClick={() => recorder.current?.stop()}
              className="flex min-h-16 flex-1 items-center justify-center gap-2 rounded-2xl bg-gold-400 px-4 text-lg font-bold text-navy-950 shadow-gold active:scale-[0.98]"
            >
              <StopIcon size={20} /> I&apos;m finished
            </button>
            <button
              type="button"
              onClick={() => recorder.current?.cancel()}
              className="min-h-16 rounded-2xl px-4 text-base font-bold text-ivory-200 underline underline-offset-4"
            >
              Start again
            </button>
          </div>
        </div>
      ) : typing ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!text.trim() || !onTyped) return;
            setState("working");
            try {
              await onTyped(text.trim());
              setText("");
              setTyping(false);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setState("idle");
            }
          }}
        >
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            autoFocus
            className="w-full rounded-2xl border border-white/20 bg-white/10 p-4 text-lg text-ivory-50 placeholder:text-ivory-200/50 focus:border-gold-300 focus:outline-none"
            placeholder="Write it the way you'd say it…"
          />
          <div className="flex gap-2">
            <button type="submit" className="min-h-14 flex-1 rounded-2xl bg-gold-400 px-4 text-lg font-bold text-navy-950 active:scale-[0.98]">
              Send
            </button>
            <button type="button" onClick={() => setTyping(false)} className="min-h-14 rounded-2xl px-4 font-bold text-ivory-200 underline underline-offset-4">
              Back to voice
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col items-center gap-3">
          {supported && (
            <button
              type="button"
              onClick={() => void start()}
              className="flex min-h-[4.5rem] w-full items-center justify-center gap-3 rounded-[1.6rem] bg-gold-400 px-6 text-xl font-bold text-navy-950 shadow-gold active:scale-[0.98]"
            >
              <MicIcon size={28} /> {recordLabel}
            </button>
          )}
          {(allowUpload || (allowType && onTyped)) && (
            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-base font-bold text-ivory-200">
              {allowUpload && (
                <button type="button" onClick={() => fileRef.current?.click()} className="min-h-11 underline underline-offset-4">
                  Upload a recording
                </button>
              )}
              {allowType && onTyped && (
                <button type="button" onClick={() => setTyping(true)} className="min-h-11 underline underline-offset-4">
                  Type instead
                </button>
              )}
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="audio/*,.m4a,.mp3,.wav,.webm,.ogg,.aac"
            className="hidden"
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
      )}
      {error && <p className="mt-3 text-center text-base font-bold text-gold-200">{error}</p>}
    </div>
  );
}
