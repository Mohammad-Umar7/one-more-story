"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeftIcon } from "../icons";

const NAV = [
  { href: "/family", label: "Overview" },
  { href: "/family/setup/people", label: "People & alerts" },
  { href: "/family/setup/room", label: "Memory Room" },
  { href: "/family/setup/photos", label: "Story photos" },
  { href: "/family/setup/street", label: "Street" },
];

export function FamilyShell({ title, intro, children }: { title: string; intro?: string; children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="min-h-dvh bg-ivory-50">
      <header className="sticky top-0 z-30 border-b border-ivory-300 bg-navy-900 text-ivory-50 safe-top">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          <Link href="/" className="flex h-11 items-center gap-2 rounded-xl px-2 text-base font-bold text-gold-200 hover:bg-navy-800">
            <ArrowLeftIcon size={20} /> Games
          </Link>
          <p className="flex-1 truncate text-center font-display text-lg font-semibold">Family corner</p>
          <span className="w-[4.5rem]" aria-hidden="true" />
        </div>
        <nav className="mx-auto max-w-5xl overflow-x-auto px-2 pb-2" aria-label="Family sections">
          <ul className="flex min-w-max gap-1">
            {NAV.map((n) => {
              const on = pathname === n.href;
              return (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    aria-current={on ? "page" : undefined}
                    className={`flex h-10 items-center rounded-full px-4 text-sm font-bold ${
                      on ? "bg-gold-400 text-navy-950" : "text-ivory-100 hover:bg-navy-800"
                    }`}
                  >
                    {n.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 pb-16 pt-6">
        <h1 className="font-display text-3xl font-semibold text-navy-900 md:text-4xl">{title}</h1>
        {intro && <p className="mt-2 max-w-2xl text-lg text-navy-700">{intro}</p>}
        <div className="mt-6">{children}</div>
      </main>
    </div>
  );
}

export function Section({ title, action, children, id }: { title: string; action?: React.ReactNode; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="mb-10 scroll-mt-28">
      <div className="mb-3 flex items-end justify-between gap-3">
        <h2 className="font-display text-2xl font-semibold text-navy-900">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
