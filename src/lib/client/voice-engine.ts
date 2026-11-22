// The voice session. One instance lives for the whole app (in the root
// layout), so the player taps "Start voice" once and keeps talking across
// screens. Each game screen registers a ScreenController that says what is on
// the screen and which actions are valid; voice and taps both end up in the
// same controller.act().
//
// Half-duplex with barge-in: the mic stays on while the companion speaks, but
// anything that sounds like the companion's own words is ignored. Different
// words ("the blue bowl") or a stop word ("stop", "wait") cut playback off.

import { Speaker, type ClipResult } from "./speaker";
import { Recognizer, speechRecognitionSupported } from "./recognizer";
import { MicCapture } from "./recorder";
import {
  interpretLocally,
  isInterruptCommand,
  matchGlobalCommand,
  validateDecision,
  type AgentDecision,
  type ConversationTurn,
  type ScreenContext,
} from "../shared/agent";
import { echoOverlap, isOnlyFiller, normalize, soundsUnfinished, words } from "../shared/text";

export type VoiceStatus = "off" | "listening" | "thinking" | "speaking" | "paused";

export interface VoiceSnapshot {
  status: VoiceStatus;
  active: boolean;
  paused: boolean;
  recognition: "supported" | "unsupported";
  mic: "unknown" | "ok" | "denied" | "error";
  micMessage: string | null;
  interim: string;
  heard: string;
  agentLine: string;
  playing: "voice" | "clip" | null;
  voiceSource: "openrouter" | "browser" | null;
  capturing: boolean;
  noteMode: boolean;
  lastDecision: (AgentDecision & { utterance: string }) | null;
}

export interface CapturedTurn {
  blob: Blob;
  mime: string;
  durationMs: number;
  transcript: string;
  turnId: number;
}

export interface ActMeta {
  source: "voice" | "tap";
  say: string;
  utterance: string | null;
  decision?: AgentDecision;
}

export interface ActResult {
  speak?: string | null;
}

export interface ScreenController {
  id: string;
  context(): ScreenContext;
  act(action: string, target: string | null, meta: ActMeta): Promise<ActResult | void> | ActResult | void;
  greeting?(): string | null;
  repeatLine?(): string | null;
  captureAnswers?(): boolean;
  onTurnAudio?(turn: CapturedTurn): void;
  onFailure?(kind: "mic" | "playback", detail: string): void;
  /** That turn was talk meant for someone else: forget it (e.g. drop its recording). */
  onIgnored?(turnId: number): void;
  onVoiceEnded?(): void;
}

const GLOBAL = new Set(["pause", "end_session", "repeat", "go_home"]);
const CANCEL_RE = /^(cancel|never mind|nevermind|forget it|no thanks|no thank you)$/;

const initial: VoiceSnapshot = {
  status: "off",
  active: false,
  paused: false,
  recognition: "supported",
  mic: "unknown",
  micMessage: null,
  interim: "",
  heard: "",
  agentLine: "",
  playing: null,
  voiceSource: null,
  capturing: false,
  noteMode: false,
  lastDecision: null,
};

export class VoiceEngine {
  private speaker = new Speaker();
  private recognizer: Recognizer | null = null;
  readonly mic = new MicCapture();
  private screen: ScreenController | null = null;
  private listeners = new Set<() => void>();
  private snap: VoiceSnapshot = initial;

  history: ConversationTurn[] = [];
  playerName = "friend";
  lang = "en-US";
  patience: "normal" | "extra" = "normal";
  navigateHome: (() => void) | null = null;

  private finals: string[] = [];
  private interim = "";
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private turnStartedAt = 0;
  private turnId = 0;
  private busy = false;
  private queued: string[] = [];
  private playbackText: string | null = null;
  private playbackKind: "voice" | "clip" | null = null;
  private lastSpokenText = "";
  private echoGuardUntil = 0;
  private hardGuardUntil = 0;
  private swallowText = "";
  private swallowUntil = 0;
  private clarify = { version: "", count: 0 };
  private sessionGen = 0;
  private lineToken = 0; // the newest playback owns the state; older ones just exit
  private starting = false;
  private micBlocked = false; // permission denied: voice is unavailable, the player taps instead
  private noteResolver: ((t: CapturedTurn | null) => void) | null = null;

  // ---- store plumbing (useSyncExternalStore) ------------------------------
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.snap;
  getServerSnapshot = () => initial;
  private set(patch: Partial<VoiceSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    this.listeners.forEach((l) => l());
  }

  configure(opts: { playerName?: string; lang?: string; patience?: "normal" | "extra"; serverVoice?: boolean }) {
    if (opts.playerName) this.playerName = opts.playerName;
    if (opts.lang) {
      this.lang = opts.lang;
      this.speaker.lang = opts.lang;
      if (this.recognizer) this.recognizer.lang = opts.lang;
    }
    if (opts.patience) this.patience = opts.patience;
    if (opts.serverVoice !== undefined) this.speaker.serverVoice = opts.serverVoice;
  }

  setNavigator(fn: () => void) {
    this.navigateHome = fn;
  }

  get isActive(): boolean {
    return this.snap.active && !this.snap.paused;
  }

  prefetch(texts: (string | null | undefined)[]) {
    if (this.snap.active) this.speaker.prefetch(texts);
  }

  unlockAudio() {
    this.speaker.unlock();
  }

  /** Loudness of the companion's voice right now, for the talking avatar. */
  outputLevel(): { level: number; real: boolean; playing: boolean } {
    return { ...this.speaker.outputLevel(), playing: this.speaker.isPlaying };
  }

  /**
   * Can the companion start talking the moment the app opens, with no tap?
   * Only when the natural voice is set up (the browser's own voice always
   * needs a tap), the microphone was already allowed, and the browser lets
   * this site play sound on its own.
   */
  async canStartWithoutTap(naturalVoiceConfigured: boolean): Promise<boolean> {
    if (!naturalVoiceConfigured || this.snap.active) return false;
    if (speechRecognitionSupported()) {
      try {
        const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
        // Allowed, or not asked yet (the browser asks once): only a refusal needs a touch.
        if (status.state === "denied") return false;
      } catch {
        return false;
      }
    }
    return this.speaker.canAutoplay();
  }

  // ---- screens -------------------------------------------------------------
  setScreen(ctrl: ScreenController): () => void {
    this.screen = ctrl;
    this.clarify = { version: "", count: 0 };
    if (this.isActive && !this.starting) {
      this.speaker.stop();
      this.resetTurn();
      this.mic.cancel();
      const greeting = ctrl.greeting?.();
      if (greeting) void this.speakLine(greeting);
      else this.enterListening();
    }
    if (this.isActive && ctrl.captureAnswers?.()) void this.mic.ensure();
    return () => {
      if (this.screen === ctrl) {
        this.screen = null;
        this.mic.cancel();
        if (this.noteResolver) this.resolveNote(null);
      }
    };
  }

  // ---- session lifecycle ---------------------------------------------------
  /**
   * Turn the voice on. `silent`: don't speak the screen's greeting, because
   * the screen leads the conversation itself (the companion).
   */
  async start(opts: { silent?: boolean } = {}): Promise<void> {
    if (this.snap.active) {
      if (this.snap.paused) await this.resume({ quiet: opts.silent });
      return;
    }
    this.speaker.unlock();
    const gen = ++this.sessionGen;
    this.starting = true;
    this.history = [];
    this.resetTurn();
    const supported = speechRecognitionSupported();
    this.set({
      active: true,
      paused: false,
      status: "listening",
      recognition: supported ? "supported" : "unsupported",
      mic: "unknown",
      micMessage: supported ? null : "This browser can't listen. Please open the app in Chrome.",
      heard: "",
      interim: "",
    });
    this.micBlocked = false;
    if (supported) {
      this.recognizer = new Recognizer(this.lang, {
        onResult: (f, i) => this.onHeard(f, i),
        onError: (e) => {
          if (e.kind === "transient") return;
          if (e.kind === "denied") {
            // A choice, not a malfunction: carry on in tap mode, nothing is excluded.
            this.micBlocked = true;
            this.set({ mic: "denied", micMessage: "The microphone is off, so I can't hear you. Please allow the microphone for this site." });
            return;
          }
          // A real failure (no mic, mic busy, speech service down) affects the round.
          this.set({ mic: "error", micMessage: e.message });
          this.screen?.onFailure?.("mic", e.message);
        },
        onActive: (on) => {
          if (on && this.snap.mic !== "ok") this.set({ mic: "ok", micMessage: null });
        },
      });
      this.recognizer.start();
    }
    if (this.screen?.captureAnswers?.()) await this.mic.ensure();
    if (gen !== this.sessionGen) return;
    this.starting = false;
    if (opts.silent) {
      this.enterListening();
      return;
    }
    const greeting = this.screen?.greeting?.() ?? "Hello. I'm listening.";
    await this.speakLine(greeting);
  }

  /** Resolves once the voice session is on and not paused (or after `timeoutMs`). */
  waitUntilActive(timeoutMs = 600_000): Promise<boolean> {
    if (this.isActive) return Promise.resolve(true);
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        off();
        resolve(false);
      }, timeoutMs);
      const off = this.subscribe(() => {
        if (this.isActive) {
          clearTimeout(t);
          off();
          resolve(true);
        }
      });
    });
  }

  /** "I'm done": stop listening, release the microphone, say goodbye. */
  async stop(opts: { goodbye?: boolean } = {}): Promise<void> {
    if (!this.snap.active && !this.snap.paused) return;
    this.sessionGen++;
    this.starting = false;
    this.clearTimer();
    this.recognizer?.stop();
    this.recognizer = null;
    this.mic.release();
    this.speaker.stop();
    this.busy = false;
    this.queued = [];
    if (this.noteResolver) this.resolveNote(null);
    this.resetTurn();
    this.set({ active: false, paused: false, status: "off", interim: "", capturing: false, noteMode: false, playing: null });
    this.screen?.onVoiceEnded?.();
    if (opts.goodbye) {
      const line = `Thank you, ${this.playerName}. That was lovely. Talk again soon.`;
      this.set({ agentLine: line });
      await this.speaker.speak(line); // the mic is already off
    }
  }

  pause(): void {
    if (this.snap.paused) return;
    this.sessionGen++;
    this.clearTimer();
    this.speaker.stop();
    this.recognizer?.stop(); // releases the mic while paused
    this.mic.release();
    this.busy = false;
    this.queued = [];
    if (this.noteResolver) this.resolveNote(null);
    this.resetTurn();
    this.set({ paused: true, status: "paused", interim: "", playing: null, capturing: false, noteMode: false });
  }

  async resume(opts: { quiet?: boolean } = {}): Promise<void> {
    if (!this.snap.paused) return;
    const active = this.snap.active;
    this.set({ paused: false, status: active ? "listening" : "off" });
    if (!active) return;
    this.sessionGen++;
    if (!this.micBlocked) this.recognizer?.start();
    if (opts.quiet) return; // e.g. "Home" from the pause screen: the next screen greets instead
    if (this.screen?.captureAnswers?.()) await this.mic.ensure();
    const q = this.screen?.repeatLine?.() ?? this.screen?.context().question ?? null;
    await this.speakLine(q ? `Let's carry on. ${q}` : "Let's carry on.");
  }

  stopSpeaking(): void {
    this.speaker.stop();
  }

  // ---- speaking --------------------------------------------------------------
  /** Speak if a voice session is on; otherwise just show the words. */
  async say(text: string | null | undefined): Promise<void> {
    if (!text) return;
    if (!this.isActive) {
      this.set({ agentLine: text });
      return;
    }
    await this.speakLine(text);
  }

  private async speakLine(text: string): Promise<void> {
    const gen = this.sessionGen;
    const token = ++this.lineToken;
    if (this.mic.recording && !this.turnStartedAt) {
      this.mic.cancel();
      this.set({ capturing: false });
    }
    this.pushHistory("assistant", text);
    this.playbackText = text;
    this.playbackKind = "voice";
    this.set({ status: "speaking", agentLine: text, playing: "voice" });
    const res = await this.speaker.speak(text);
    if (gen !== this.sessionGen || token !== this.lineToken) return;
    this.playbackText = null;
    this.playbackKind = null;
    this.lastSpokenText = text;
    this.echoGuardUntil = Date.now() + 1600;
    this.set({ playing: null, voiceSource: res.source ?? this.snap.voiceSource });
    if (!res.ok && !res.interrupted) this.screen?.onFailure?.("playback", "The companion's voice could not be played");
    if (this.snap.status === "speaking") this.enterListening();
  }

  /** Play one of the player's own recordings. Works with voice on or off. */
  async playClip(url: string, opts: { knownText?: string | null; onStarted?: () => void } = {}): Promise<ClipResult> {
    const gen = this.sessionGen;
    const token = ++this.lineToken;
    this.clearTimer();
    this.resetTurn();
    if (this.mic.recording) {
      this.mic.cancel();
      this.set({ capturing: false });
    }
    this.playbackKind = "clip";
    this.playbackText = opts.knownText ?? null;
    this.set({ status: this.isActive ? "speaking" : this.snap.status, playing: "clip" });
    const result = await this.speaker.playClip(url, opts.onStarted);
    if (token !== this.lineToken) return result; // a newer line already took over
    this.playbackKind = null;
    this.playbackText = null;
    if (opts.knownText) this.lastSpokenText = opts.knownText;
    this.echoGuardUntil = Date.now() + 1600;
    // The recording is the player's own voice: never let its tail count as an answer.
    this.hardGuardUntil = Date.now() + (opts.knownText ? 900 : 1800);
    this.set({ playing: null });
    if (gen === this.sessionGen && this.isActive) {
      if (this.recognizer && !this.micBlocked) {
        this.recognizer.stop();
        this.recognizer.start(); // flush anything heard during the clip
      }
      if (this.snap.status === "speaking") this.enterListening();
    }
    return result;
  }

  // ---- listening -------------------------------------------------------------
  private enterListening() {
    if (!this.isActive) return;
    this.set({ status: this.busy ? "thinking" : "listening" });
    if (this.screen?.captureAnswers?.() || this.noteResolver) {
      void this.mic.ensure().then((ok) => {
        if (ok && this.isActive && this.snap.status === "listening" && !this.mic.recording) {
          this.set({ capturing: this.mic.begin() });
        }
      });
    }
  }

  private clearTimer() {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnTimer = null;
  }

  private resetTurn() {
    this.clearTimer();
    this.finals = [];
    this.interim = "";
    this.turnStartedAt = 0;
    if (this.snap.interim) this.set({ interim: "" });
  }

  private onHeard(finals: string[], interim: string) {
    if (!this.isActive) return;
    const now = Date.now();
    if (this.playbackKind) {
      this.whilePlaying(finals, interim);
      return;
    }
    if (now < this.hardGuardUntil) return;
    let fresh = finals;
    if (now < this.echoGuardUntil && this.lastSpokenText) {
      fresh = fresh.filter((f) => echoOverlap(f, this.lastSpokenText) < 0.5);
      if (interim && echoOverlap(interim, this.lastSpokenText) >= 0.5) interim = "";
    }
    if (now < this.swallowUntil && this.swallowText) {
      fresh = fresh.filter((f) => echoOverlap(f, this.swallowText) < 0.7);
      if (interim && echoOverlap(interim, this.swallowText) >= 0.7) interim = "";
    }
    if (this.busy) {
      if (fresh.length) this.queued.push(...fresh);
      return;
    }
    if (!fresh.length && !interim) return;
    if (!this.turnStartedAt) this.turnStartedAt = now;
    this.finals.push(...fresh);
    this.interim = interim;
    this.set({ interim: [...this.finals, interim].join(" ").trim(), status: "listening" });
    this.armTimer();
  }

  private whilePlaying(finals: string[], interim: string) {
    const heard = [...finals, interim].join(" ").trim();
    if (!heard) return;
    const ctx = this.screen?.context();
    if (isInterruptCommand(heard)) {
      this.swallowText = heard;
      this.swallowUntil = Date.now() + 2500;
      this.speaker.stop();
      const global = ctx ? matchGlobalCommand(heard, ctx) : null;
      if (global?.action === "end_session") void this.stop({ goodbye: true });
      else if (global?.action === "pause") this.pause();
      return;
    }
    if (this.playbackText === null) return; // a recording with unknown words: only stop words interrupt
    const n = words(heard).length;
    const overlap = echoOverlap(heard, this.playbackText);
    // Echo comes back as mostly our own words; a reply shares one word at most.
    const bargeIn = (n >= 2 && overlap <= 0.34) || (n >= 4 && overlap < 0.5);
    if (!bargeIn) return; // that's our own voice coming back
    const spoken = this.playbackText;
    this.speaker.stop();
    this.finals = finals.filter((f) => echoOverlap(f, spoken) < 0.5);
    this.interim = echoOverlap(interim, spoken) < 0.5 ? interim : "";
    this.turnStartedAt = Date.now();
    this.set({ interim: [...this.finals, this.interim].join(" ").trim() });
    this.armTimer();
  }

  private armTimer() {
    this.clearTimer();
    const text = [...this.finals, this.interim].join(" ");
    let wait = this.noteResolver ? 3200 : this.patience === "extra" ? 2300 : 1300;
    if (this.interim && this.finals.length === 0) wait += 700; // Chrome hasn't finalised yet
    if (soundsUnfinished(text)) wait += 1500;
    if (isOnlyFiller(text)) wait += 2500;
    this.turnTimer = setTimeout(() => this.finishTurn(), wait);
  }

  /** End the current spoken turn right away (e.g. the "I'm finished" button while recording a note). */
  finishTurnNow() {
    if (this.finals.length || this.interim) this.finishTurn();
    else if (this.noteResolver) {
      void this.mic.end().then((rec) => {
        this.resolveNote(rec ? { ...rec, transcript: "", turnId: ++this.turnId } : null);
      });
    }
  }

  private finishTurn() {
    this.clearTimer();
    const usedInterim = Boolean(this.interim);
    const text = [...this.finals, this.interim].join(" ").replace(/\s+/g, " ").trim();
    this.finals = [];
    this.interim = "";
    this.turnStartedAt = 0;
    this.set({ interim: "" });
    if (!text || isOnlyFiller(text)) return;
    if (usedInterim) {
      // Chrome may still deliver the final version of these words: don't double count.
      this.swallowText = text;
      this.swallowUntil = Date.now() + 2500;
    }
    void this.handleTurn(text);
  }

  private drainQueue() {
    if (!this.queued.length || !this.isActive) return;
    this.finals = this.queued;
    this.queued = [];
    this.turnStartedAt = Date.now();
    this.armTimer();
  }

  private resolveNote(turn: CapturedTurn | null) {
    const r = this.noteResolver;
    this.noteResolver = null;
    this.set({ noteMode: false, capturing: false });
    r?.(turn);
  }

  /** Voice mode: the player's next turn is recorded as a note, not interpreted. */
  recordNote(): Promise<CapturedTurn | null> {
    if (!this.isActive) return Promise.resolve(null);
    if (this.noteResolver) this.resolveNote(null);
    return new Promise((resolve) => {
      this.noteResolver = resolve;
      this.set({ noteMode: true });
      this.enterListening();
    });
  }

  cancelNote() {
    if (!this.noteResolver) return;
    this.mic.cancel();
    this.resetTurn();
    this.resolveNote(null);
  }

  private async handleTurn(text: string): Promise<void> {
    const gen = this.sessionGen;
    const turnId = ++this.turnId;
    this.set({ heard: text });

    let captured: CapturedTurn | null = null;
    if (this.mic.recording) {
      const rec = await this.mic.end();
      this.set({ capturing: false });
      if (rec) captured = { ...rec, transcript: text, turnId };
    }
    if (gen !== this.sessionGen) return;

    const ctx = this.screen?.context();
    if (this.noteResolver) {
      this.pushHistory("player", text);
      // A bare "I'm done" still ends the session (and releases the mic).
      if (ctx && matchGlobalCommand(text, ctx)?.action === "end_session" && words(text).length <= 5) {
        this.resolveNote(null);
        await this.stop({ goodbye: true });
        return;
      }
      this.resolveNote(CANCEL_RE.test(normalize(text)) ? null : captured ?? { blob: new Blob(), mime: "", durationMs: 0, transcript: text, turnId });
      return;
    }

    if (!ctx) return;
    this.pushHistory("player", text);
    if (captured) this.screen?.onTurnAudio?.(captured);

    const fast = matchGlobalCommand(text, ctx);
    if (fast) {
      this.set({ lastDecision: { ...fast, utterance: text } });
      await this.runGlobal(fast.action);
      return;
    }

    if (this.clarify.version !== ctx.version) this.clarify = { version: ctx.version, count: 0 };
    this.busy = true;
    this.set({ status: "thinking" });
    let decision = await this.interpret(ctx, text);
    this.busy = false;
    if (gen !== this.sessionGen || !this.isActive) return;

    const current = this.screen?.context();
    if (!current || current.version !== ctx.version) {
      // The screen moved on while we were thinking (the player tapped).
      this.enterListening();
      this.drainQueue();
      return;
    }
    decision = validateDecision(decision, current);
    this.set({ lastDecision: { ...decision, utterance: text } });

    if (decision.action === "ignore") {
      // Talk meant for someone else in the room: say nothing, keep listening.
      this.history = this.history.filter((h, i, arr) => !(i === arr.length - 1 && h.role === "player" && h.text === text));
      this.screen?.onIgnored?.(turnId);
      this.enterListening();
      this.drainQueue();
      return;
    }

    if (GLOBAL.has(decision.action)) {
      await this.runGlobal(decision.action);
      return;
    }
    if (decision.action === "none") {
      if (decision.needsClarification) this.clarify.count++;
      const line =
        decision.say ||
        (decision.needsClarification ? "Sorry, I didn't quite catch that. You can tap your answer too." : "");
      if (line) await this.speakLine(line);
      else this.enterListening();
      this.drainQueue();
      return;
    }
    this.clarify.count = 0;
    const result = await this.screen?.act(decision.action, decision.target, {
      source: "voice",
      say: decision.say,
      utterance: text,
      decision,
    });
    if (gen !== this.sessionGen) return;
    const speech = result && "speak" in result ? result.speak : decision.say || null;
    if (speech) await this.speakLine(speech);
    else if (this.snap.status !== "speaking") this.enterListening();
    this.drainQueue();
  }

  private async interpret(ctx: ScreenContext, text: string): Promise<AgentDecision> {
    const body = {
      context: ctx,
      utterance: text,
      history: this.history.slice(-10),
      playerName: this.playerName,
      clarifications: this.clarify.count,
    };
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(14_000),
      });
      if (!res.ok) throw new Error(`agent ${res.status}`);
      return (await res.json()) as AgentDecision;
    } catch {
      return interpretLocally(body);
    }
  }

  private async runGlobal(action: string) {
    switch (action) {
      case "pause":
        await this.speakLine("Of course. I'll wait right here.");
        this.pause();
        return;
      case "end_session":
        await this.stop({ goodbye: true });
        return;
      case "repeat": {
        const line = this.screen?.repeatLine?.() ?? this.screen?.context().question ?? this.snap.agentLine;
        if (line) await this.speakLine(line);
        else this.enterListening();
        return;
      }
      case "go_home":
        this.speaker.stop();
        this.navigateHome?.();
        return;
    }
  }

  /** A tap on screen: same action path as voice. */
  async tap(action: string, target: string | null = null): Promise<void> {
    this.speaker.stop();
    this.resetTurn();
    if (this.mic.recording && !this.noteResolver) {
      this.mic.cancel();
      this.set({ capturing: false });
    }
    if (GLOBAL.has(action)) {
      if (action === "pause") this.pause();
      else await this.runGlobal(action);
      return;
    }
    const gen = this.sessionGen;
    const result = await this.screen?.act(action, target, { source: "tap", say: "", utterance: null });
    if (gen !== this.sessionGen) return;
    if (result && result.speak) await this.say(result.speak);
    else if (this.isActive && this.snap.status !== "speaking") this.enterListening();
  }

  private pushHistory(role: ConversationTurn["role"], text: string) {
    this.history.push({ role, text });
    if (this.history.length > 16) this.history = this.history.slice(-16);
  }

  /** Debug/testing: behave as if the player had said this. */
  simulateHeard(text: string, immediate = true) {
    if (!this.isActive) return;
    this.onHeard([text], "");
    if (immediate && !this.playbackKind) this.finishTurn();
  }
}
