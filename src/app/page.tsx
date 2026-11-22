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
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pb-3 pt-5 safe-top md:px-8 md:pt-10">
        <header className="flex items-start justify-between gap-3 animate-fade-up">
          <div>
            <h1 className="font-display text-[2.1rem] font-bold leading-[1.1] text-navy-900 md:text-6xl">
              {now ? greetingWord(now.getHours()) : "Hello"}
              {name ? `, ${name}` : ""}
            </h1>
            <p className="mt-1 text-xl text-navy-700 md:text-2xl">
              {now ? new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(now) : " "}
            </p>
          </div>
          <Link
            href="/family"
            className="mt-1 flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-white px-3.5 text-sm font-bold text-navy-700 shadow-card"
          >
            <UsersIcon size={18} /> Family
          </Link>
        </header>

        {loadError && (
          <p className="mt-4 rounded-2xl bg-white p-4 text-lg text-clay-500 shadow-card">
            Couldn&apos;t load the games. Please check the connection and reload.
          </p>
        )}

        <h2 className="sr-only">Choose a game</h2>
        {/* Three big photo cards that share the screen, so there is no empty space on a phone. */}
        <ul className="mt-5 flex flex-1 flex-col gap-3 md:grid md:flex-none md:grid-cols-3 md:gap-6">
          {GAMES.map((g, i) => (
            <li key={g.id} className="flex min-h-36 flex-1 animate-fade-up md:aspect-[4/5] md:min-h-0" style={{ animationDelay: `${60 + i * 80}ms` }}>
              <Link
                href={g.href}
                className="group relative flex w-full overflow-hidden rounded-3xl bg-navy-800 shadow-card transition-transform active:scale-[0.99]"
              >
                {photos[g.id] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photos[g.id]} alt="" className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]" />
                ) : null}
                <span className="absolute inset-0 bg-gradient-to-t from-navy-950/90 via-navy-950/35 to-transparent" aria-hidden="true" />
                <span className="relative mt-auto flex w-full items-end gap-3 p-4 md:p-5">
                  <span className="min-w-0 flex-1 text-ivory-50">
                    <span className="block font-display text-[1.65rem] font-bold leading-tight md:text-3xl">{g.title}</span>
                    <span className="block text-base text-ivory-100/90 md:text-lg">{g.blurb}</span>
                  </span>
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-gold-400 text-navy-950">
                    <ChevronRightIcon size={24} />
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </main>
      <VoiceDock />
    </div>
  );
}
