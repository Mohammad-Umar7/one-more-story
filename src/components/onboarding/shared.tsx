"use client";

import type { ReactNode } from "react";
import type { OnboardingState } from "@/lib/server/companion";
import type { Guide } from "./useGuide";

export type { OnboardingState };

export interface StepProps {
  state: OnboardingState;
  guide: Guide;
  refresh: () => Promise<OnboardingState | null>;
  setState: (s: OnboardingState) => void;
  /** Move on to the next screen (the page decides which). */
  next: () => void;
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Something went wrong");
  return data as T;
}

export async function postForm<T>(url: string, form: FormData): Promise<T> {
  const res = await fetch(url, { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Something went wrong");
  return data as T;
}

export function StepTitle({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <div className="text-center">
      <p className="text-sm font-bold tracking-wide text-gold-300">{eyebrow}</p>
      <h1 className="mt-1 text-[2rem] font-bold leading-tight text-ivory-50 md:text-4xl">{title}</h1>
      {children && <div className="mx-auto mt-2 max-w-md text-lg leading-relaxed text-ivory-200">{children}</div>}
    </div>
  );
}

export function GoldButton({
  children,
  onClick,
  disabled,
  type = "button",
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`flex min-h-16 w-full items-center justify-center gap-3 rounded-[1.6rem] bg-gradient-to-b from-gold-300 to-gold-400 px-6 text-xl font-bold text-navy-950 shadow-gold transition-transform active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100 ${className}`}
    >
      {children}
    </button>
  );
}

export function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-12 rounded-full border px-4 text-base font-bold transition-colors ${
        active ? "border-gold-300 bg-gold-400 text-navy-950" : "border-white/20 bg-white/8 text-ivory-100 hover:bg-white/14"
      }`}
    >
      {children}
    </button>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-base font-bold text-ivory-200">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  "w-full min-h-14 rounded-2xl border border-white/20 bg-white/10 px-4 text-xl text-ivory-50 placeholder:text-ivory-200/45 focus:border-gold-300 focus:outline-none";
