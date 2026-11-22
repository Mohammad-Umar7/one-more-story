"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Speaker } from "@/lib/client/speaker";

/**
 * The onboarding guide's voice: says a line out loud (server voice, browser
 * voice as a fallback), shows it as the caption, and lets the orb move with it.
 */
export function useGuide() {
  const speakerRef = useRef<Speaker | null>(null);
  const [line, setLine] = useState<string>("");
  const [speaking, setSpeaking] = useState(false);
  const token = useRef(0);

  const speaker = useCallback(() => {
    if (!speakerRef.current) speakerRef.current = new Speaker();
    return speakerRef.current;
  }, []);

  useEffect(() => () => speakerRef.current?.stop(), []);

  /** Call from a tap so phones allow sound afterwards. */
  const unlock = useCallback(() => speaker().unlock(), [speaker]);

  const say = useCallback(
    async (text: string) => {
      const my = ++token.current;
      setLine(text);
      setSpeaking(true);
      try {
        await speaker().speak(text);
      } finally {
        if (my === token.current) setSpeaking(false);
      }
    },
    [speaker],
  );

  /** Show a line without speaking it. */
  const show = useCallback((text: string) => {
    token.current++;
    speakerRef.current?.stop();
    setSpeaking(false);
    setLine(text);
  }, []);

  const stop = useCallback(() => {
    token.current++;
    speakerRef.current?.stop();
    setSpeaking(false);
  }, []);

  const playClip = useCallback(
    async (url: string) => {
      const my = ++token.current;
      setSpeaking(true);
      try {
        await speaker().playClip(url);
      } finally {
        if (my === token.current) setSpeaking(false);
      }
    },
    [speaker],
  );

  const level = useCallback(() => {
    const s = speakerRef.current;
    if (!s) return { level: 0, real: false, playing: false };
    return { ...s.outputLevel(), playing: s.isPlaying };
  }, []);

  return { line, speaking, say, show, stop, unlock, playClip, level };
}

export type Guide = ReturnType<typeof useGuide>;
