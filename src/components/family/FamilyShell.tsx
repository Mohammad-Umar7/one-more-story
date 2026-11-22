"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeftIcon } from "../icons";

/** Family area frame: a back button, a title, and calm, roomy content. */
export function FamilyShell({ title, intro, children }: { title?: string; intro?: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const onOverview = pathname === "/family";
  return (
    <div className="min-h-dvh bg-ivory-50">
      <header className="sticky top-0 z-30 bg-ivory-50/90 backdrop-blur-md safe-top">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-3 px-4">
          <Link
            href={onOverview ? "/" : "/family"}
            className="flex h-11 items-center gap-1.5 rounded-full bg-white px-4 text-base font-bold text-navy-800 shadow-card"
          >
            <ArrowLeftIcon size={18} /> {onOverview ? "Games" : "Family"}
          </Link>
          <p className="ml-auto text-sm font-bold text-gold-600">Family corner</p>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-16 pt-2">
        {title && <h1 className="font-display text-[2rem] font-bold leading-tight text-navy-900 md:text-4xl">{title}</h1>}
        {intro && <p className="mt-1 max-w-2xl text-lg text-navy-700">{intro}</p>}
        <div className={title ? "mt-6" : ""}>{children}</div>
      </main>
    </div>
  );
}

export function Section({ title, action, children, id }: { title: string; action?: React.ReactNode; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="mb-8 scroll-mt-20">
      <div className="mb-3 flex items-end justify-between gap-3">
        <h2 className="font-display text-2xl font-bold text-navy-900">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
