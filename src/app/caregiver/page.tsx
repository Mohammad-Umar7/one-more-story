"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertCard } from "@/components/family/AlertCard";
import { Button, Card, Spinner } from "@/components/ui";
import { BellIcon, CheckIcon, ArrowLeftIcon } from "@/components/icons";
import { getJson, sendJson } from "@/lib/client/api";
import {
  isIos,
  isStandalone,
  pushSupported,
  registerServiceWorker,
  subscriptionStatus,
  turnOffAlerts,
  turnOnAlerts,
} from "@/lib/client/push";
import type { AlertView } from "@/lib/shared/types";

interface Pairing {
  c: string;
  k: string;
}
interface CaregiverInfo {
  id: string;
  name: string;
  relation: string;
  playerName: string;
  familyName: string;
  isAlertRecipient: boolean;
}

const STORE = "oms-caregiver-pairing";

export default function CaregiverPage() {
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [info, setInfo] = useState<CaregiverInfo | null>(null);
  const [vapid, setVapid] = useState<string | null>(null);
  const [status, setStatus] = useState<"checking" | "on" | "off" | "unsupported">("checking");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<AlertView[] | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [ios, setIos] = useState({ ios: false, standalone: false });

  const loadAlerts = useCallback(async () => {
    try {
      const a = await getJson<{ alerts: AlertView[] }>("/api/alerts");
      setAlerts(a.alerts);
    } catch {
      // keep the last list
    }
  }, []);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const c = q.get("c");
    const k = q.get("k");
    setHighlight(q.get("alert"));
    let p: Pairing | null = null;
    if (c && k) {
      p = { c, k };
      try {
        localStorage.setItem(STORE, JSON.stringify(p));
      } catch {
        // private mode: fine, the link still works this time
      }
    } else {
      try {
        const saved = localStorage.getItem(STORE);
        if (saved) p = JSON.parse(saved) as Pairing;
      } catch {
        p = null;
      }
    }
    setPairing(p);
    setIos({ ios: isIos(), standalone: isStandalone() });
    if (!pushSupported()) setStatus("unsupported");
    else
      void subscriptionStatus()
        .then((s) => setStatus(s.subscribed ? "on" : "off"))
        .catch(() => setStatus("off"));
    if (pushSupported()) void registerServiceWorker().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!pairing) return;
    getJson<{ caregiver: CaregiverInfo; vapidPublicKey: string }>(`/api/caregivers/${encodeURIComponent(pairing.c)}?code=${encodeURIComponent(pairing.k)}`)
      .then((r) => {
        setInfo(r.caregiver);
        setVapid(r.vapidPublicKey);
      })
      .catch(() => setMessage("This pairing link isn't valid any more. Ask the family for a new one."));
  }, [pairing]);

  useEffect(() => {
    void loadAlerts();
    const t = setInterval(() => void loadAlerts(), 5000);
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "alert") {
        if (e.data.alertId) setHighlight(e.data.alertId);
        void loadAlerts();
      }
    };
    navigator.serviceWorker?.addEventListener("message", onMsg);
    return () => {
      clearInterval(t);
      navigator.serviceWorker?.removeEventListener("message", onMsg);
    };
  }, [loadAlerts]);

  useEffect(() => {
    if (highlight && alerts?.some((a) => a.id === highlight)) {
      document.getElementById(`alert-${highlight}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlight, alerts]);

  async function enable() {
    if (!pairing || !vapid) return;
    setBusy(true);
    setMessage(null);
    try {
      await turnOnAlerts({ vapidPublicKey: vapid, caregiverId: pairing.c, pairCode: pairing.k });
      setStatus("on");
      setMessage("Done. Alerts will arrive on this phone, even when this page is closed.");
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    if (!pairing) return;
    setBusy(true);
    try {
      const r = await sendJson<{ sent: number; devices: number }>("/api/push/test", { caregiverId: pairing.c });
      setMessage(r.sent > 0 ? "Test sent. It should appear in a few seconds." : "No phone is set up yet. Turn on notifications first.");
    } catch {
      setMessage("Couldn't send a test just now.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      await turnOffAlerts();
      setStatus("off");
      setMessage("Alerts are off for this phone.");
    } finally {
      setBusy(false);
    }
  }

  const familyName = info?.familyName ?? "your relative";
  const unseen = alerts?.filter((a) => !a.seenAt).length ?? 0;

  return (
    <div className="min-h-dvh bg-ivory-50">
      <header className="bg-navy-900 px-4 pb-6 pt-5 text-ivory-50 safe-top">
        <div className="mx-auto max-w-xl">
          <Link href="/family" className="inline-flex items-center gap-1 text-sm font-bold text-gold-200">
            <ArrowLeftIcon size={16} /> Family corner
          </Link>
          <p className="mt-3 text-sm font-bold uppercase tracking-[0.16em] text-gold-300">One More Story</p>
          <h1 className="mt-1 font-display text-3xl font-semibold leading-tight">
            {info ? `Hi ${info.name}` : "Caregiver alerts"}
          </h1>
          <p className="mt-1 text-lg text-ivory-200">
            {unseen > 0 ? `${unseen} new alert${unseen === 1 ? "" : "s"} about ${familyName}` : `Updates about ${familyName} in My Memory Room`}
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-xl px-4 pb-16 pt-5">
        {pairing && (
          <Card className="mb-6 p-5">
            {status === "on" ? (
              <>
                <p className="flex items-center gap-2 text-xl font-bold text-sage-700">
                  <CheckIcon size={24} /> Alerts are on for this phone
                </p>
                <p className="mt-1 text-base text-navy-700">You&apos;ll get a notification even when this page is closed.</p>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Button variant="gold" size="md" onClick={() => void test()} disabled={busy}>
                    Send a test
                  </Button>
                  <Button variant="ivory" size="md" onClick={() => void disable()} disabled={busy}>
                    Turn off
                  </Button>
                </div>
              </>
            ) : status === "unsupported" ? (
              <>
                <p className="text-xl font-bold">This browser can&apos;t show notifications here.</p>
                {ios.ios && !ios.standalone ? (
                  <ol className="mt-3 list-decimal space-y-1 pl-5 text-lg text-navy-700">
                    <li>Tap the Share button in Safari.</li>
                    <li>Choose &ldquo;Add to Home Screen&rdquo;.</li>
                    <li>Open &ldquo;OMS Alerts&rdquo; from your home screen and tap Turn on notifications.</li>
                  </ol>
                ) : (
                  <p className="mt-2 text-lg text-navy-700">Please open this link in Chrome on Android, or in Safari after adding it to the Home Screen on iPhone. It must be an https:// link.</p>
                )}
                <p className="mt-3 text-base text-navy-600">Alerts still appear in the inbox below.</p>
              </>
            ) : (
              <>
                <div className="flex items-start gap-3">
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gold-100 text-gold-700">
                    <BellIcon size={26} />
                  </span>
                  <div>
                    <p className="text-xl font-bold leading-snug">Turn on alerts for {familyName} on this phone</p>
                    <p className="mt-1 text-base text-navy-700">
                      One tap. You&apos;ll only hear from us if {familyName} needs more help than usual in My Memory Room for three rounds in a row.
                    </p>
                  </div>
                </div>
                <Button variant="gold" size="xl" className="mt-4 w-full" icon={busy || status === "checking" ? <Spinner /> : <BellIcon size={24} />} onClick={() => void enable()} disabled={busy || !vapid || status === "checking"}>
                  Turn on notifications
                </Button>
              </>
            )}
            {info && !info.isAlertRecipient && (
              <p className="mt-3 rounded-2xl bg-ivory-100 p-3 text-base text-navy-700">
                Note: {info.playerName}&apos;s chosen trusted person is someone else right now, so alerts go to them.
              </p>
            )}
            {message && <p className="mt-3 text-base font-bold text-navy-800" role="status">{message}</p>}
          </Card>
        )}

        {!pairing && (
          <Card className="mb-6 p-5 text-lg text-navy-700">
            To get alerts on this phone, open the pairing link or QR code from <b>Family corner → People &amp; alerts</b> on the tablet.
          </Card>
        )}

        <h2 className="mb-3 font-display text-2xl font-semibold">Inbox</h2>
        {alerts === null ? (
          <Spinner />
        ) : alerts.length === 0 ? (
          <Card className="p-5 text-lg text-navy-700">Nothing new. All is well.</Card>
        ) : (
          <div className="flex flex-col gap-4">
            {alerts.map((a) => (
              <AlertCard key={a.id} alert={a} familyName={familyName} highlight={a.id === highlight} onChange={() => void loadAlerts()} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
