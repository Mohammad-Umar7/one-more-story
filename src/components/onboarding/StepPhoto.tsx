"use client";

import { useEffect, useRef, useState } from "react";
import { shrinkImage } from "@/lib/client/api";
import { Avatar } from "@/components/companion/Avatar";
import { CameraIcon, RefreshIcon } from "@/components/icons";
import { GoldButton, postForm, postJson, StepTitle, type OnboardingState, type StepProps } from "./shared";

/** The family member's photo, and the avatar the AI paints from it. */
export function StepPhoto({ state, setState, refresh, guide, next }: StepProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const m = state.member;
  const call = state.player.callName;
  const painting = m?.avatarStatus === "working";

  // While the avatar is being painted, check back every few seconds.
  useEffect(() => {
    if (!painting) return;
    const t = setInterval(() => void refresh(), 3000);
    return () => clearInterval(t);
  }, [painting, refresh]);

  // Say something when the painting arrives.
  const announced = useRef(false);
  useEffect(() => {
    if (m?.avatarStatus === "ready" && !announced.current) {
      announced.current = true;
      void guide.say(`Here you are. This is how ${call} will see you. You can keep the painting, or use your real photo.`);
    }
  }, [m?.avatarStatus, call, guide]);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    guide.unlock();
    setBusy(true);
    setError(null);
    announced.current = false;
    try {
      const blob = await shrinkImage(file, 1400, 0.9);
      const form = new FormData();
      form.append("file", blob, "me.jpg");
      setState(await postForm<OnboardingState>("/api/onboarding/photo", form));
      void guide.say("Lovely photo. I'm painting your avatar now. It takes about half a minute.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const choose = async (action: "repaint" | "use_photo" | "use_avatar") => {
    setError(null);
    try {
      setState(await postJson<OnboardingState>("/api/onboarding/avatar", { action }));
      if (action === "repaint") announced.current = false;
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const shown = m?.avatarUrl ?? m?.photoUrl ?? null;

  return (
    <div className="flex flex-col items-center gap-6">
      <StepTitle eyebrow="Step 2 · Your face" title={`A photo of you for ${call}`}>
        A clear photo of your face, smiling, in good light. I&apos;ll paint a warm avatar from it.
      </StepTitle>

      <div className="relative w-64 md:w-72">
        <Avatar src={shown} name={m?.name ?? "You"} speaking={guide.speaking} level={guide.level} painting={painting || busy} />
        {(painting || busy) && (
          <span className="absolute -bottom-3 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-navy-900/90 px-4 py-1.5 text-sm font-bold text-gold-200 shadow-card">
            {busy ? "Uploading…" : "Painting your avatar…"}
          </span>
        )}
      </div>

      {m?.photoUrl && m.avatarUrl && !painting && (
        <div className="glass flex w-full items-center gap-4 rounded-[2rem] p-4">
          <div className="flex flex-1 gap-3">
            {[
              { url: m.avatarUrl, label: "Painting", action: "use_avatar" as const },
              { url: m.photoUrl, label: "Real photo", action: "use_photo" as const },
            ].map((o) => {
              const active = shown === o.url;
              return (
                <button
                  key={o.label}
                  type="button"
                  onClick={() => void choose(o.action)}
                  className={`flex flex-1 flex-col items-center gap-2 rounded-2xl border p-2 ${active ? "border-gold-300 bg-gold-400/20" : "border-white/15"}`}
                  aria-pressed={active}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={o.url} alt="" className="aspect-square w-full rounded-xl object-cover" />
                  <span className="text-base font-bold">{o.label}</span>
                </button>
              );
            })}
          </div>
          <button type="button" onClick={() => void choose("repaint")} className="flex flex-col items-center gap-1 px-2 text-sm font-bold text-ivory-200">
            <RefreshIcon size={22} /> Paint again
          </button>
        </div>
      )}
      {m?.avatarStatus === "failed" && (
        <p className="text-center text-base font-bold text-gold-200">
          The painting didn&apos;t work this time. Your real photo will be used, or{" "}
          <button type="button" className="underline" onClick={() => void choose("repaint")}>
            try again
          </button>
          .
        </p>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void upload(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <div className="flex w-full flex-col gap-3">
        {!m?.photoUrl ? (
          <GoldButton onClick={() => fileRef.current?.click()} disabled={busy}>
            <CameraIcon size={26} /> Choose or take a photo
          </GoldButton>
        ) : (
          <>
            <GoldButton
              onClick={() => {
                guide.stop();
                next();
              }}
              disabled={busy}
            >
              {painting ? "Continue (painting finishes in the background)" : "Continue"}
            </GoldButton>
            <button type="button" onClick={() => fileRef.current?.click()} className="min-h-12 text-lg font-bold text-ivory-200 underline underline-offset-4">
              Use a different photo
            </button>
          </>
        )}
      </div>
      {error && <p className="text-center text-lg font-bold text-gold-200">{error}</p>}
    </div>
  );
}
