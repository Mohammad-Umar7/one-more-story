// Listening: the browser's SpeechRecognition (webkitSpeechRecognition in
// Chrome). Runs continuously while a voice session is on and restarts itself
// when Chrome ends a recognition run (it does so after silences, and after
// every phrase on Android).

/* eslint-disable @typescript-eslint/no-explicit-any */

export type RecognizerError =
  | { kind: "denied"; message: string }
  | { kind: "mic"; message: string }
  | { kind: "transient"; message: string };

export interface RecognizerHandlers {
  onResult: (finals: string[], interim: string) => void;
  onError: (err: RecognizerError) => void;
  onActive?: (active: boolean) => void;
  onSpeechStart?: () => void;
}

export function speechRecognitionSupported(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
}

export class Recognizer {
  private rec: any = null;
  private wanted = false;
  private running = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private recentStarts: number[] = [];
  private networkErrors: number[] = [];
  private reportedFinals = 0;
  lang: string;

  constructor(
    lang: string,
    private handlers: RecognizerHandlers,
  ) {
    this.lang = lang;
  }

  private build(): any {
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.lang = this.lang;

    rec.onstart = () => {
      this.running = true;
      this.reportedFinals = 0;
      this.handlers.onActive?.(true);
    };
    rec.onspeechstart = () => this.handlers.onSpeechStart?.();
    rec.onresult = (event: any) => {
      const finals: string[] = [];
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = String(result[0]?.transcript ?? "").trim();
        if (!text) continue;
        if (result.isFinal) {
          // Each final result is reported exactly once per recognition run.
          if (i >= this.reportedFinals) {
            finals.push(text);
            this.reportedFinals = i + 1;
          }
        } else {
          interim += (interim ? " " : "") + text;
        }
      }
      if (finals.length || interim) this.handlers.onResult(finals, interim);
    };
    rec.onerror = (event: any) => {
      const code = String(event.error ?? "unknown");
      if (code === "no-speech" || code === "aborted") return;
      if (code === "not-allowed" || code === "service-not-allowed") {
        this.wanted = false;
        this.handlers.onError({ kind: "denied", message: "Microphone permission was not given." });
        return;
      }
      if (code === "audio-capture") {
        this.handlers.onError({ kind: "mic", message: "No microphone found, or another app is using it." });
        return;
      }
      if (code === "network") {
        const now = Date.now();
        this.networkErrors = [...this.networkErrors.filter((t) => now - t < 20_000), now];
        // One blip that recovers is not a failure; repeated ones are.
        this.handlers.onError(
          this.networkErrors.length >= 2
            ? { kind: "mic", message: "The speech service is not reachable." }
            : { kind: "transient", message: "Speech service hiccup" },
        );
        return;
      }
      if (code === "language-not-supported") {
        this.wanted = false;
        this.handlers.onError({ kind: "mic", message: `Speech recognition does not support ${this.lang}.` });
        return;
      }
      this.handlers.onError({ kind: "transient", message: code });
    };
    rec.onend = () => {
      this.running = false;
      this.handlers.onActive?.(false);
      if (this.wanted) this.scheduleRestart();
    };
    return rec;
  }

  private scheduleRestart() {
    if (this.restartTimer) return;
    const now = Date.now();
    this.recentStarts = this.recentStarts.filter((t) => now - t < 4000);
    // Back off if Chrome keeps ending immediately (offline, mic busy).
    const delay = this.recentStarts.length >= 4 ? 2500 : this.networkErrors.length ? 1200 : 120;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.wanted && !this.running) this.startNow();
    }, delay);
  }

  private startNow() {
    try {
      if (!this.rec) this.rec = this.build();
      this.rec.lang = this.lang;
      this.recentStarts.push(Date.now());
      this.rec.start();
    } catch {
      // "already started" - harmless; anything else retries via onend
    }
  }

  start(): void {
    if (!speechRecognitionSupported()) return;
    this.wanted = true;
    if (!this.running) this.startNow();
  }

  /** Stop gracefully: the words still being recognised arrive as a final result. */
  finish(): void {
    this.wanted = false;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    try {
      this.rec?.stop();
    } catch {
      // ignore
    }
  }

  /** Stop listening and release the microphone. */
  stop(): void {
    this.wanted = false;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    try {
      this.rec?.abort();
    } catch {
      // ignore
    }
    this.running = false;
  }

  get isRunning(): boolean {
    return this.running;
  }
}
