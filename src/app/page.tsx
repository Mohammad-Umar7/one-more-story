"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useApp, useScreen } from "@/components/AppProvider";
import { VoiceDock } from "@/components/VoiceDock";
import { ChevronRightIcon } from "@/components/icons";
import type { ScreenController } from "@/lib/client/voice-engine";

const GAMES = [
  {
    id: "memory",
    href: "/play/memory",
    title: "My Memory Room",
    blurb: "Find your things",
    aliases: ["memory", "room", "memory room", "find things", "my things", "glasses", "first one"],
  },
  {
    id: "story",
    href: "/play/story",
    title: "Tell the Story",
    blurb: "Share a memory",
    aliases: ["story", "stories", "photo", "photos", "picture", "tell a story", "cricket", "second one"],
  },
  {
    id: "street",
    href: "/play/street",
    title: "Show Me Your Street",
    blurb: "Be the tour guide",
    aliases: ["street", "walk", "tour", "bakery", "my street", "neighbourhood", "neighborhood", "guide", "third one", "last one"],
  },
] as const;

function greetingWord(h: number) {
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function HomePage() {
  const { bundle, loadError } = useApp();
  const router = useRouter();
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const name = bundle?.player.name ?? "";
  const photos: Record<string, string | undefined> = {
    memory: bundle?.room?.photo.url,
    story: bundle?.photos[0]?.photo.url,
    street: bundle?.route?.stops.find((s) => /bakery/i.test(s.name))?.photo.url ?? bundle?.route?.stops[0]?.photo.url,
  };

  const ctrl: ScreenController | null = bundle
    ? {
        id: "home",
        context: () => ({
          game: "home",
          screen: "choose",
          version: "home",
          scene: "The start screen with three games to choose from.",
          question: "Which game would you like to play?",
          actions: [
            {
              name: "open_game",
              description: "Open one of the three games.",
              targets: GAMES.map((g) => ({ id: g.id, label: g.title, aliases: [...g.aliases] })),
            },
          ],
        }),
        greeting: () =>
          `Hello ${name}. I'm here with you. Would you like to find things in your room, share a story about a photo, or show me your street?`,
        repeatLine: () => "Would you like to find things in your room, share a story about a photo, or show me your street?",
        act: (action, target) => {
          const game = GAMES.find((g) => g.id === target);
          if (action === "open_game" && game) {
            router.push(game.href);
            return { speak: null };
          }
        },
      }
    : null;
  useScreen(ctrl);

  return (
    <div className="flex min-h-dvh flex-col">
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-4 pt-5 safe-top md:px-8 md:pt-10">
        <header className="mb-5 animate-fade-up md:mb-8">
          <h1 className="font-display text-[2.2rem] font-semibold leading-[1.1] text-navy-900 md:text-6xl">
            {now ? greetingWord(now.getHours()) : "Hello"}
            {name ? `, ${name}` : ""}
          </h1>
          <p className="mt-1.5 text-xl text-navy-700 md:text-2xl">
            {now
              ? new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(now)
              : " "}
          </p>
        </header>

        {loadError && (
          <p className="mb-4 rounded-2xl bg-white p-4 text-lg text-clay-500 shadow-card">
            Couldn&apos;t load the games. Please check the connection and reload.
          </p>
        )}

        <h2 className="sr-only">Choose a game</h2>
        <ul className="grid gap-3 md:grid-cols-3 md:gap-6">
          {GAMES.map((g, i) => (
            <li key={g.id} className="animate-fade-up" style={{ animationDelay: `${60 + i * 80}ms` }}>
              <Link
                href={g.href}
                className="group flex items-center gap-4 rounded-3xl bg-white p-2.5 pr-4 shadow-card transition-transform active:scale-[0.99] md:flex-col md:items-stretch md:gap-0 md:overflow-hidden md:p-0"
              >
                <span className="relative size-24 shrink-0 overflow-hidden rounded-2xl bg-ivory-200 md:aspect-[4/3] md:h-auto md:w-full md:rounded-none">
                  {photos[g.id] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photos[g.id]} alt="" className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]" />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1 md:p-5">
                  <span className="block font-display text-2xl font-semibold leading-tight md:text-3xl">{g.title}</span>
                  <span className="mt-0.5 block text-base text-navy-700 md:text-lg">{g.blurb}</span>
                </span>
                <ChevronRightIcon size={26} className="shrink-0 text-gold-500 md:hidden" />
              </Link>
            </li>
          ))}
        </ul>

        <Link href="/family" className="mt-6 inline-flex min-h-12 items-center px-1 text-base font-bold text-navy-600 underline-offset-4 hover:underline">
          For family
        </Link>
      </main>
      <VoiceDock />
    </div>
  );
}
