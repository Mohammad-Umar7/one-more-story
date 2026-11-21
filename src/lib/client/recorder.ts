// Recording the player's own voice (clues, stories, tour notes) with
// MediaRecorder. The stream uses echo cancellation and is released as soon as
// the screen or the voice session no longer needs it.

export interface Recording {
  blob: Blob;
  mime: string;
  durationMs: number;
}

export function recordingSupported(): boolean {
  return typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

function pickMime(): string {
  const options = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  for (const m of options) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      // ignore
    }
  }
  return "";
}

export class MicCapture {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private stopResolver: ((r: Recording | null) => void) | null = null;
  private analyser: AnalyserNode | null = null;
  private audioCtx: AudioContext | null = null;
  broken = false;

  async ensure(): Promise<boolean> {
    if (this.stream && this.stream.getAudioTracks().some((t) => t.readyState === "live")) return true;
    if (!recordingSupported()) {
      this.broken = true;
      return false;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      this.broken = false;
      return true;
    } catch {
      this.broken = true;
      return false;
    }
  }

  get recording(): boolean {
    return this.recorder?.state === "recording";
  }

  begin(): boolean {
    if (!this.stream || this.recording) return this.recording;
    try {
      const mime = pickMime();
      this.recorder = mime ? new MediaRecorder(this.stream, { mimeType: mime }) : new MediaRecorder(this.stream);
      this.chunks = [];
      this.recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) this.chunks.push(e.data);
      };
      this.recorder.onstop = () => {
        const type = this.recorder?.mimeType || mime || "audio/webm";
        const blob = new Blob(this.chunks, { type });
        const r = this.stopResolver;
        this.stopResolver = null;
        r?.(blob.size > 800 ? { blob, mime: type, durationMs: Date.now() - this.startedAt } : null);
      };
      this.startedAt = Date.now();
      this.recorder.start(250);
      return true;
    } catch {
      this.broken = true;
      return false;
    }
  }

  /** Stop and return what was recorded (null if nothing useful). */
  end(): Promise<Recording | null> {
    if (!this.recorder || this.recorder.state !== "recording") return Promise.resolve(null);
    return new Promise((resolve) => {
      this.stopResolver = resolve;
      try {
        this.recorder?.stop();
      } catch {
        resolve(null);
      }
    });
  }

  cancel(): void {
    if (this.recorder && this.recorder.state === "recording") {
      this.stopResolver = null;
      try {
        this.recorder.onstop = null;
        this.recorder.stop();
      } catch {
        // ignore
      }
    }
    this.chunks = [];
  }

  /** 0..1 input level, for the live recording meter. */
  level(): number {
    if (!this.stream) return 0;
    try {
      if (!this.analyser) {
        this.audioCtx = new AudioContext();
        const src = this.audioCtx.createMediaStreamSource(this.stream);
        this.analyser = this.audioCtx.createAnalyser();
        this.analyser.fftSize = 512;
        src.connect(this.analyser);
      }
      const data = new Uint8Array(this.analyser.fftSize);
      this.analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += ((v - 128) / 128) ** 2;
      return Math.min(1, Math.sqrt(sum / data.length) * 4);
    } catch {
      return 0;
    }
  }

  /** Release the microphone completely. */
  release(): void {
    this.cancel();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.analyser = null;
    if (this.audioCtx) {
      void this.audioCtx.close().catch(() => undefined);
      this.audioCtx = null;
    }
  }
}
