import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "gold" | "navy" | "ivory" | "ghost" | "danger";
type Size = "xl" | "lg" | "md" | "sm";

const variants: Record<Variant, string> = {
  gold: "bg-gold-400 text-navy-950 shadow-gold hover:bg-gold-300 active:bg-gold-500 border border-gold-500/40",
  navy: "bg-navy-800 text-ivory-50 shadow-card hover:bg-navy-700 active:bg-navy-900",
  ivory: "bg-white text-navy-900 shadow-card border border-ivory-300 hover:bg-ivory-50 active:bg-ivory-200",
  ghost: "bg-transparent text-navy-800 hover:bg-navy-100/60 active:bg-navy-100",
  danger: "bg-white text-clay-500 border border-clay-500/30 shadow-card hover:bg-ivory-50",
};

const sizes: Record<Size, string> = {
  xl: "min-h-[4.5rem] px-6 text-xl md:text-2xl gap-3 rounded-3xl",
  lg: "min-h-16 px-5 text-lg md:text-xl gap-3 rounded-2xl",
  md: "min-h-14 px-4 text-lg gap-2 rounded-2xl",
  sm: "min-h-11 px-3 text-base gap-2 rounded-xl",
};

export function Button({
  variant = "ivory",
  size = "lg",
  icon,
  children,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; icon?: ReactNode }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center font-bold leading-tight transition-[background,transform,box-shadow] duration-150 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 ${variants[variant]} ${sizes[size]} ${className}`}
      {...rest}
    >
      {icon ? <span className="shrink-0">{icon}</span> : null}
      {children ? <span>{children}</span> : null}
    </button>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-3xl bg-white/90 shadow-card border border-ivory-300/70 ${className}`}>{children}</div>;
}

export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`text-sm font-bold uppercase tracking-[0.14em] text-gold-600 ${className}`}>{children}</p>;
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block size-5 animate-spin rounded-full border-[3px] border-current border-t-transparent ${className}`}
      aria-hidden="true"
    />
  );
}
