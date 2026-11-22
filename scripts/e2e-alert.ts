/**
 * End-to-end check of the live demo's alert path, over real HTTP:
 *
 *   production server  ->  web-push (VAPID, aes128gcm)  ->  a fake phone push
 *   service on https://localhost that decrypts what it receives.
 *
 * It resets the demo history (1,0,1,2,1 then 3,3), subscribes a fake phone for
 * the chosen caregiver, plays the judge's round (three clues, one retried
 * request), finishes it, and checks: one alert, the exact wording, exactly one
 * push, no duplicate on retries or while the pattern continues, excluded
 * rounds ignored, and "Mark as seen".
 *
 *   npm run build && npm run verify:alerts
 *
 * Needs openssl on PATH (Git for Windows, macOS and Linux include it).
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";

const PORT = Number(process.env.E2E_PORT ?? 3210);
const PUSH_PORT = Number(process.env.E2E_PUSH_PORT ?? 4443);
const BASE = `http://localhost:${PORT}`;
const EXPECTED = "Dad usually uses 1 hint per round. In his last 3 sessions, he used 3 hints each time.";

let failures = 0;
function check(ok: boolean, label: string, detail?: unknown) {
  if (ok) console.log(`  PASS  ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail !== undefined ? `  -> ${JSON.stringify(detail)}` : ""}`);
  }
}

async function api<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${text}`);
  return (text ? JSON.parse(text) : {}) as T;
}

// --- a fake phone: subscription keys + an HTTPS push service that decrypts ---
const ua = crypto.createECDH("prime256v1");
ua.generateKeys();
const uaPublic = ua.getPublicKey();
const authSecret = crypto.randomBytes(16);
const received: { body: string; headers: Record<string, string | string[] | undefined> }[] = [];

function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, len: number): Buffer {
  return Buffer.from(crypto.hkdfSync("sha256", ikm, salt, info, len));
}

/** RFC 8291 / RFC 8188 (aes128gcm) decryption, as a browser would do it. */
function decrypt(payload: Buffer): string {
  const salt = payload.subarray(0, 16);
  const idlen = payload.readUInt8(20);
  const asPublic = payload.subarray(21, 21 + idlen);
  const record = payload.subarray(21 + idlen);
  const ecdhSecret = ua.computeSecret(asPublic);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);
  const decipher = crypto.createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(record.subarray(record.length - 16));
  const plain = Buffer.concat([decipher.update(record.subarray(0, record.length - 16)), decipher.final()]);
  let end = plain.length - 1;
  while (end >= 0 && plain[end] === 0) end--; // strip padding, then the 0x02 delimiter
  return plain.subarray(0, end).toString("utf8");
}

async function waitFor(cond: () => boolean, ms: number) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return cond();
}

async function portBusy(port: number): Promise<boolean> {
  try {
    await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (await portBusy(PORT)) {
    console.error(`Port ${PORT} is already in use. Stop that server (or set E2E_PORT) and run again.`);
    process.exit(1);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "oms-e2e-"));
  const key = path.join(tmp, "key.pem");
  const cert = path.join(tmp, "cert.pem");
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1",
    "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
  ], { stdio: "ignore" });

  const pushServer = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      try {
        received.push({ body: decrypt(Buffer.concat(chunks)), headers: req.headers });
        res.writeHead(201).end();
      } catch (err) {
        console.log("  fake push service could not decrypt:", (err as Error).message);
        res.writeHead(400).end();
      }
    });
  });
  await new Promise<void>((r) => pushServer.listen(PUSH_PORT, r));

  console.log(`Starting the production server on ${BASE} (fresh database in ${tmp})`);
  // Note: antivirus HTTPS scanning (e.g. Avast Web Shield) intercepts even
  // localhost TLS, and the push checks then fail with "unable to verify the
  // first certificate". Turn the scanning off while running this check.
  const server: ChildProcess = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["next", "start", "-p", String(PORT)], {
    env: { ...process.env, DATA_DIR: path.join(tmp, "data"), NODE_EXTRA_CA_CERTS: cert, ANTHROPIC_API_KEY: "", OPENROUTER_API_KEY: "" },
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  let serverLog = "";
  server.stdout?.on("data", (d) => (serverLog += d));
  server.stderr?.on("data", (d) => (serverLog += d));

  try {
    const up = await waitForHealth();
    if (!up) throw new Error(`server did not start:\n${serverLog.slice(-2000)}`);

    console.log("\n1. Seeded history");
    await api("POST", "/api/demo/reset", { scope: "history" });
    const bundle = await api<{ player: { alertCaregiverId: string }; caregivers: { id: string; name: string; pairCode: string }[] }>("GET", "/api/bundle");
    const chosen = bundle.caregivers.find((c) => c.id === bundle.player.alertCaregiverId)!;
    check(chosen?.name === "Mariam", "the trusted person is Mariam", chosen?.name);
    type Hist = { pattern: { baseline: number; threshold: number; streak: number; state: string } };
    const h1 = await api<Hist>("GET", "/api/memory/history");
    check(h1.pattern.baseline === 1, "baseline = median(1,0,1,2,1) = 1", h1.pattern);
    check(h1.pattern.threshold === 3 && h1.pattern.streak === 2 && h1.pattern.state === "watching", "two seeded 3-hint rounds, no alert yet", h1.pattern);

    console.log("\n2. Caregiver phone subscribes (once)");
    await api("POST", "/api/push/subscribe", {
      caregiverId: chosen.id,
      pairCode: chosen.pairCode,
      deviceLabel: "E2E fake phone",
      subscription: {
        endpoint: `https://localhost:${PUSH_PORT}/push/fake-phone`,
        keys: { p256dh: uaPublic.toString("base64url"), auth: authSecret.toString("base64url") },
      },
    });
    let bad = false;
    try {
      await api("POST", "/api/push/subscribe", {
        caregiverId: chosen.id,
        pairCode: "wrong-code",
        subscription: { endpoint: `https://localhost:${PUSH_PORT}/push/x`, keys: { p256dh: "x", auth: "y" } },
      });
    } catch {
      bad = true;
    }
    check(bad, "a wrong pairing code is refused");

    console.log("\n3. The judge's round: three clues actually played");
    type Hint = { hintCount: number; counted: boolean };
    const { sessionId } = await api<{ sessionId: string }>("POST", "/api/memory/sessions", { clientKey: "judge-round-1" });
    const again = await api<{ sessionId: string }>("POST", "/api/memory/sessions", { clientKey: "judge-round-1" });
    check(again.sessionId === sessionId, "starting the same round twice returns the same round");
    await api<Hint>("POST", `/api/memory/sessions/${sessionId}/hints`, { playbackId: "pb-1", objectId: "obj_glasses" });
    await api<Hint>("POST", `/api/memory/sessions/${sessionId}/hints`, { playbackId: "pb-2", objectId: "obj_keys" });
    const dup = await api<Hint>("POST", `/api/memory/sessions/${sessionId}/hints`, { playbackId: "pb-2", objectId: "obj_keys" });
    check(dup.counted === false && dup.hintCount === 2, "a retried hint request is counted once", dup);
    const third = await api<Hint>("POST", `/api/memory/sessions/${sessionId}/hints`, { playbackId: "pb-3", objectId: "obj_wallet" });
    check(third.hintCount === 3, "three playbacks = three hints", third);
    await api("POST", `/api/memory/sessions/${sessionId}/events`, { kind: "wrong_choice", clientEventId: "w1", detail: "spot_shelf" });

    console.log("\n4. Finishing the round triggers the real alert + push");
    type Done = { hintCount: number; excludedReason: string | null; alert: { id: string; created: boolean; message: string } | null; delivery: { sent: number; alreadyHandled: number; devices: number } | null };
    const done = await api<Done>("POST", `/api/memory/sessions/${sessionId}/complete`);
    check(done.hintCount === 3 && done.excludedReason === null, "round saved with 3 hints and counted", done);
    check(done.alert?.created === true, "one caregiver alert created", done.alert);
    check(done.alert?.message === EXPECTED, "alert wording matches the brief", done.alert?.message);
    check(done.delivery?.sent === 1, "push sent to the subscribed phone", done.delivery);
    await waitFor(() => received.length >= 1, 5000);
    check(received.length === 1, "the phone's push service received exactly one push", received.length);
    const payload = received[0] ? JSON.parse(received[0].body) : {};
    check(payload.body === EXPECTED, "decrypted notification text is the alert", payload.body);
    check(payload.title === "Dad · My Memory Room" && payload.url === `/caregiver?alert=${done.alert?.id}`, "title names the game; tapping opens the inbox", payload);
    check(String(received[0]?.headers["authorization"] ?? "").startsWith("vapid t="), "request carries a VAPID signature");
    check(received[0]?.headers["content-encoding"] === "aes128gcm", "payload is encrypted (aes128gcm)");

    console.log("\n5. No duplicates");
    const retry = await api<Done>("POST", `/api/memory/sessions/${sessionId}/complete`);
    check(retry.alert?.created === false && retry.alert?.id === done.alert?.id, "retrying 'finish' returns the same alert", retry.alert);
    check(retry.delivery?.sent === 0 && retry.delivery?.alreadyHandled === 1, "retry does not push again", retry.delivery);
    const r2 = await api<{ sessionId: string }>("POST", "/api/memory/sessions", { clientKey: "judge-round-2" });
    for (const pb of ["a", "b", "c", "d"]) await api("POST", `/api/memory/sessions/${r2.sessionId}/hints`, { playbackId: pb, objectId: "obj_glasses" });
    const cont = await api<Done>("POST", `/api/memory/sessions/${r2.sessionId}/complete`);
    check(cont.alert?.created === false, "the pattern continuing (4 hints) does not create a new alert", cont.alert);
    await new Promise((r) => setTimeout(r, 800));
    check(received.length === 1, "still exactly one push on the phone", received.length);

    console.log("\n6. Excluded rounds");
    const r3 = await api<{ sessionId: string }>("POST", "/api/memory/sessions", { clientKey: "mic-problem-round" });
    for (const pb of ["m1", "m2", "m3"]) await api("POST", `/api/memory/sessions/${r3.sessionId}/hints`, { playbackId: pb, objectId: "obj_keys" });
    await api("POST", `/api/memory/sessions/${r3.sessionId}/events`, { kind: "mic_failure", clientEventId: "mic-1", detail: "audio-capture" });
    const ex = await api<Done>("POST", `/api/memory/sessions/${r3.sessionId}/complete`);
    check(ex.excludedReason === "Microphone problem during the round", "a round with a mic failure is left out", ex.excludedReason);
    const r4 = await api<{ sessionId: string }>("POST", "/api/memory/sessions", { clientKey: "left-early" });
    await api("POST", `/api/memory/sessions/${r4.sessionId}/interrupt`);
    const hist = await api<{ sessions: { id: string; status: string; excludedReason: string | null }[] }>("GET", "/api/memory/history");
    const interrupted = hist.sessions.find((s) => s.id === r4.sessionId);
    check(interrupted?.status === "interrupted" && interrupted.excludedReason === "Interrupted before the end", "an interrupted round is left out", interrupted);

    console.log("\n7. Inbox");
    const inbox = await api<{ alerts: { id: string; seenAt: string | null; game: string; deliveries: { status: string }[] }[] }>("GET", "/api/alerts");
    check(inbox.alerts.length === 1, "exactly one alert in the caregiver inbox", inbox.alerts.length);
    check(inbox.alerts[0]?.game === "My Memory Room" && inbox.alerts[0]?.deliveries[0]?.status === "sent", "inbox shows game and delivery", inbox.alerts[0]);
    await api("POST", `/api/alerts/${done.alert!.id}/seen`);
    const after = await api<{ alerts: { seenAt: string | null }[] }>("GET", "/api/alerts");
    check(Boolean(after.alerts[0]?.seenAt), "Mark as seen works");

    console.log("\n8. Reset for another demo run");
    await api("POST", "/api/demo/reset", { scope: "history" });
    const fresh = await api<{ alerts: unknown[] }>("GET", "/api/alerts");
    const h2 = await api<Hist>("GET", "/api/memory/history");
    check(fresh.alerts.length === 0 && h2.pattern.streak === 2, "reset restores the seeded history and clears alerts", { alerts: fresh.alerts.length, pattern: h2.pattern });
  } finally {
    if (failures > 0) {
      // Show why a push failed (the server records the push service's error).
      try {
        const { DatabaseSync } = await import("node:sqlite");
        const db = new DatabaseSync(path.join(tmp, "data", "one-more-story.db"));
        console.log("\n  push errors:", db.prepare("SELECT last_error FROM push_subscriptions").all());
        db.close();
      } catch {
        // database not there: the server never started
      }
      console.log(`\n  server log (tail):\n${serverLog.slice(-1500)}`);
    }
    // On Windows, kill the whole tree first: killing the shell alone would
    // orphan the Next server and leave the port taken.
    if (process.platform === "win32" && server.pid) {
      try {
        execFileSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
      } catch {
        // already gone
      }
    }
    server.kill();
    pushServer.close();
  }
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

async function waitForHealth(): Promise<boolean> {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
