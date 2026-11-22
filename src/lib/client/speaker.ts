// Speaking: the server's OpenRouter voice first, the browser's own speech
// synthesis as a fallback. Also plays the player's own recordings (clues,
// stories, notes). Every playback can be cut off instantly ("Stop speaking").

export type SpeakResult = {
  ok: boolean; // something was audible
  interrupted: boolean;
  source: "openrouter" | "browser" | null;
};

export type ClipResult = "completed" | "interrupted" | "failed";

let silentUrl: string | null = null;

/** A real 0.1 s silent WAV (some browsers refuse to play a zero-length one). */
function silentWav(): string {
  if (silentUrl) return silentUrl;
  const samples = 800; // 0.1 s at 8 kHz, 8-bit mono
  const buf = new ArrayBuffer(44 + samples);
  const v = new DataView(buf);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(offset + i, s.charCodeAt(i));
  };
  ascii(0, "RIFF");
  v.setUint32(4, 36 + samples, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, 8000, true);
  v.setUint32(28, 8000, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  ascii(36, "data");
  v.setUint32(40, samples, true);
  new Uint8Array(buf, 44).fill(128); // silence for 8-bit audio
  silentUrl = URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
  return silentUrl;
}

type Waiter = { resolve: (interrupted: boolean) => void };

export class Speaker {
  private voiceAudio: HTMLAudioElement | null = null;
  private clipAudio: HTMLAudioElement | null = null;
  private urlCache = new Map<string, string>();
  private pending = new Map<string, Promise<string | null>>();
  private waiter: Waiter | null = null;
  private generation = 0;
  private unlocked = false;
  serverVoice = true; // set false when the server has no TTS key
  lang = "en-US";

  private ensureElements() {
    if (typeof window === "undefined") return;
    if (!this.voiceAudio) {
      this.voiceAudio = new Audio();
      this.voiceAudio.preload = "auto";
    }
    if (!this.clipAudio) {
      this.clipAudio = new Audio();
      this.clipAudio.preload = "auto";
    }
  }

  /** Call inside a user gesture so later playback is allowed (iOS/Android). */
  unlock(): void {
    this.ensureElements();
    if (this.unlocked) return;
    this.unlocked = true;
    for (const el of [this.voiceAudio, this.clipAudio]) {
      if (!el) continue;
      el.src = silentWav();
      el.play().catch(() => undefined);
    }
    try {
      if ("speechSynthesis" in window) {
        const u = new SpeechSynthesisUtterance(" ");
        u.volume = 0;
        window.speechSynthesis.speak(u);
      }
    } catch {
      // ignore
    }
  }

  /**
   * True when this browser lets the page play sound without a tap (an
   * installed app, or a site the person often listens to). Plays silence.
   */
  async canAutoplay(): Promise<boolean> {
    this.ensureElements();
    const el = this.voiceAudio;
    if (!el) return false;
    try {
      el.src = silentWav();
      await el.play();
      el.pause();
      this.unlocked = true;
      return true;
    } catch {
      return false;
    }
  }

  private async fetchVoice(text: string): Promise<string | null> {
    if (!this.serverVoice) return null;
    const cached = this.urlCache.get(text);
    if (cached) return cached;
    const running = this.pending.get(text);
    if (running) return running;
    const p = (async () => {
      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
          signal: AbortSignal.timeout(9000),
        });
        if (res.status === 503) {
          this.serverVoice = false; // not configured: stop asking
          return null;
        }
        if (!res.ok) return null;
        const blob = await res.blob();
        if (blob.size < 100) return null;
        const url = URL.createObjectURL(blob);
        this.urlCache.set(text, url);
        return url;
      } catch {
        return null;
      } finally {
        this.pending.delete(text);
      }
    })();
    this.pending.set(text, p);
    return p;
  }

  /** Warm the cache for lines we know are coming next. */
  prefetch(texts: (string | null | undefined)[]): void {
    for (const t of texts) if (t) void this.fetchVoice(t);
  }

  private wait(): Promise<boolean> {
    return new Promise((resolve) => {
      this.waiter = { resolve };
    });
  }

  private finish(interrupted: boolean) {
    const w = this.waiter;
    this.waiter = null;
    w?.resolve(interrupted);
  }

  private playElement(el: HTMLAudioElement, url: string, onStarted?: () => void): Promise<"ended" | "error" | "stopped"> {
    return new Promise((resolve) => {
      let started = false;
      const cleanup = () => {
        el.onplaying = null;
        el.onended = null;
        el.onerror = null;
      };
      el.onplaying = () => {
        if (!started) {
          started = true;
          onStarted?.();
        }
      };
      el.onended = () => {
        cleanup();
        resolve("ended");
      };
      el.onerror = () => {
        cleanup();
        resolve("error");
      };
      this.waiter = {
        resolve: () => {
          cleanup();
          el.pause();
          resolve("stopped");
        },
      };
      el.src = url;
      el.currentTime = 0;
      el.play().catch(() => {
        cleanup();
        resolve("error");
      });
    });
  }

  /**
   * Fallback voice only (the real voice is Gemini TTS via the server). Pick
   * the most human-sounding voice the device has: neural/"Natural"/Google/
   * premium voices first, the old robotic desktop voices last.
   */
  private pickVoice(): SpeechSynthesisVoice | null {
    if (!("speechSynthesis" in window)) return null;
    const voices = window.speechSynthesis.getVoices();
    const base = this.lang.split("-")[0].toLowerCase();
    const same = voices.filter((v) => v.lang?.toLowerCase().replace("_", "-").startsWith(base));
    if (same.length === 0) return null;
    const score = (v: SpeechSynthesisVoice) => {
      const n = v.name.toLowerCase();
      let s = 0;
      if (/natural|neural/.test(n)) s += 100; // Edge/Windows natural voices
      if (/premium|enhanced|siri/.test(n)) s += 80; // Apple's better voices
      if (/google/.test(n)) s += 60; // Chrome's online voices
      if (/(female|samantha|serena|moira|karen|tessa|sonia|libby|aria|jenny)/.test(n)) s += 8;
      if (!v.localService) s += 10;
      if (v.lang?.toLowerCase().replace("_", "-") === this.lang.toLowerCase()) s += 5;
      if (/desktop|espeak|zira|david|hazel|mark|compact/.test(n)) s -= 60; // robotic
      return s;
    };
    return [...same].sort((a, b) => score(b) - score(a))[0] ?? null;
  }

  private browserSpeak(text: string, gen: number): Promise<"ended" | "error" | "stopped"> {
    return new Promise((resolve) => {
      if (!("speechSynthesis" in window)) return resolve("error");
      const synth = window.speechSynthesis;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const voice = this.pickVoice();
      if (voice) u.voice = voice;
      u.lang = voice?.lang ?? this.lang;
      u.rate = /google|natural|neural/i.test(voice?.name ?? "") ? 0.95 : 0.9;
      u.pitch = 1;
      let done = false;
      const end = (r: "ended" | "error" | "stopped") => {
        if (done) return;
        done = true;
        clearTimeout(safety);
        resolve(r);
      };
      // Chrome sometimes never fires "end"; don't hang the conversation.
      const safety = setTimeout(() => end("ended"), 2500 + text.length * 90);
      u.onend = () => end("ended");
      u.onerror = (e) => end(e.error === "interrupted" || e.error === "canceled" ? "stopped" : "error");
      this.waiter = {
        resolve: () => {
          synth.cancel();
          end("stopped");
        },
      };
      if (gen !== this.generation) return end("stopped");
      synth.speak(u);
    });
  }

  async speak(text: string): Promise<SpeakResult> {
    this.ensureElements();
    this.stop();
    const gen = ++this.generation;
    const url = await this.fetchVoice(text);
    if (gen !== this.generation) return { ok: false, interrupted: true, source: null };
    if (url && this.voiceAudio) {
      const r = await this.playElement(this.voiceAudio, url);
      if (r === "ended") return { ok: true, interrupted: false, source: "openrouter" };
      if (r === "stopped") return { ok: true, interrupted: true, source: "openrouter" };
      // decoding/playback failed: fall through to the browser voice
    }
    if (gen !== this.generation) return { ok: false, interrupted: true, source: null };
    const r = await this.browserSpeak(text, gen);
    return { ok: r !== "error", interrupted: r === "stopped", source: r === "error" ? null : "browser" };
  }

  /** Play one of the player's own recordings. onStarted fires when sound actually starts. */
  async playClip(url: string, onStarted?: () => void): Promise<ClipResult> {
    this.ensureElements();
    this.stop();
    ++this.generation;
    if (!this.clipAudio) return "failed";
    const r = await this.playElement(this.clipAudio, url, onStarted);
    return r === "ended" ? "completed" : r === "stopped" ? "interrupted" : "failed";
  }

  stop(): void {
    this.generation++;
    if (this.waiter) this.finish(true);
    try {
      this.voiceAudio?.pause();
      this.clipAudio?.pause();
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    } catch {
      // ignore
    }
  }
}
