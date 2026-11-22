"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { NightSky } from "@/components/companion/NightSky";
import { Avatar } from "@/components/companion/Avatar";

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * Where the doctor's QR code lands: what this is, add it to the phone, and
 * begin. Once setup is done it points to the player's games instead.
 */
export default function Welcome() {
  const { bundle } = useApp();
  const [install, setInstall] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallPrompt);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    const standalone = window.matchMedia("(display-mode: standalone)").matches;
    queueMicrotask(() => {
      setInstalled(standalone);
      setIos(/iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone);
    });
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const call = bundle ? bundle.player.familyName || bundle.player.name : "";
  const ready = bundle?.onboarded;

  return (
    <div className="night">
      <NightSky />
      <main className="relative z-10 mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-7 px-5 py-10 text-center safe-top safe-bottom">
        <div className="w-48 animate-fade-up">
          <Avatar src={ready ? bundle?.companion?.avatarUrl : null} name="One More Story" speaking={false} />
        </div>
        <div className="animate-fade-up [animation-delay:120ms]">
          <p className="text-sm font-bold tracking-wide text-gold-200">Shared by your doctor</p>
          <h1 className="mt-2 text-[2.3rem] font-bold leading-tight">
            <span className="gold-text">One More Story</span>
          </h1>
          <p className="mt-3 text-xl leading-relaxed text-ivory-200">
            A few gentle games every day, made from their own life story, and led by the face and voice of someone they love: you.
          </p>
        </div>

        <ul className="glass w-full rounded-[2rem] p-5 text-left text-lg animate-fade-up [animation-delay:220ms]">
          {[
            ["You tell their story", "Talk for about 15 minutes. The AI listens like a biographer."],
            ["It learns your face and voice", "Your photo becomes a warm avatar; your voice greets them every day."],
            ["Games that adapt every day", "Early, middle or late stage: after each day the AI sets a new baseline and makes new games."],
          ].map(([title, text]) => (
            <li key={title} className="flex gap-3 py-2">
              <span className="mt-1.5 size-3 shrink-0 rounded-full bg-gradient-to-br from-[#c084fc] to-[#7c3aed]" aria-hidden="true" />
              <span>
                <span className="block font-bold">{title}</span>
                <span className="block text-base text-ivory-200">{text}</span>
              </span>
            </li>
          ))}
        </ul>

        <div className="flex w-full flex-col gap-3 animate-fade-up [animation-delay:320ms]">
          {ready ? (
            <>
              <Link href="/" className="flex min-h-16 items-center justify-center rounded-[1.6rem] bg-gradient-to-b from-gold-300 to-gold-400 px-6 text-xl font-bold text-navy-950 shadow-gold">
                Open {call}&apos;s games
              </Link>
              <Link href="/family" className="min-h-12 text-lg font-bold text-ivory-200 underline underline-offset-4">
                Family corner
              </Link>
            </>
          ) : (
            <>
              {install && !installed && (
                <button
                  type="button"
                  onClick={async () => {
                    await install.prompt();
                    const choice = await install.userChoice;
                    if (choice.outcome === "accepted") setInstalled(true);
                    setInstall(null);
                  }}
                  className="glass flex min-h-16 items-center justify-center rounded-[1.6rem] px-6 text-xl font-bold text-gold-200"
                >
                  Add to my phone
                </button>
              )}
              {ios && (
                <p className="glass rounded-2xl px-4 py-3 text-base text-ivory-200">
                  To add it to your iPhone: tap <span className="font-bold">Share</span>, then <span className="font-bold">Add to Home Screen</span>.
                </p>
              )}
              <Link href="/onboarding" className="flex min-h-16 items-center justify-center rounded-[1.6rem] bg-gradient-to-b from-gold-300 to-gold-400 px-6 text-xl font-bold text-navy-950 shadow-gold">
                Begin setup
              </Link>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
