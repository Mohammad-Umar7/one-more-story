"use client";

import { useState } from "react";
import type { AlertView } from "@/lib/shared/types";
import { BellIcon, CheckIcon } from "../icons";
import { Button, Spinner } from "../ui";
import { sendJson } from "@/lib/client/api";

function when(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AlertCard({
  alert,
  familyName,
  highlight = false,
  onChange,
}: {
  alert: AlertView;
  familyName: string;
  highlight?: boolean;
  onChange?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [seenAt, setSeenAt] = useState(alert.seenAt);
  const sent = alert.deliveries.filter((d) => d.status === "sent");
  const failed = alert.deliveries.filter((d) => d.status === "failed");

  async function markSeen() {
    setBusy(true);
    try {
      await sendJson(`/api/alerts/${alert.id}/seen`, {});
      setSeenAt(new Date().toISOString());
      onChange?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <article
      id={`alert-${alert.id}`}
      className={`relative overflow-hidden rounded-3xl border bg-white p-5 shadow-card ${
        highlight ? "border-gold-400 ring-4 ring-gold-200" : "border-ivory-300"
      }`}
    >
      {!seenAt && <span className="absolute inset-y-0 left-0 w-1.5 bg-gold-400" aria-hidden="true" />}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-bold text-navy-600">
        <span className="flex items-center gap-1.5 rounded-full bg-gold-100 px-2.5 py-1 text-gold-700">
          <BellIcon size={16} /> {alert.game}
        </span>
        <time dateTime={alert.createdAt}>{when(alert.createdAt)}</time>
        {!seenAt && <span className="rounded-full bg-navy-800 px-2 py-0.5 text-xs uppercase tracking-wider text-ivory-50">New</span>}
      </header>
      <p className="mt-3 font-display text-xl leading-snug text-navy-900 md:text-2xl">{alert.message}</p>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-base">
        <div className="rounded-2xl bg-ivory-100 p-3">
          <dt className="text-sm font-bold text-navy-600">Usual level</dt>
          <dd className="font-bold">
            {alert.baseline} hint{alert.baseline === 1 ? "" : "s"} per round
          </dd>
        </div>
        <div className="rounded-2xl bg-ivory-100 p-3">
          <dt className="text-sm font-bold text-navy-600">Last 3 rounds</dt>
          <dd className="font-bold">{alert.hintCounts.join(", ")} hints</dd>
        </div>
      </dl>
      <p className="mt-3 text-base text-navy-700">
        A change in one game, not a medical assessment. You might check in with {familyName} or play a round together.
      </p>
      <p className="mt-2 text-sm text-navy-600">
        {sent.length > 0
          ? `Sent to ${alert.caregiverName ?? "the caregiver"}'s phone${sent.length > 1 ? "s" : ""}.`
          : failed.length > 0
            ? "The phone notification could not be delivered, so it is kept here."
            : alert.caregiverId
              ? `No phone is set up for ${alert.caregiverName ?? "the caregiver"} yet, so it is kept here.`
              : "No trusted person is chosen yet, so it is kept here."}
      </p>
      <div className="mt-4">
        {seenAt ? (
          <p className="flex items-center gap-2 text-base font-bold text-sage-700">
            <CheckIcon size={20} /> Seen {when(seenAt)}
          </p>
        ) : (
          <Button variant="navy" size="md" icon={busy ? <Spinner /> : <CheckIcon size={20} />} onClick={() => void markSeen()} disabled={busy}>
            Mark as seen
          </Button>
        )}
      </div>
    </article>
  );
}
