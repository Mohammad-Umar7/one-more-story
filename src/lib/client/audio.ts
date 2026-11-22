// Browser audio helpers for the family's recordings.
//
// - toWav(): any recording or uploaded file (WebM from Chrome, M4A from an
//   iPhone voice memo, MP3...) becomes 16 kHz mono WAV, which every browser
//   can play back and the AI can always listen to.
// - VoiceRecorder: records one answer and stops by itself after the speaker
//   has been quiet for a moment (or when they tap "I'm finished"), with a
//   live level for the on-screen meter.

const TARGET_RATE = 16_000;

function encodeWav(samples: Float32Array, rate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const ascii = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  ascii(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  ascii(36, "data");
  v.setUint32(40, samples.length * 2, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}

/** Decode, mix to mono, resample to 16 kHz, gently normalise, encode as WAV. */
export async function toWav(input: Blob): Promise<{ blob: Blob; durationMs: number }> {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();
  try {
    const decoded = await ctx.decodeAudioData(await input.arrayBuffer());
    const frames = Math.ceil(decoded.duration * TARGET_RATE);
    const offline = new OfflineAudioContext(1, Math.max(1, frames), TARGET_RATE);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start();
    const rendered = await offline.startRendering();
    const data = rendered.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
    if (peak > 0.02 && peak < 0.7) {
      const gain = 0.85 / peak;
      for (let i = 0; i < data.length; i++) data[i] *= gain;
    }
    return { blob: encodeWav(data, TARGET_RATE), durationMs: Math.round(decoded.duration * 1000) };
  } finally {
    void ctx.close().catch(() => undefined);
  }
}

function pickMime(): string {
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      // ignore
    }
  }
  return "";
}

export function canRecord(): boolean {
  return typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

export interface RecordOptions {
  /** Stop after this much quiet once they have started talking. */
  silenceMs?: number;
  /** Give up if they never start talking. */
  waitMs?: number;
  maxMs?: number;
  onLevel?: (level: number) => void;
  onSpeaking?: (speaking: boolean) => void;
}

export type RecordResult = { blob: Blob; durationMs: number; heardVoice: boolean } | null;

export class VoiceRecorder {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private recorder: MediaRecorder | null = null;
  private raf = 0;
  private stopper: (() => void) | null = null;
  private cancelled = false;

  async open(): Promise<boolean> {
    if (this.stream?.getAudioTracks().some((t) => t.readyState === "live")) return true;
    if (!canRecord()) return false;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      const src = this.ctx.createMediaStreamSource(this.stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      src.connect(this.analyser);
      return true;
    } catch {
      return false;
    }
  }

  get isRecording(): boolean {
    return this.recorder?.state === "recording";
  }

  private level(): number {
    if (!this.analyser) return 0;
    const data = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const x of data) sum += ((x - 128) / 128) ** 2;
    return Math.min(1, Math.sqrt(sum / data.length) * 5);
  }

  /** Record until quiet (or stop()). Resolves with raw audio, not yet WAV. */
  async record(opts: RecordOptions = {}): Promise<RecordResult> {
    if (!(await this.open()) || !this.stream) return null;
    if (this.ctx?.state === "suspended") await this.ctx.resume().catch(() => undefined);
    const silenceMs = opts.silenceMs ?? 3200;
    const waitMs = opts.waitMs ?? 20_000;
    const maxMs = opts.maxMs ?? 240_000;
    const mime = pickMime();
    const rec = mime ? new MediaRecorder(this.stream, { mimeType: mime }) : new MediaRecorder(this.stream);
    this.recorder = rec;
    this.cancelled = false;
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    const started = Date.now();
    let heardVoice = false;
    let voiceRun = 0;
    let lastVoice = 0;
    let speaking = false;
    // Adapt to the room: the quietest level we see is the floor.
    let floor = 0.03;

    return new Promise<RecordResult>((resolve) => {
      const finish = () => {
        cancelAnimationFrame(this.raf);
        this.stopper = null;
        if (rec.state === "recording") rec.stop();
      };
      this.stopper = finish;
      rec.onstop = () => {
        opts.onLevel?.(0);
        opts.onSpeaking?.(false);
        if (this.cancelled) return resolve(null);
        const blob = new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" });
        resolve(blob.size > 1000 ? { blob, durationMs: Date.now() - started, heardVoice } : null);
      };
      let last = performance.now();
      const tick = (now: number) => {
        const dt = now - last;
        last = now;
        const l = this.level();
        // Falls quickly to quiet moments, rises only slowly with speech.
        floor = Math.min(0.12, l < floor ? floor * 0.9 + l * 0.1 : floor * 0.999 + l * 0.001);
        const threshold = Math.max(0.06, floor * 2.5);
        opts.onLevel?.(l);
        if (l > threshold) {
          voiceRun += dt;
          if (voiceRun > 250) {
            heardVoice = true;
            lastVoice = Date.now();
            if (!speaking) {
              speaking = true;
              opts.onSpeaking?.(true);
            }
          }
        } else {
          voiceRun = Math.max(0, voiceRun - dt * 0.5);
          if (speaking && Date.now() - lastVoice > 700) {
            speaking = false;
            opts.onSpeaking?.(false);
          }
        }
        const elapsed = Date.now() - started;
        if (elapsed > maxMs) return finish();
        if (heardVoice && Date.now() - lastVoice > silenceMs) return finish();
        if (!heardVoice && elapsed > waitMs) return finish();
        this.raf = requestAnimationFrame(tick);
      };
      rec.start(250);
      this.raf = requestAnimationFrame(tick);
    });
  }

  /** "I'm finished": stop now and keep what was said. */
  stop(): void {
    this.stopper?.();
  }

  /** Throw the current recording away. */
  cancel(): void {
    this.cancelled = true;
    this.stopper?.();
  }

  close(): void {
    this.cancel();
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.analyser = null;
    if (this.ctx) void this.ctx.close().catch(() => undefined);
    this.ctx = null;
  }
}
