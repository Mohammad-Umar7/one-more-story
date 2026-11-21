"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useApp } from "@/components/AppProvider";
import { FamilyShell, Section } from "@/components/family/FamilyShell";
import { Button, Card, Spinner } from "@/components/ui";
import { BellIcon, CheckIcon, PlusIcon, TrashIcon, UsersIcon } from "@/components/icons";
import { sendJson } from "@/lib/client/api";
import type { CaregiverKind, Patience, Pronoun } from "@/lib/shared/types";

const KIND_LABEL: Record<CaregiverKind, string> = { relative: "Relative", friend: "Friend", professional: "Professional caregiver" };
const LANGS = [
  { id: "en-US", label: "English (US)" },
  { id: "en-GB", label: "English (UK)" },
  { id: "en-IN", label: "English (India)" },
  { id: "en-AU", label: "English (Australia)" },
  { id: "ar-AE", label: "Arabic (UAE)" },
];

const field = "mt-1 w-full rounded-2xl border border-ivory-400 bg-white px-4 py-3 text-lg text-navy-900 focus:border-gold-400";

export default function PeopleSetup() {
  const { bundle, reload } = useApp();
  const player = bundle?.player;
  const [form, setForm] = useState<{ name: string; familyName: string; pronoun: Pronoun; speechLang: string; patience: Patience; saveTourSpeech: boolean } | null>(null);
  const [saved, setSaved] = useState(false);
  const [newPerson, setNewPerson] = useState({ name: "", relation: "", kind: "relative" as CaregiverKind });
  const [qr, setQr] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [origin, setOrigin] = useState("");
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (player && !form) {
      setForm({
        name: player.name,
        familyName: player.familyName,
        pronoun: player.pronoun,
        speechLang: player.speechLang,
        patience: player.patience,
        saveTourSpeech: player.saveTourSpeech,
      });
    }
  }, [player, form]);

  const chosen = bundle?.caregivers.find((c) => c.id === player?.alertCaregiverId) ?? null;

  useEffect(() => {
    if (!chosen || !origin) return;
    const url = `${origin}/caregiver?c=${encodeURIComponent(chosen.id)}&k=${encodeURIComponent(chosen.pairCode)}`;
    setLink(url);
    QRCode.toDataURL(url, { margin: 1, width: 260, color: { dark: "#0c1a42", light: "#ffffff" } })
      .then(setQr)
      .catch(() => setQr(null));
  }, [chosen, origin]);

  // Watch for the caregiver's phone to finish setting up.
  useEffect(() => {
    if (!chosen || chosen.deviceCount > 0) return;
    const t = setInterval(() => void reload(), 3000);
    return () => clearInterval(t);
  }, [chosen, reload]);

  async function saveProfile() {
    if (!form) return;
    setBusy(true);
    await sendJson("/api/setup/player", form, "PUT");
    await reload();
    setBusy(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  async function choose(id: string) {
    await sendJson("/api/setup/caregivers", { alertCaregiverId: id }, "PUT");
    await reload();
  }

  async function add() {
    if (!newPerson.name.trim()) return;
    const r = await sendJson<{ id: string }>("/api/setup/caregivers", newPerson);
    setNewPerson({ name: "", relation: "", kind: "relative" });
    await choose(r.id);
  }

  async function remove(id: string, name: string) {
    if (!window.confirm(`Remove ${name}? Their phone will stop getting alerts.`)) return;
    await sendJson("/api/setup/caregivers", { id }, "DELETE");
    await reload();
  }

  async function test() {
    if (!chosen) return;
    setTestMsg(null);
    const r = await sendJson<{ sent: number; devices: number }>("/api/push/test", { caregiverId: chosen.id });
    setTestMsg(r.sent > 0 ? `Test sent to ${r.sent} phone${r.sent === 1 ? "" : "s"}.` : `${chosen.name}'s phone isn't set up yet.`);
  }

  const insecure = origin && (origin.startsWith("http://") && !origin.includes("localhost"));
  const localOnly = origin.includes("localhost") || origin.includes("127.0.0.1");

  if (!bundle || !form || !player) {
    return (
      <FamilyShell title="People & alerts">
        <Spinner />
      </FamilyShell>
    );
  }

  return (
    <FamilyShell title="People & alerts">
      <Section title={`About ${player.name}`}>
        <Card className="grid gap-4 p-5 md:grid-cols-2">
          <label className="text-base font-bold">
            Name the games use
            <input className={field} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="text-base font-bold">
            What the family calls them (used in alerts)
            <input className={field} value={form.familyName} onChange={(e) => setForm({ ...form, familyName: e.target.value })} placeholder="Dad, Mum, Nana…" />
          </label>
          <label className="text-base font-bold">
            Pronoun (used in alerts)
            <select className={field} value={form.pronoun} onChange={(e) => setForm({ ...form, pronoun: e.target.value as Pronoun })}>
              <option value="he">he / his</option>
              <option value="she">she / her</option>
              <option value="they">they / their</option>
            </select>
          </label>
          <label className="text-base font-bold">
            Language for listening
            <select className={field} value={form.speechLang} onChange={(e) => setForm({ ...form, speechLang: e.target.value })}>
              {LANGS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-start gap-3 text-base">
            <input
              type="checkbox"
              className="mt-1 size-6 accent-gold-500"
              checked={form.patience === "extra"}
              onChange={(e) => setForm({ ...form, patience: e.target.checked ? "extra" : "normal" })}
            />
            <span>
              <b>Give extra time to answer.</b> Waits longer through pauses before replying.
            </span>
          </label>
          <label className="flex items-start gap-3 text-base">
            <input type="checkbox" className="mt-1 size-6 accent-gold-500" checked={form.saveTourSpeech} onChange={(e) => setForm({ ...form, saveTourSpeech: e.target.checked })} />
            <span>
              <b>Save {form.name}&apos;s words on street tours</b> so the family can replay the walk. Voice notes are always saved.
            </span>
          </label>
          <div className="md:col-span-2">
            <Button variant="navy" size="md" icon={busy ? <Spinner /> : saved ? <CheckIcon size={20} /> : undefined} onClick={() => void saveProfile()} disabled={busy}>
              {saved ? "Saved" : "Save profile"}
            </Button>
          </div>
        </Card>
      </Section>

      <Section title="Who should we tell?">
        <p className="mb-3 text-lg text-navy-700">
          Ask {player.name} to choose one trusted person: a relative, a friend or a professional caregiver.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          {bundle.caregivers.map((c) => {
            const on = c.id === player.alertCaregiverId;
            return (
              <div key={c.id} className={`flex items-center gap-3 rounded-3xl border-2 bg-white p-4 shadow-card ${on ? "border-gold-400" : "border-transparent"}`}>
                <button type="button" onClick={() => void choose(c.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-pressed={on}>
                  <span className={`flex size-12 shrink-0 items-center justify-center rounded-full font-display text-xl font-semibold ${on ? "bg-gold-400 text-navy-950" : "bg-navy-100 text-navy-800"}`}>
                    {c.name.charAt(0)}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-lg font-bold">{c.name}</span>
                    <span className="block text-sm text-navy-600">
                      {c.relation} · {KIND_LABEL[c.kind]}
                    </span>
                    <span className="block text-sm font-bold text-sage-700">{c.deviceCount > 0 ? `✓ ${c.deviceCount} phone set up` : ""}</span>
                  </span>
                </button>
                {on ? (
                  <span className="rounded-full bg-gold-400 px-3 py-1 text-sm font-bold text-navy-950">Chosen</span>
                ) : (
                  <button type="button" aria-label={`Remove ${c.name}`} className="rounded-xl p-2 text-navy-400 hover:text-clay-500" onClick={() => void remove(c.id, c.name)}>
                    <TrashIcon size={20} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <Card className="mt-3 grid gap-3 p-4 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
          <label className="text-sm font-bold">
            Name
            <input className={field} value={newPerson.name} onChange={(e) => setNewPerson({ ...newPerson, name: e.target.value })} placeholder="e.g. Aisha" />
          </label>
          <label className="text-sm font-bold">
            Relationship
            <input className={field} value={newPerson.relation} onChange={(e) => setNewPerson({ ...newPerson, relation: e.target.value })} placeholder="e.g. Neighbour" />
          </label>
          <label className="text-sm font-bold">
            Type
            <select className={field} value={newPerson.kind} onChange={(e) => setNewPerson({ ...newPerson, kind: e.target.value as CaregiverKind })}>
              <option value="relative">Relative</option>
              <option value="friend">Friend</option>
              <option value="professional">Professional caregiver</option>
            </select>
          </label>
          <Button variant="ivory" size="md" icon={<PlusIcon size={20} />} onClick={() => void add()} disabled={!newPerson.name.trim()}>
            Add
          </Button>
        </Card>
      </Section>

      {chosen && (
        <Section title={`Turn on alerts on ${chosen.name}'s phone`}>
          <Card className="grid gap-5 p-5 md:grid-cols-[auto_1fr] md:items-start">
            <div className="mx-auto">
              {qr ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qr} alt={`QR code to set up alerts on ${chosen.name}'s phone`} className="size-56 rounded-2xl border border-ivory-300" />
              ) : (
                <div className="flex size-56 items-center justify-center rounded-2xl bg-ivory-200">
                  <Spinner />
                </div>
              )}
            </div>
            <div>
              {chosen.deviceCount > 0 ? (
                <p className="flex items-center gap-2 text-xl font-bold text-sage-700">
                  <CheckIcon size={24} /> {chosen.name}&apos;s phone is set up. Alerts will arrive automatically.
                </p>
              ) : (
                <p className="flex items-center gap-2 text-xl font-bold">
                  <BellIcon size={24} className="text-gold-600" /> Waiting for {chosen.name}&apos;s phone…
                </p>
              )}
              <ol className="mt-3 list-decimal space-y-1 pl-5 text-lg text-navy-700">
                <li>On {chosen.name}&apos;s phone, scan this code with the camera (or open the link).</li>
                <li>Tap <b>Turn on notifications</b> once and allow them.</li>
                <li>On iPhone, first tap Share → Add to Home Screen, then open it from there.</li>
              </ol>
              {localOnly && (
                <p className="mt-3 rounded-2xl bg-gold-100 p-3 text-base text-gold-700">
                  This address only works on this computer. For a phone, open the app through its <b>https://</b> tunnel address (see README: <code>npm run tunnel</code>) and come back to this page.
                </p>
              )}
              {insecure && (
                <p className="mt-3 rounded-2xl bg-gold-100 p-3 text-base text-gold-700">
                  Phones only allow notifications on <b>https://</b> addresses. Use the tunnel address from the README.
                </p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input readOnly value={link} className="min-w-0 flex-1 rounded-xl border border-ivory-400 bg-ivory-50 px-3 py-2 text-sm" aria-label="Pairing link" onFocus={(e) => e.target.select()} />
                <Button variant="ivory" size="sm" onClick={() => void navigator.clipboard?.writeText(link)}>
                  Copy link
                </Button>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button variant="gold" size="md" icon={<BellIcon size={20} />} onClick={() => void test()}>
                  Send a test notification
                </Button>
                {testMsg && <span className="text-base font-bold text-navy-700">{testMsg}</span>}
              </div>
            </div>
          </Card>
          <p className="mt-3 flex items-start gap-2 text-base text-navy-600">
            <UsersIcon size={20} className="mt-0.5 shrink-0" />
            Alerts describe a change in how much help {player.familyName} asked for in one game. They are not a medical assessment.
          </p>
        </Section>
      )}
    </FamilyShell>
  );
}
