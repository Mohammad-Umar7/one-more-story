"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useApp, useScreen } from "@/components/AppProvider";
import { VoiceDock } from "@/components/VoiceDock";
import { ChevronRightIcon, UsersIcon } from "@/components/icons";
import type { ScreenController } from "@/lib/client/voice-engine";

const GAMES = [
  {
    id: "memory",
    href: "/play/memory",
    title: "My Memory Room",
    blurb: "Find your things in your own room",
    aliases: ["memory", "room", "memory room", "find things", "my things", "glasses", "first one"],
  },
  {
    id: "story",
    href: "/play/story",
    title: "Tell the Story",
    blurb: "Share a memory about a family photo",
    aliases: ["story", "stories", "photo", "photos", "picture", "tell a story", "cricket", "second one"],
  },
  {
    id: "street",
    href: "/play/street",
    title: "Show Me Your Street",
    blurb: "Be the guide on a walk down your street",
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
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-6 pt-6 safe-top md:px-8 md:pt-10">
        <header className="mb-6 animate-fade-up md:mb-8">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-gold-600">One More Story</p>
          <h1 className="mt-2 font-display text-4xl font-semibold leading-tight text-navy-900 md:text-6xl">
            {now ? greetingWord(now.getHours()) : "Hello"}
            {name ? `, ${name}` : ""}
          </h1>
          <p className="mt-2 text-xl text-navy-700 md:text-2xl">
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
        <ul className="grid gap-4 md:grid-cols-3 md:gap-6">
          {GAMES.map((g, i) => (
            <li key={g.id} className="animate-fade-up" style={{ animationDelay: `${80 + i * 90}ms` }}>
              <Link
                href={g.href}
                className="group flex items-stretch gap-0 overflow-hidden rounded-[1.75rem] border border-ivory-300/80 bg-white shadow-card transition-transform active:scale-[0.99] md:flex-col"
              >
                <div className="relative w-[42%] shrink-0 overflow-hidden bg-ivory-200 md:aspect-[4/3] md:w-full">
                  {photos[g.id] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={photos[g.id]}
                      alt=""
                      className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
                    />
                  ) : null}
                </div>
                <div className="flex min-h-32 flex-1 items-center gap-2 p-4 md:p-5">
                  <div className="flex-1">
                    <p className="text-sm font-bold uppercase tracking-[0.14em] text-gold-600">Game {i + 1}</p>
                    <h3 className="mt-1 font-display text-2xl font-semibold leading-tight text-navy-900 md:text-3xl">{g.title}</h3>
                    <p className="mt-1 text-base text-navy-700 md:text-lg">{g.blurb}</p>
                  </div>
                  <ChevronRightIcon size={28} className="shrink-0 text-gold-500" />
                </div>
              </Link>
            </li>
          ))}
        </ul>

        <div className="mt-8 flex justify-center">
          <Link
            href="/family"
            className="inline-flex min-h-12 items-center gap-2 rounded-full px-4 text-base font-bold text-navy-600 underline-offset-4 hover:underline"
          >
            <UsersIcon size={20} />
            For family: setup, alerts and saved stories
          </Link>
        </div>
      </main>
      <VoiceDock hint="Tap a game, or tap Start voice and just tell me which one." />
    </div>
  );
}
