"use client";

import { useEffect, useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { FamilyShell, Section } from "@/components/family/FamilyShell";
import { Button, Card, Spinner } from "@/components/ui";
import { ArrowLeftIcon, ArrowRightIcon, ArrowUpIcon, CameraIcon, CheckIcon, TrashIcon } from "@/components/icons";
import { sendJson, shrinkImage, uploadMedia } from "@/lib/client/api";

type Dir = "left" | "straight" | "right";
interface StopDraft {
  id: string;
  name: string;
  photoMediaId: string;
  url: string;
}
interface LinkDraft {
  fromStopId: string;
  toStopId: string;
  direction: Dir;
  label: string;
}

const rid = () => `st_${Math.random().toString(36).slice(2, 12)}`;
const DIRS: { id: Dir; label: string; icon: React.ReactNode }[] = [
  { id: "left", label: "Left", icon: <ArrowLeftIcon size={18} /> },
  { id: "straight", label: "Straight on", icon: <ArrowUpIcon size={18} /> },
  { id: "right", label: "Right", icon: <ArrowRightIcon size={18} /> },
];
const field = "w-full rounded-xl border border-ivory-400 bg-white px-3 py-2 text-base text-navy-900";

export default function StreetSetup() {
  const { bundle, reload } = useApp();
  const [name, setName] = useState("Our street");
  const [start, setStart] = useState("");
  const [stops, setStops] = useState<StopDraft[]>([]);
  const [links, setLinks] = useState<LinkDraft[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (loaded || !bundle) return;
    const r = bundle.route;
    if (r) {
      setName(r.name);
      setStart(r.startStopId);
      setStops(r.stops.map((s) => ({ id: s.id, name: s.name, photoMediaId: s.photo.id, url: s.photo.url })));
      setLinks(r.links.map((l) => ({ ...l, direction: l.direction as Dir })));
    }
    setLoaded(true);
  }, [bundle, loaded]);

  async function addStops(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      const added: StopDraft[] = [];
      for (const f of Array.from(files)) {
        const m = await uploadMedia(await shrinkImage(f));
        added.push({ id: rid(), name: "", photoMediaId: m.id, url: m.url });
      }
      setStops((ss) => [...ss, ...added]);
      if (!start && added[0]) setStart(added[0].id);
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function setLink(from: string, direction: Dir, to: string) {
    setLinks((ls) => {
      const rest = ls.filter((l) => !(l.fromStopId === from && l.direction === direction));
      if (!to) return rest;
      const target = stops.find((s) => s.id === to);
      const label = direction === "straight" ? `on to ${target?.name || "the next stop"}` : `${target?.name || "the way"} on the ${direction}`;
      return [...rest, { fromStopId: from, toStopId: to, direction, label }];
    });
  }

  function removeStop(id: string) {
    setStops((ss) => ss.filter((s) => s.id !== id));
    setLinks((ls) => ls.filter((l) => l.fromStopId !== id && l.toStopId !== id));
    if (start === id) setStart("");
  }

  async function save() {
    setMsg(null);
    setBusy(true);
    try {
      await sendJson("/api/setup/route", { name, startStopId: start, stops: stops.map(({ id, name: n, photoMediaId }) => ({ id, name: n, photoMediaId })), links }, "PUT");
      await reload();
      setMsg("Saved.");
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!bundle || !loaded) {
    return (
      <FamilyShell title="Show Me Your Street">
        <Spinner />
      </FamilyShell>
    );
  }

  return (
    <FamilyShell
      title="Show Me Your Street"
      intro="Photos of a familiar walk. From each stop, choose what is to the left, straight on, or to the right."
    >
      <Section
        title="Stops"
        action={
          <>
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => void addStops(e.target.files)} />
            <Button variant="ivory" size="md" icon={busy ? <Spinner /> : <CameraIcon size={20} />} onClick={() => fileRef.current?.click()} disabled={busy}>
              Add stop photos
            </Button>
          </>
        }
      >
        <label className="mb-4 block max-w-md text-sm font-bold">
          Route name
          <input className={`${field} mt-1`} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          {stops.map((s) => (
            <Card key={s.id} className="overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.url} alt="" className="aspect-[16/9] w-full object-cover" />
              <div className="grid gap-2 p-3">
                <div className="flex items-center gap-2">
                  <input className={field} placeholder="Name, e.g. Noor Bakery" value={s.name} onChange={(e) => setStops((ss) => ss.map((x) => (x.id === s.id ? { ...x, name: e.target.value } : x)))} />
                  <button type="button" aria-label="Remove stop" className="rounded-xl p-2 text-navy-400 hover:text-clay-500" onClick={() => removeStop(s.id)}>
                    <TrashIcon size={20} />
                  </button>
                </div>
                <label className="flex items-center gap-2 text-sm font-bold">
                  <input type="radio" name="start" className="size-5 accent-gold-500" checked={start === s.id} onChange={() => setStart(s.id)} />
                  The tour starts here
                </label>
                {DIRS.map((d) => {
                  const current = links.find((l) => l.fromStopId === s.id && l.direction === d.id);
                  return (
                    <label key={d.id} className="grid grid-cols-[7.5rem_1fr] items-center gap-2 text-sm font-bold">
                      <span className="flex items-center gap-1.5">
                        {d.icon} {d.label}
                      </span>
                      <select className={field} value={current?.toStopId ?? ""} onChange={(e) => setLink(s.id, d.id, e.target.value)}>
                        <option value="">Nothing this way</option>
                        {stops
                          .filter((x) => x.id !== s.id)
                          .map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.name || "Unnamed stop"}
                            </option>
                          ))}
                      </select>
                    </label>
                  );
                })}
              </div>
            </Card>
          ))}
        </div>
      </Section>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="gold" size="lg" icon={busy ? <Spinner /> : <CheckIcon size={22} />} onClick={() => void save()} disabled={busy || stops.length < 2}>
          Save street
        </Button>
        {msg && <p className="text-base font-bold text-navy-700">{msg}</p>}
      </div>
    </FamilyShell>
  );
}
