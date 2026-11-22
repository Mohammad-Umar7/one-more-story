"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { VoiceEngine, type ScreenController } from "@/lib/client/voice-engine";
import { getJson } from "@/lib/client/api";
import type { Bundle } from "@/lib/shared/types";
import { PauseOverlay } from "./PauseOverlay";
import { DebugPanel } from "./DebugPanel";
import { WelcomeGate } from "./WelcomeGate";

interface AppContextValue {
  engine: VoiceEngine;
  bundle: Bundle | null;
  loadError: string | null;
  reload: () => Promise<Bundle | null>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [engine] = useState(() => new VoiceEngine());
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  const reload = useCallback(async () => {
    try {
      const b = await getJson<Bundle>("/api/bundle");
      setBundle(b);
      setLoadError(null);
      return b;
    } catch (err) {
      setLoadError((err as Error).message);
      return null;
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!bundle) return;
    engine.configure({
      playerName: bundle.player.name,
      lang: bundle.player.speechLang,
      patience: bundle.player.patience,
      serverVoice: bundle.config.tts,
      browserVoice: !bundle.config.recordedOnly,
    });
  }, [bundle, engine]);

  // "Go home" inside a classic game returns to the classic games list. The
  // companion's own screen has no menu to go back to.
  const pathRef = useRef(pathname);
  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);
  useEffect(() => {
    engine.setNavigator(() => {
      if (pathRef.current.startsWith("/play/")) router.push("/play");
    });
  }, [engine, router]);

  // Leaving the family/caregiver areas or the games ends nothing by itself;
  // but going into the family area turns the player's voice session off.
  useEffect(() => {
    if (pathname.startsWith("/family") || pathname.startsWith("/caregiver")) {
      void engine.stop();
    }
  }, [pathname, engine]);

  // While the companion leads (its own screen, or a game it opened), the
  // player only speaks: game buttons and tap hints are hidden (see globals.css).
  useEffect(() => {
    const led = pathname === "/" || (pathname.startsWith("/play/") && new URLSearchParams(window.location.search).has("chain"));
    if (led) document.documentElement.dataset.voiceOnly = "1";
    else delete document.documentElement.dataset.voiceOnly;
  }, [pathname]);

  useEffect(() => {
    // Phones: release the mic when the screen locks or the app goes to the background.
    const onHide = () => {
      if (document.visibilityState === "hidden" && engine.isActive) engine.pause();
    };
    // Audio playback must be unlocked by a gesture on mobile browsers.
    const unlock = () => engine.unlockAudio();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pointerdown", unlock, { once: true, capture: true });
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pointerdown", unlock, { capture: true });
    };
  }, [engine]);

  const value = useMemo(() => ({ engine, bundle, loadError, reload }), [engine, bundle, loadError, reload]);

  return (
    <AppContext.Provider value={value}>
      {children}
      <WelcomeGate />
      <PauseOverlay />
      <DebugPanel />
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}

export function useVoice() {
  const { engine } = useApp();
  const snap = useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getServerSnapshot);
  return { engine, snap };
}

/**
 * Register the current screen with the voice engine. The controller can be
 * recreated on every render; the engine always calls the latest one.
 */
export function useScreen(ctrl: ScreenController | null) {
  const { engine } = useApp();
  const ref = useRef(ctrl);
  useLayoutEffect(() => {
    ref.current = ctrl;
  });
  const id = ctrl?.id ?? null;
  useEffect(() => {
    if (!id) return;
    const proxy: ScreenController = {
      id,
      context: () => ref.current!.context(),
      act: (a, t, m) => ref.current!.act(a, t, m),
      greeting: () => ref.current?.greeting?.() ?? null,
      repeatLine: () => ref.current?.repeatLine?.() ?? null,
      captureAnswers: () => ref.current?.captureAnswers?.() ?? false,
      onTurnAudio: (turn) => ref.current?.onTurnAudio?.(turn),
      onFailure: (k, d) => ref.current?.onFailure?.(k, d),
      onVoiceEnded: () => ref.current?.onVoiceEnded?.(),
      onIgnored: (turnId) => ref.current?.onIgnored?.(turnId),
      turnPauseMs: () => ref.current?.turnPauseMs?.() ?? null,
    };
    return engine.setScreen(proxy);
  }, [engine, id]);
}
