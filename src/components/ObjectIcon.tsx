// Friendly illustrations for the everyday objects in My Memory Room.

export const OBJECT_ICONS: { id: string; label: string }[] = [
  { id: "glasses", label: "Glasses" },
  { id: "keys", label: "Keys" },
  { id: "wallet", label: "Wallet" },
  { id: "beads", label: "Prayer beads" },
  { id: "watch", label: "Watch" },
  { id: "phone", label: "Phone" },
  { id: "remote", label: "TV remote" },
  { id: "pills", label: "Pill box" },
  { id: "hearing", label: "Hearing aid" },
  { id: "cup", label: "Favourite cup" },
  { id: "book", label: "Book" },
  { id: "bag", label: "Handbag" },
  { id: "box", label: "Something else" },
];

export function ObjectIcon({ icon, size = 64, className = "" }: { icon: string; size?: number; className?: string }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 64 64",
    fill: "none",
    strokeWidth: 3,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true,
  };
  const ink = "var(--color-navy-800)";
  const gold = "var(--color-gold-500)";
  const fill = "var(--color-gold-100)";
  switch (icon) {
    case "glasses":
      return (
        <svg {...common}>
          <circle cx="19" cy="36" r="11" stroke={ink} fill={fill} />
          <circle cx="45" cy="36" r="11" stroke={ink} fill={fill} />
          <path d="M30 34c1.5-2 2.5-2 4 0" stroke={ink} />
          <path d="M8 33 4 24M56 33l4-9" stroke={gold} />
        </svg>
      );
    case "keys":
      return (
        <svg {...common}>
          <circle cx="22" cy="22" r="11" stroke={ink} fill={fill} />
          <circle cx="22" cy="22" r="3.5" stroke={ink} />
          <path d="m30 30 20 20M42 42l5-5M47 47l5-5" stroke={gold} />
        </svg>
      );
    case "wallet":
      return (
        <svg {...common}>
          <rect x="8" y="16" width="44" height="34" rx="6" stroke={ink} fill={fill} />
          <path d="M40 28h16v12H40a6 6 0 0 1 0-12z" stroke={ink} fill="white" />
          <circle cx="42" cy="34" r="2" fill={gold} stroke="none" />
          <path d="M14 16l22-7 4 7" stroke={gold} />
        </svg>
      );
    case "beads":
      return (
        <svg {...common}>
          {Array.from({ length: 12 }).map((_, i) => {
            const a = (i / 12) * Math.PI * 2;
            return <circle key={i} cx={32 + Math.cos(a) * 17} cy={27 + Math.sin(a) * 15} r="3.6" fill={fill} stroke={ink} strokeWidth="2.2" />;
          })}
          <path d="M32 42v8" stroke={gold} />
          <path d="M28 50h8l-4 8z" fill={gold} stroke={gold} strokeWidth="2" />
        </svg>
      );
    case "watch":
      return (
        <svg {...common}>
          <rect x="23" y="4" width="18" height="12" rx="3" stroke={gold} />
          <rect x="23" y="48" width="18" height="12" rx="3" stroke={gold} />
          <circle cx="32" cy="32" r="16" stroke={ink} fill={fill} />
          <path d="M32 23v9l6 4" stroke={ink} />
        </svg>
      );
    case "phone":
      return (
        <svg {...common}>
          <rect x="18" y="6" width="28" height="52" rx="6" stroke={ink} fill={fill} />
          <path d="M28 12h8" stroke={gold} />
          <circle cx="32" cy="50" r="2.5" fill={gold} stroke="none" />
        </svg>
      );
    case "remote":
      return (
        <svg {...common}>
          <rect x="20" y="4" width="24" height="56" rx="8" stroke={ink} fill={fill} />
          <circle cx="32" cy="16" r="5" stroke={gold} />
          {[28, 36, 44].map((y) => (
            <g key={y}>
              <circle cx="27" cy={y} r="2" fill={ink} stroke="none" />
              <circle cx="37" cy={y} r="2" fill={ink} stroke="none" />
            </g>
          ))}
        </svg>
      );
    case "pills":
      return (
        <svg {...common}>
          <rect x="6" y="18" width="52" height="30" rx="6" stroke={ink} fill={fill} />
          <path d="M19 18v30M32 18v30M45 18v30" stroke={ink} strokeWidth="2" />
          <circle cx="12.5" cy="33" r="3" fill={gold} stroke="none" />
          <circle cx="38.5" cy="33" r="3" fill={gold} stroke="none" />
        </svg>
      );
    case "hearing":
      return (
        <svg {...common}>
          <path d="M24 46c-6-4-10-10-10-18a16 16 0 0 1 32 0c0 8-8 10-8 18a6 6 0 0 1-12 0" stroke={ink} fill={fill} />
          <path d="M24 30a6 6 0 0 1 12 0" stroke={gold} />
        </svg>
      );
    case "cup":
      return (
        <svg {...common}>
          <path d="M12 22h32v18a14 14 0 0 1-14 14h-4a14 14 0 0 1-14-14z" stroke={ink} fill={fill} />
          <path d="M44 28h4a6 6 0 0 1 0 12h-4" stroke={ink} />
          <path d="M22 8c-2 4 2 6 0 10M32 8c-2 4 2 6 0 10" stroke={gold} />
        </svg>
      );
    case "book":
      return (
        <svg {...common}>
          <path d="M8 14c8-3 16-3 24 2v36c-8-5-16-5-24-2z" stroke={ink} fill={fill} />
          <path d="M56 14c-8-3-16-3-24 2v36c8-5 16-5 24-2z" stroke={ink} fill="white" />
          <path d="M38 24c4-1 8-1 12 0M38 32c4-1 8-1 12 0" stroke={gold} />
        </svg>
      );
    case "bag":
      return (
        <svg {...common}>
          <path d="M10 24h44l-4 32H14z" stroke={ink} fill={fill} />
          <path d="M22 24v-6a10 10 0 0 1 20 0v6" stroke={gold} />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path d="M8 22 32 10l24 12v22L32 56 8 44z" stroke={ink} fill={fill} />
          <path d="M8 22l24 12 24-12M32 34v22" stroke={gold} />
        </svg>
      );
  }
}
