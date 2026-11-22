"use client";

import type { RoomObject, RoomSpot } from "@/lib/shared/types";
import { ObjectIcon } from "../ObjectIcon";
import { CheckIcon } from "../icons";

/**
 * The room photo with tappable places; this is the answer surface. Found
 * objects appear where they live. Place names: "always" (gentle difficulty),
 * "tablet" (shown on wider screens only, where there is room), or "never".
 */
export function RoomPhoto({
  photoUrl,
  spots,
  found,
  wrongSpotId,
  revealSpotId,
  labels,
  interactive,
  onChoose,
}: {
  photoUrl: string;
  spots: RoomSpot[];
  found: { object: RoomObject; spotId: string }[];
  wrongSpotId: string | null;
  revealSpotId: string | null;
  labels: "always" | "tablet" | "never";
  interactive: boolean;
  onChoose: (spotId: string) => void;
}) {
  return (
    <div className="photo-frame">
      <div className="room-photo relative aspect-[4/3] w-full overflow-hidden rounded-[0.9rem] bg-ivory-200">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photoUrl} alt="Your room" className="absolute inset-0 h-full w-full object-cover" />
        {spots.map((s) => {
          const foundHere = found.filter((f) => f.spotId === s.id);
          const isWrong = wrongSpotId === s.id;
          const isReveal = revealSpotId === s.id;
          const labelClass =
            isReveal || isWrong || labels === "always" ? "block" : labels === "tablet" ? "hidden md:block" : "hidden";
          return (
            <div key={s.id} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%` }}>
              <button
                type="button"
                disabled={!interactive}
                onClick={() => onChoose(s.id)}
                aria-label={s.label}
                className={`relative flex size-14 items-center justify-center rounded-full ${interactive ? "" : "pointer-events-none"}`}
              >
                {foundHere.length > 0 ? (
                  <span className="relative flex size-11 items-center justify-center rounded-full border-[3px] border-gold-400 bg-white shadow-photo animate-pop md:size-12">
                    <ObjectIcon icon={foundHere[foundHere.length - 1].object.icon} size={28} />
                    <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-sage-500 text-white">
                      <CheckIcon size={13} strokeWidth={3.5} />
                    </span>
                  </span>
                ) : (
                  // A see-through ring, so the object under it stays visible.
                  <span
                    className={`flex items-center justify-center rounded-full border-[3px] transition-all duration-300 ${
                      isReveal
                        ? "size-12 border-gold-300 bg-gold-400/40 animate-glow"
                        : isWrong
                          ? "size-10 border-navy-200 bg-navy-900/45"
                          : interactive
                            ? "size-10 border-white bg-gold-400/25 shadow-[0_0_0_2px_rgb(12_26_66/0.35),inset_0_0_0_2px_rgb(12_26_66/0.25)]"
                            : "size-7 border-white/80 bg-gold-300/20"
                    }`}
                  >
                    <span className={`rounded-full ${isWrong ? "size-2 bg-navy-200" : "size-2.5 bg-gold-400 shadow-[0_0_0_2px_white]"}`} />
                  </span>
                )}
              </button>
              {foundHere.length === 0 && (
                <span
                  className={`${labelClass} pointer-events-none absolute left-1/2 top-[85%] -translate-x-1/2 whitespace-nowrap rounded-full px-2.5 py-0.5 text-sm font-bold shadow-card ${
                    isWrong ? "bg-navy-800 text-ivory-50" : "bg-white/95 text-navy-900"
                  }`}
                >
                  {s.label}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
