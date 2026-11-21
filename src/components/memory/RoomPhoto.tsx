"use client";

import type { RoomObject, RoomSpot } from "@/lib/shared/types";
import { ObjectIcon } from "../ObjectIcon";
import { CheckIcon } from "../icons";

/** The room photo with tappable places. Found objects appear where they live. */
export function RoomPhoto({
  photoUrl,
  spots,
  found,
  wrongSpotId,
  revealSpotId,
  showLabels,
  interactive,
  onChoose,
}: {
  photoUrl: string;
  spots: RoomSpot[];
  found: { object: RoomObject; spotId: string }[];
  wrongSpotId: string | null;
  revealSpotId: string | null;
  showLabels: boolean;
  interactive: boolean;
  onChoose: (spotId: string) => void;
}) {
  return (
    <div className="photo-frame">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[0.9rem] bg-ivory-200">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photoUrl} alt="Your living room" className="absolute inset-0 h-full w-full object-cover" />
        {spots.map((s) => {
          const foundHere = found.filter((f) => f.spotId === s.id);
          const isWrong = wrongSpotId === s.id;
          const isReveal = revealSpotId === s.id;
          return (
            <div
              key={s.id}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%` }}
            >
              <button
                type="button"
                disabled={!interactive}
                onClick={() => onChoose(s.id)}
                aria-label={s.label}
                className={`group relative flex size-12 items-center justify-center rounded-full md:size-14 ${interactive ? "" : "pointer-events-none"}`}
              >
                {foundHere.length > 0 ? (
                  <span className="relative flex size-11 items-center justify-center rounded-full border-[3px] border-gold-400 bg-white shadow-photo animate-pop md:size-14">
                    <ObjectIcon icon={foundHere[foundHere.length - 1].object.icon} size={30} />
                    <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-sage-500 text-white">
                      <CheckIcon size={13} strokeWidth={3.5} />
                    </span>
                  </span>
                ) : (
                  <span
                    className={`block rounded-full border-[3px] transition-all duration-300 ${
                      isReveal
                        ? "size-11 border-white bg-gold-400 animate-glow md:size-12"
                        : isWrong
                          ? "size-8 border-white/80 bg-navy-700/70"
                          : interactive
                            ? "size-8 border-white bg-gold-400/80 shadow-[0_0_0_4px_rgb(12_26_66/0.25)] animate-glow md:size-9"
                            : "size-6 border-white/80 bg-gold-300/60"
                    }`}
                  />
                )}
              </button>
              {(showLabels || isReveal || isWrong) && foundHere.length === 0 && (
                <span
                  className={`pointer-events-none absolute left-1/2 top-full mt-0.5 -translate-x-1/2 whitespace-nowrap rounded-full px-2.5 py-0.5 text-sm font-bold shadow-card ${
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
