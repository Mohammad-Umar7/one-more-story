"use client";

import { useEffect, useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { FamilyShell, Section } from "@/components/family/FamilyShell";
import { Button, Card, Spinner } from "@/components/ui";
import { ArrowUpIcon, CameraIcon, CheckIcon, TrashIcon } from "@/components/icons";
import { sendJson, shrinkImage, uploadMedia } from "@/lib/client/api";

interface PhotoDraft {
  id?: string;
  mediaId: string;
  url: string;
  title: string;
}

export default function PhotosSetup() {
  const { bundle, reload } = useApp();
  const [photos, setPhotos] = useState<PhotoDraft[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (bundle && photos === null) setPhotos(bundle.photos.map((p) => ({ id: p.id, mediaId: p.photo.id, url: p.photo.url, title: p.title })));
  }, [bundle, photos]);

  async function add(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setMsg(null);
    try {
      const added: PhotoDraft[] = [];
      for (const f of Array.from(files)) {
        const m = await uploadMedia(await shrinkImage(f));
        added.push({ mediaId: m.id, url: m.url, title: "" });
      }
      setPhotos((ps) => [...(ps ?? []), ...added]);
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!photos) return;
    setBusy(true);
    setMsg(null);
    try {
      await sendJson("/api/setup/photos", { photos: photos.map((p) => ({ id: p.id, mediaId: p.mediaId, title: p.title || "Family photo" })) }, "PUT");
      await reload();
      setPhotos(null);
      setMsg("Saved.");
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const move = (i: number) =>
    setPhotos((ps) => {
      if (!ps || i === 0) return ps;
      const next = [...ps];
      [next[i - 1], next[i]] = [next[i], next[i - 1]];
      return next;
    });

  return (
    <FamilyShell
      title="Story photos"
      intro="The player tells each story in their own words; your notes are never read aloud."
    >
      <Section
        title="Photos"
        action={
          <>
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => void add(e.target.files)} />
            <Button variant="ivory" size="md" icon={busy ? <Spinner /> : <CameraIcon size={20} />} onClick={() => fileRef.current?.click()} disabled={busy}>
              Add photos
            </Button>
          </>
        }
      >
        {!photos ? (
          <Spinner />
        ) : photos.length === 0 ? (
          <Card className="p-5 text-lg text-navy-700">No photos yet. Add a few familiar ones: a wedding, a team, a first car, a holiday.</Card>
        ) : (
          <ol className="grid gap-3 md:grid-cols-2">
            {photos.map((p, i) => (
              <li key={`${p.mediaId}-${i}`}>
                <Card className="overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt="" className="aspect-[4/3] w-full object-cover" />
                  <div className="flex items-center gap-2 p-3">
                    <input
                      className="min-w-0 flex-1 rounded-xl border border-ivory-400 bg-white px-3 py-2 text-base"
                      placeholder="Family note (not read to the player)"
                      value={p.title}
                      onChange={(e) => setPhotos((ps) => ps!.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                    />
                    <button type="button" aria-label="Move earlier" className="rounded-xl p-2 text-navy-500 disabled:opacity-30" disabled={i === 0} onClick={() => move(i)}>
                      <ArrowUpIcon size={20} />
                    </button>
                    <button type="button" aria-label="Remove photo" className="rounded-xl p-2 text-navy-400 hover:text-clay-500" onClick={() => setPhotos((ps) => ps!.filter((_, j) => j !== i))}>
                      <TrashIcon size={20} />
                    </button>
                  </div>
                </Card>
              </li>
            ))}
          </ol>
        )}
      </Section>
      <div className="flex items-center gap-3">
        <Button variant="gold" size="lg" icon={busy ? <Spinner /> : <CheckIcon size={22} />} onClick={() => void save()} disabled={busy || !photos}>
          Save photos
        </Button>
        {msg && <p className="text-base font-bold text-navy-700">{msg}</p>}
      </div>
    </FamilyShell>
  );
}
