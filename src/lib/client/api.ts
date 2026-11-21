// Fetch helpers for the browser. Requests that record game facts are retried
// (the server deduplicates them by id), so a flaky connection never loses a hint.

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

export async function getJson<T>(url: string): Promise<T> {
  return parse<T>(await fetch(url, { cache: "no-store" }));
}

export async function sendJson<T>(url: string, body: unknown, method = "POST"): Promise<T> {
  return parse<T>(
    await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    }),
  );
}

/** POST with retries for idempotent writes (hint counted, round finished, ...). */
export async function sendReliably<T>(url: string, body: unknown, attempts = 4): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await sendJson<T>(url, body);
    } catch (err) {
      lastError = err;
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) throw err;
      await new Promise((r) => setTimeout(r, 400 * 2 ** i));
    }
  }
  throw lastError;
}

export async function uploadMedia(
  blob: Blob,
  opts: { filename?: string; durationMs?: number; transcript?: string } = {},
): Promise<{ id: string; url: string }> {
  const form = new FormData();
  const ext = blob.type.includes("webm") ? "webm" : blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : blob.type.includes("png") ? "png" : blob.type.includes("jpeg") ? "jpg" : "bin";
  form.append("file", blob, opts.filename ?? `upload.${ext}`);
  if (opts.durationMs) form.append("durationMs", String(Math.round(opts.durationMs)));
  if (opts.transcript) form.append("transcript", opts.transcript);
  let lastError: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      return await parse<{ id: string; url: string }>(await fetch("/api/media", { method: "POST", body: form }));
    } catch (err) {
      lastError = err;
      if (err instanceof ApiError && err.status < 500) throw err;
      await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
  throw lastError;
}

export function clientKey(prefix: string): string {
  const rnd =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${rnd}`;
}

/** Downscale a phone/tablet photo before upload (keeps uploads small and fast). */
export async function shrinkImage(file: File, maxSide = 1800, quality = 0.85): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), "image/jpeg", quality));
}
