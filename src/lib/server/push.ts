import { generateVAPIDKeys, sendNotification, WebPushError } from "web-push";
import { getDb, getSetting, nowIso, setSetting, uid } from "./db";

// Web Push (VAPID). The caregiver's phone subscribes once through its service
// worker; after that, alerts arrive even when the dashboard is closed.

interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

let cachedKeys: VapidKeys | null = null;

/** Keys from the environment, or generated once and stored in the database. */
export function getVapidKeys(): VapidKeys {
  if (cachedKeys) return cachedKeys;
  const subject = process.env.VAPID_SUBJECT || "mailto:one-more-story@example.com";
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    cachedKeys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY, subject };
    return cachedKeys;
  }
  let pub = getSetting("vapid_public_key");
  let priv = getSetting("vapid_private_key");
  if (!pub || !priv) {
    const keys = generateVAPIDKeys();
    pub = keys.publicKey;
    priv = keys.privateKey;
    setSetting("vapid_public_key", pub);
    setSetting("vapid_private_key", priv);
  }
  cachedKeys = { publicKey: pub, privateKey: priv, subject };
  return cachedKeys;
}

export interface BrowserSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

interface SubscriptionRow {
  id: string;
  caregiver_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  device_label: string | null;
}

export function saveSubscription(input: {
  caregiverId: string;
  pairCode: string;
  subscription: BrowserSubscription;
  deviceLabel: string | null;
}): { id: string } {
  const db = getDb();
  const cg = db.prepare("SELECT id, pair_code FROM caregivers WHERE id = ?").get(input.caregiverId) as
    | { id: string; pair_code: string }
    | undefined;
  if (!cg || cg.pair_code !== input.pairCode) throw new Error("This pairing link is not valid any more.");
  const { endpoint, keys } = input.subscription;
  if (!endpoint?.startsWith("https://") || !keys?.p256dh || !keys?.auth) throw new Error("Invalid push subscription");

  const existing = db.prepare("SELECT id FROM push_subscriptions WHERE endpoint = ?").get(endpoint) as
    | { id: string }
    | undefined;
  if (existing) {
    db.prepare(
      `UPDATE push_subscriptions SET caregiver_id = ?, p256dh = ?, auth = ?, device_label = ?, disabled_at = NULL, last_error = NULL
       WHERE id = ?`,
    ).run(input.caregiverId, keys.p256dh, keys.auth, input.deviceLabel, existing.id);
    return { id: existing.id };
  }
  const id = uid("sub");
  db.prepare(
    `INSERT INTO push_subscriptions (id, caregiver_id, endpoint, p256dh, auth, device_label, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.caregiverId, endpoint, keys.p256dh, keys.auth, input.deviceLabel, nowIso());
  return { id };
}

export function removeSubscription(endpoint: string): void {
  getDb().prepare("UPDATE push_subscriptions SET disabled_at = ? WHERE endpoint = ?").run(nowIso(), endpoint);
}

export function isSubscribed(endpoint: string): { caregiverId: string } | null {
  const row = getDb()
    .prepare("SELECT caregiver_id FROM push_subscriptions WHERE endpoint = ? AND disabled_at IS NULL")
    .get(endpoint) as { caregiver_id: string } | undefined;
  return row ? { caregiverId: row.caregiver_id } : null;
}

export interface PushPayload {
  title: string;
  body: string;
  tag: string;
  url: string;
  alertId?: string;
  createdAt?: string;
  actions?: boolean;
}

type SendOutcome = { ok: true; statusCode: number } | { ok: false; statusCode: number | null; error: string; gone: boolean };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sendOnce(sub: SubscriptionRow, payload: PushPayload, topic?: string): Promise<SendOutcome> {
  const keys = getVapidKeys();
  try {
    const res = await sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      {
        vapidDetails: { subject: keys.subject, publicKey: keys.publicKey, privateKey: keys.privateKey },
        TTL: 60 * 60 * 72, // keep trying for 3 days if the phone is offline
        urgency: "high",
        ...(topic ? { topic } : {}),
        timeout: 10_000,
      },
    );
    return { ok: true, statusCode: res.statusCode };
  } catch (err) {
    if (err instanceof WebPushError) {
      return {
        ok: false,
        statusCode: err.statusCode,
        error: `${err.statusCode} ${String(err.body || err.message).slice(0, 200)}`,
        gone: err.statusCode === 404 || err.statusCode === 410,
      };
    }
    return { ok: false, statusCode: null, error: String((err as Error)?.message ?? err).slice(0, 200), gone: false };
  }
}

/** Retries 429/5xx/network failures twice; never retries 4xx. */
async function sendWithRetry(sub: SubscriptionRow, payload: PushPayload, topic?: string) {
  let outcome: SendOutcome = { ok: false, statusCode: null, error: "not sent", gone: false };
  let attempts = 0;
  for (const wait of [0, 1000, 3000]) {
    if (wait) await sleep(wait);
    attempts++;
    outcome = await sendOnce(sub, payload, topic);
    if (outcome.ok) break;
    const retryable = outcome.statusCode === null || outcome.statusCode === 429 || outcome.statusCode >= 500;
    if (!retryable) break;
  }
  const db = getDb();
  if (outcome.ok) {
    db.prepare("UPDATE push_subscriptions SET last_success_at = ?, last_error = NULL WHERE id = ?").run(nowIso(), sub.id);
  } else {
    db.prepare("UPDATE push_subscriptions SET last_error = ?, disabled_at = CASE WHEN ? THEN ? ELSE disabled_at END WHERE id = ?").run(
      outcome.error,
      outcome.gone ? 1 : 0,
      nowIso(),
      sub.id,
    );
  }
  return { outcome, attempts };
}

function activeSubscriptions(caregiverId: string): SubscriptionRow[] {
  return getDb()
    .prepare("SELECT * FROM push_subscriptions WHERE caregiver_id = ? AND disabled_at IS NULL ORDER BY created_at")
    .all(caregiverId) as unknown as SubscriptionRow[];
}

export interface DeliverySummary {
  devices: number;
  sent: number;
  failed: number;
  alreadyHandled: number;
}

/**
 * Push one alert to every device of its caregiver, at most once per device.
 * The (alert, device) row is claimed before sending, so a retried request or a
 * second evaluation of the same pattern never produces a second notification.
 */
export async function deliverAlert(alertId: string): Promise<DeliverySummary> {
  const db = getDb();
  const alert = db.prepare("SELECT * FROM alerts WHERE id = ?").get(alertId) as
    | { id: string; caregiver_id: string | null; message: string; created_at: string; player_id: string }
    | undefined;
  const summary: DeliverySummary = { devices: 0, sent: 0, failed: 0, alreadyHandled: 0 };
  if (!alert?.caregiver_id) return summary;

  const player = db.prepare("SELECT family_name FROM players WHERE id = ?").get(alert.player_id) as
    | { family_name: string }
    | undefined;
  const subs = activeSubscriptions(alert.caregiver_id);
  summary.devices = subs.length;

  for (const sub of subs) {
    const claim = db
      .prepare(
        `INSERT OR IGNORE INTO alert_deliveries (id, alert_id, subscription_id, status, attempts, attempted_at)
         VALUES (?, ?, ?, 'sending', 0, ?)`,
      )
      .run(uid("dl"), alert.id, sub.id, nowIso());
    if (claim.changes === 0) {
      summary.alreadyHandled++;
      continue;
    }
    const payload: PushPayload = {
      title: `${player?.family_name ?? "Your relative"} · My Memory Room`,
      body: alert.message,
      tag: `alert-${alert.id}`,
      url: `/caregiver?alert=${alert.id}`,
      alertId: alert.id,
      createdAt: alert.created_at,
      actions: true,
    };
    const { outcome, attempts } = await sendWithRetry(sub, payload, alert.id.slice(0, 32));
    db.prepare(
      `UPDATE alert_deliveries SET status = ?, status_code = ?, error = ?, attempts = ?, attempted_at = ?
       WHERE alert_id = ? AND subscription_id = ?`,
    ).run(
      outcome.ok ? "sent" : "failed",
      outcome.statusCode,
      outcome.ok ? null : outcome.error,
      attempts,
      nowIso(),
      alert.id,
      sub.id,
    );
    if (outcome.ok) summary.sent++;
    else summary.failed++;
  }
  return summary;
}

export async function sendTestNotification(caregiverId: string): Promise<DeliverySummary> {
  const db = getDb();
  const cg = db.prepare("SELECT c.name, p.family_name FROM caregivers c JOIN players p ON p.id = c.player_id WHERE c.id = ?").get(
    caregiverId,
  ) as { name: string; family_name: string } | undefined;
  const subs = activeSubscriptions(caregiverId);
  const summary: DeliverySummary = { devices: subs.length, sent: 0, failed: 0, alreadyHandled: 0 };
  for (const sub of subs) {
    const { outcome } = await sendWithRetry(sub, {
      title: "One More Story",
      body: `Alerts are on for ${cg?.name ?? "you"}. If ${cg?.family_name ?? "your relative"} needs more help than usual in My Memory Room, it will show up here.`,
      tag: "test",
      url: "/caregiver",
    });
    if (outcome.ok) summary.sent++;
    else summary.failed++;
  }
  return summary;
}
