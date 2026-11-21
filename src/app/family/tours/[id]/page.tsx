"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { FamilyShell } from "@/components/family/FamilyShell";
import { Button, Card, Spinner } from "@/components/ui";
import { ArrowLeftIcon, ArrowRightIcon, PauseIcon, PlayIcon } from "@/components/icons";
import { getJson } from "@/lib/client/api";

interface Note {
  id: string;
  url: string;
  kind: string;
  transcript: string | null;
}
interface Step {
  id: string;
  stop: { id: string; name: string; photoUrl: string };
  viaDirection: string | null;
  viaLabel: string | null;
  arrivedAt: string;
  notes: Note[];
}
interface Tour {
  id: string;
  routeName: string;
  startedAt: string;
  steps: Step[];
}

const ANIM: Record<string, string> = {
  left: "animate-from-left",
  right: "animate-from-right",
  straight: "animate-from-ahead",
  back: "animate-fade-in",
};

function how(step: Step, i: number) {
  if (i === 0) return "Started at";
  if (step.viaDirection === "back") return "Went back to";
  if (step.viaDirection === "left") return "Turned left to";
  if (step.viaDirection === "right") return "Turned right to";
  return "Walked on to";
}

/** A relative replays the exact route, hearing the player narrate it. */
export default function TourReplay() {
  const params = useParams<{ id: string }>();
  const [tour, setTour] = useState<Tour | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [noteIndex, setNoteIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getJson<{ tour: Tour }>(`/api/tours/${params.id}`)
      .then((r) => setTour(r.tour))
      .catch(() => setError("This tour couldn't be found."));
    return () => {
      audio.current?.pause();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [params.id]);

  const stopAll = useCallback(() => {
    audio.current?.pause();
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  // Plays the notes of one step, then moves on to the next step.
  function playStep(i: number) {
    if (!tour) return;
    const t = tour;
    stopAll();
    setIndex(i);
    const step = t.steps[i];
    const next = () => {
      if (i + 1 < t.steps.length) timer.current = setTimeout(() => playStep(i + 1), 900);
      else {
        setPlaying(false);
        setNoteIndex(-1);
      }
    };
    const playNote = (n: number) => {
      if (n >= step.notes.length) {
        setNoteIndex(-1);
        if (step.notes.length === 0) timer.current = setTimeout(next, 2600);
        else next();
        return;
      }
      setNoteIndex(n);
      if (!audio.current) audio.current = new Audio();
      audio.current.src = step.notes[n].url;
      audio.current.onended = () => playNote(n + 1);
      audio.current.onerror = () => playNote(n + 1);
      audio.current.play().catch(() => playNote(n + 1));
    };
    timer.current = setTimeout(() => playNote(0), 700);
  }

  function toggle() {
    if (playing) {
      stopAll();
      setPlaying(false);
    } else {
      setPlaying(true);
      playStep(index >= (tour?.steps.length ?? 1) - 1 && noteIndex === -1 ? 0 : index);
    }
  }

  function go(i: number) {
    if (!tour) return;
    const j = Math.max(0, Math.min(tour.steps.length - 1, i));
    if (playing) playStep(j);
    else {
      stopAll();
      setIndex(j);
      setNoteIndex(-1);
    }
  }

  if (error) {
    return (
      <FamilyShell title="Tour replay">
        <Card className="p-5 text-lg">{error}</Card>
      </FamilyShell>
    );
  }
  if (!tour) {
    return (
      <FamilyShell title="Tour replay">
        <Spinner />
      </FamilyShell>
    );
  }

  const step = tour.steps[index];
  const note = noteIndex >= 0 ? step.notes[noteIndex] : null;
  return (
    <FamilyShell
      title="Walk the route again"
      intro={`${tour.routeName} · ${new Date(tour.startedAt).toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}`}
    >
      <div className="grid gap-5 md:grid-cols-[1.5fr_1fr]">
        <div>
          <div className="photo-frame">
            <div className="relative aspect-[4/3] overflow-hidden rounded-[0.9rem] bg-navy-900">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img key={`${step.id}`} src={step.stop.photoUrl} alt={step.stop.name} className={`absolute inset-0 h-full w-full object-cover ${ANIM[step.viaDirection ?? ""] ?? "animate-fade-in"}`} />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-navy-950/85 to-transparent p-4 pt-12 text-ivory-50">
                <p className="text-sm font-bold uppercase tracking-wider text-gold-300">
                  Stop {index + 1} of {tour.steps.length} · {how(step, index)}
                </p>
                <p className="font-display text-2xl font-semibold">{step.stop.name}</p>
              </div>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-[auto_1fr_auto] gap-2">
            <Button variant="ivory" size="lg" icon={<ArrowLeftIcon size={22} />} onClick={() => go(index - 1)} disabled={index === 0} aria-label="Previous stop" />
            <Button variant="gold" size="lg" icon={playing ? <PauseIcon size={22} /> : <PlayIcon size={22} />} onClick={toggle}>
              {playing ? "Pause" : index === 0 && noteIndex === -1 ? "Play the walk" : "Play from here"}
            </Button>
            <Button variant="ivory" size="lg" icon={<ArrowRightIcon size={22} />} onClick={() => go(index + 1)} disabled={index >= tour.steps.length - 1} aria-label="Next stop" />
          </div>
        </div>
        <div>
          <Card className="p-4">
            <p className="text-sm font-bold text-navy-600">{note ? (note.kind === "note" ? "Voice note" : "In their words") : step.notes.length ? `${step.notes.length} recording${step.notes.length === 1 ? "" : "s"} here` : "No recordings at this stop"}</p>
            {note?.transcript ? (
              <p className="mt-1 font-display text-xl leading-snug">“{note.transcript}”</p>
            ) : note ? (
              <p className="mt-1 text-lg text-navy-700">Playing…</p>
            ) : null}
          </Card>
          <ol className="mt-4 space-y-2">
            {tour.steps.map((s, i) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => go(i)}
                  className={`flex w-full items-center gap-3 rounded-2xl p-2 text-left ${i === index ? "bg-navy-800 text-ivory-50" : "bg-white shadow-card"}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.stop.photoUrl} alt="" className="size-12 shrink-0 rounded-xl object-cover" />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-xs font-bold uppercase tracking-wider ${i === index ? "text-gold-300" : "text-navy-500"}`}>{how(s, i)}</span>
                    <span className="block truncate font-bold">{s.stop.name}</span>
                  </span>
                  {s.notes.length > 0 && (
                    <span className="text-sm font-bold">
                      {s.notes.length} rec.
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </FamilyShell>
  );
}
