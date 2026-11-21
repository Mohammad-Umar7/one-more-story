"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { FamilyShell, Section } from "@/components/family/FamilyShell";
import { ObjectIcon, OBJECT_ICONS } from "@/components/ObjectIcon";
import { RecordButton } from "@/components/RecordButton";
import { Button, Card, Spinner } from "@/components/ui";
import { CameraIcon, CheckIcon, PlayIcon, TrashIcon } from "@/components/icons";
import { sendJson, shrinkImage, uploadMedia } from "@/lib/client/api";
import { MicCapture } from "@/lib/client/recorder";
import { roundSignature } from "@/lib/shared/baseline";
import type { Difficulty } from "@/lib/shared/types";

interface SpotDraft {
  id: string;
  label: string;
  x: number;
  y: number;
}
interface ObjectDraft {
  id: string;
  name: string;
  icon: string;
  spotId: string;
  clue: { mediaId: string; url: string } | null;
}

const rid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 12)}`;
const field = "w-full rounded-xl border border-ivory-400 bg-white px-3 py-2 text-lg text-navy-900 focus:border-gold-400";

export default function RoomSetup() {
  const { bundle, reload } = useApp();
  const room = bundle?.room ?? null;
  const [name, setName] = useState("Living room");
  const [photo, setPhoto] = useState<{ id: string; url: string } | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>("standard");
  const [spots, setSpots] = useState<SpotDraft[]>([]);
  const [objects, setObjects] = useState<ObjectDraft[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recordingFor, setRecordingFor] = useState<string | null>(null);
  const [mic] = useState(() => new MicCapture());
  const fileRef = useRef<HTMLInputElement>(null);
  const labelRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    if (loaded || !bundle) return;
    if (room) {
      setName(room.name);
      setPhoto(room.photo);
      setDifficulty(room.difficulty);
      setSpots(room.spots.map((s) => ({ ...s })));
      setObjects(room.objects.map((o) => ({ id: o.id, name: o.name, icon: o.icon, spotId: o.spotId, clue: o.clue ? { mediaId: o.clue.mediaId, url: o.clue.url } : null })));
    } else {
      setObjects(
        ["glasses", "keys", "wallet", "watch"].map((icon) => ({ id: rid("obj"), name: icon, icon, spotId: "", clue: null })),
      );
    }
    setLoaded(true);
  }, [bundle, room, loaded]);

  useEffect(() => () => mic.release(), [mic]);

  const newSignature = useMemo(
    () => roundSignature(difficulty, objects.map((o) => ({ id: o.id, spotId: o.spotId }))),
    [difficulty, objects],
  );
  const signatureChanged = room ? newSignature !== room.signature : false;

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const blob = await shrinkImage(file);
      const m = await uploadMedia(blob);
      setPhoto(m);
      if (spots.length) {
        setSpots([]);
        setObjects((os) => os.map((o) => ({ ...o, spotId: "" })));
        setStatus("New photo added. Tap the photo to mark the places again.");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  function onPhotoTap(e: React.MouseEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest("button")) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.min(0.98, Math.max(0.02, (e.clientX - r.left) / r.width));
    const y = Math.min(0.98, Math.max(0.02, (e.clientY - r.top) / r.height));
    if (selected) {
      setSpots((ss) => ss.map((s) => (s.id === selected ? { ...s, x, y } : s)));
      setSelected(null);
      return;
    }
    const id = rid("spot");
    setSpots((ss) => [...ss, { id, label: "", x, y }]);
    setTimeout(() => labelRefs.current[id]?.focus(), 50);
  }

  function removeSpot(id: string) {
    setSpots((ss) => ss.filter((s) => s.id !== id));
    setObjects((os) => os.map((o) => (o.spotId === id ? { ...o, spotId: "" } : o)));
    if (selected === id) setSelected(null);
  }

  function updateObject(id: string, patch: Partial<ObjectDraft>) {
    setObjects((os) => os.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  }

  async function save() {
    setError(null);
    setStatus(null);
    if (!photo) return setError("Please add a photo of the room first.");
    if (spots.some((s) => !s.label.trim())) return setError("Every marked place needs a name.");
    if (spots.length < 4) return setError("Please mark at least four places.");
    if (objects.some((o) => !o.spotId)) return setError("Choose where each object usually goes.");
    if (signatureChanged && !window.confirm("Changing the objects, their places or the difficulty starts a new usual level: the next five rounds set it. Continue?")) return;
    setSaving(true);
    try {
      await sendJson(
        "/api/setup/room",
        {
          name,
          photoMediaId: photo.id,
          difficulty,
          spots,
          objects: objects.map((o) => ({ id: o.id, name: o.name, icon: o.icon, spotId: o.spotId, clueMediaId: o.clue?.mediaId ?? null })),
        },
        "PUT",
      );
      await reload();
      setStatus("Saved. The next round uses this room.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!bundle || !loaded) {
    return (
      <FamilyShell title="My Memory Room">
        <Spinner />
      </FamilyShell>
    );
  }

  const player = bundle.player;
  return (
    <FamilyShell title="My Memory Room" intro={`A photo of ${player.name}'s own room, four everyday things, and a clue for each in ${player.name}'s own voice.`}>
      <Section title="1. The room photo">
        <Card className="p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input className={`${field} max-w-xs`} value={name} onChange={(e) => setName(e.target.value)} aria-label="Room name" />
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void onPhoto(e.target.files?.[0])} />
            <Button variant="ivory" size="md" icon={uploading ? <Spinner /> : <CameraIcon size={22} />} onClick={() => fileRef.current?.click()} disabled={uploading}>
              {photo ? "Replace photo" : "Add a photo"}
            </Button>
          </div>
          {photo ? (
            <>
              <p className="mb-2 text-base font-bold text-navy-700">
                {selected ? "Tap the photo where this place should move to." : "Tap the photo to mark a place. Tap a marker to select it."}
              </p>
              <div className="relative aspect-[4/3] w-full cursor-crosshair overflow-hidden rounded-2xl bg-ivory-200" onClick={onPhotoTap}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} alt="Room" className="absolute inset-0 h-full w-full object-cover" />
                {spots.map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSelected(selected === s.id ? null : s.id)}
                    className={`absolute flex size-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[3px] text-sm font-bold shadow-photo ${
                      selected === s.id ? "border-white bg-navy-800 text-white" : "border-white bg-gold-400 text-navy-950"
                    }`}
                    style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%` }}
                    aria-label={`Place ${i + 1}: ${s.label || "unnamed"}`}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="rounded-2xl bg-ivory-100 p-6 text-center text-lg text-navy-700">Add a clear, well-lit photo of a room {player.name} knows well.</p>
          )}
        </Card>
      </Section>

      <Section title="2. Familiar places">
        {spots.length === 0 ? (
          <Card className="p-4 text-lg text-navy-700">No places yet. Tap the photo to mark them (at least four).</Card>
        ) : (
          <ol className="grid gap-2 md:grid-cols-2">
            {spots.map((s, i) => (
              <li key={s.id} className={`flex items-center gap-2 rounded-2xl border-2 bg-white p-2 shadow-card ${selected === s.id ? "border-navy-700" : "border-transparent"}`}>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gold-400 font-bold">{i + 1}</span>
                <input
                  ref={(el) => {
                    labelRefs.current[s.id] = el;
                  }}
                  className={field}
                  value={s.label}
                  placeholder="e.g. blue bowl"
                  onChange={(e) => setSpots((ss) => ss.map((x) => (x.id === s.id ? { ...x, label: e.target.value } : x)))}
                  aria-label={`Name of place ${i + 1}`}
                />
                <button type="button" className="rounded-xl p-2 text-navy-400 hover:text-clay-500" onClick={() => removeSpot(s.id)} aria-label={`Remove place ${i + 1}`}>
                  <TrashIcon size={20} />
                </button>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section title="3. Four things and their clues">
        <div className="grid gap-3 md:grid-cols-2">
          {objects.map((o) => (
            <Card key={o.id} className="p-4">
              <div className="flex items-center gap-3">
                <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-gold-100">
                  <ObjectIcon icon={o.icon} size={40} />
                </span>
                <div className="grid flex-1 gap-2">
                  <select className={field} value={o.icon} onChange={(e) => updateObject(o.id, { icon: e.target.value, name: OBJECT_ICONS.find((x) => x.id === e.target.value)?.label.toLowerCase() ?? o.name })} aria-label="Kind of object">
                    {OBJECT_ICONS.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.label}
                      </option>
                    ))}
                  </select>
                  <input className={field} value={o.name} onChange={(e) => updateObject(o.id, { name: e.target.value })} aria-label="What the game calls it" />
                </div>
              </div>
              <label className="mt-3 block text-sm font-bold text-navy-700">
                Usually kept at
                <select className={`${field} mt-1`} value={o.spotId} onChange={(e) => updateObject(o.id, { spotId: e.target.value })}>
                  <option value="">Choose a place…</option>
                  {spots.map((s, i) => (
                    <option key={s.id} value={s.id}>
                      {i + 1}. {s.label || "unnamed place"}
                    </option>
                  ))}
                </select>
              </label>
              <p className="mt-2 text-sm text-navy-600">Question: &ldquo;Where do you usually keep your {o.name}?&rdquo;</p>
              <div className="mt-3 rounded-2xl bg-ivory-100 p-3">
                <p className="text-sm font-bold text-navy-700">
                  Clue in {player.name}&apos;s own voice {o.clue ? <span className="text-sage-700">· recorded</span> : <span className="text-clay-500">· not recorded yet</span>}
                </p>
                <p className="mt-1 text-sm text-navy-600">Ask {player.name} to say a hint, e.g. &ldquo;They&apos;re with the fruit, in the blue one.&rdquo;</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {o.clue && recordingFor !== o.id && (
                    <Button variant="ivory" size="sm" icon={<PlayIcon size={16} />} onClick={() => void new Audio(o.clue!.url).play()}>
                      Play
                    </Button>
                  )}
                  {recordingFor === o.id ? (
                    <RecordButton
                      mic={mic}
                      size="md"
                      label="Start recording"
                      stopLabel="Stop and keep"
                      maxMs={30_000}
                      className="w-full"
                      onRecorded={async (rec) => {
                        setRecordingFor(null);
                        try {
                          const m = await uploadMedia(rec.blob, { durationMs: rec.durationMs });
                          updateObject(o.id, { clue: { mediaId: m.id, url: m.url } });
                        } catch (err) {
                          setError((err as Error).message);
                        }
                      }}
                      onError={(m) => {
                        setRecordingFor(null);
                        setError(m);
                      }}
                    />
                  ) : (
                    <Button variant="gold" size="sm" onClick={() => setRecordingFor(o.id)}>
                      {o.clue ? "Record again" : "Record clue"}
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      </Section>

      <Section title="4. Difficulty">
        <div className="grid gap-2 md:grid-cols-2">
          {(
            [
              ["gentle", "Gentle", "Place names are shown on the photo."],
              ["standard", "Standard", "Places are marked on the photo; names appear only on tablets."],
            ] as const
          ).map(([id, label, text]) => (
            <button
              key={id}
              type="button"
              onClick={() => setDifficulty(id)}
              aria-pressed={difficulty === id}
              className={`rounded-3xl border-2 bg-white p-4 text-left shadow-card ${difficulty === id ? "border-gold-400" : "border-transparent"}`}
            >
              <span className="block text-lg font-bold">{label}</span>
              <span className="block text-base text-navy-700">{text}</span>
            </button>
          ))}
        </div>
      </Section>

      <div className="sticky bottom-0 -mx-4 border-t border-ivory-300 bg-ivory-50/95 px-4 py-3 backdrop-blur safe-bottom">
        {signatureChanged && <p className="mb-2 text-sm font-bold text-gold-700">These changes start a new usual level for alerts (5 rounds).</p>}
        {error && <p className="mb-2 text-base font-bold text-clay-500">{error}</p>}
        {status && <p className="mb-2 text-base font-bold text-sage-700">{status}</p>}
        <Button variant="gold" size="lg" className="w-full md:w-auto" icon={saving ? <Spinner /> : <CheckIcon size={22} />} onClick={() => void save()} disabled={saving}>
          Save room
        </Button>
      </div>
    </FamilyShell>
  );
}
