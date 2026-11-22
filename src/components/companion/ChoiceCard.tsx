"use client";

import type { GameChoice, GameItem } from "@/lib/shared/companion";

export type ChoiceState = "idle" | "tried" | "right" | "hint";

/**
 * One question with its picture and big answer cards. Works for "who is
 * this", story questions, finishing a sentence, favourite things, and the
 * in-order game (where each tap adds the next number).
 */
export function ChoiceCard({
  item,
  states,
  order,
  locked,
  onChoose,
}: {
  item: GameItem;
  states: Record<string, ChoiceState>;
  /** In-order game: the choice ids tapped so far. */
  order?: string[] | null;
  locked: boolean;
  onChoose: (choice: GameChoice) => void;
}) {
  const hasImages = item.choices.some((c) => c.imageUrl);
  const n = item.choices.length;
  const cols = hasImages ? "grid-cols-2" : n === 2 ? "grid-cols-2" : n === 4 ? "grid-cols-2" : "grid-cols-1";

  return (
    <div className="flex w-full flex-col gap-4">
      {item.imageUrl && (
        <div className="relative mx-auto w-full max-w-md animate-from-ahead">
          <div className="absolute -inset-3 rounded-[2.4rem] bg-gradient-to-br from-[#c4b5fd]/70 via-[#f0abfc]/30 to-[#93c5fd]/60 blur-xl" aria-hidden="true" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.imageUrl}
            alt=""
            className="photo-float relative aspect-[4/3] max-h-[34dvh] w-full rounded-[2rem] object-cover"
          />
        </div>
      )}
      <h2 className="text-glow text-center text-[1.7rem] font-bold leading-tight md:text-4xl">{item.prompt}</h2>
      <ul className={`grid gap-3 ${cols}`}>
        {item.choices.map((c, i) => {
          const state = states[c.id] ?? "idle";
          const place = order ? order.indexOf(c.id) : -1;
          return (
            <li key={c.id} className="animate-fade-up" style={{ animationDelay: `${120 + i * 90}ms` }}>
              <button
                type="button"
                disabled={locked || state === "tried" || (order ? place !== -1 : false)}
                onClick={() => onChoose(c)}
                data-state={state}
                className={`choice glass relative flex w-full items-center gap-4 rounded-[1.6rem] p-3 text-left ${
                  c.imageUrl ? "flex-col text-center" : "min-h-[5.5rem]"
                } disabled:cursor-default`}
              >
                {c.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.imageUrl} alt="" className="aspect-[4/3] w-full rounded-2xl object-cover" />
                ) : c.emoji ? (
                  <span className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#f3edff] to-[#fbe7fb] text-[2.4rem] leading-none shadow-inner" aria-hidden="true">
                    {c.emoji}
                  </span>
                ) : null}
                <span className="min-w-0 flex-1 text-[1.45rem] font-bold leading-tight text-ivory-50">{c.label}</span>
                {place !== -1 && (
                  <span className="absolute -right-2 -top-2 flex size-11 items-center justify-center rounded-full bg-gold-400 text-xl font-bold text-navy-950 shadow-gold animate-pop">
                    {place + 1}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
