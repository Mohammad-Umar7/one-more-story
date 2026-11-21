import type { Metadata } from "next";

// The caregiver's phone installs this page (iPhone needs Add to Home Screen
// before web notifications work), so it gets its own manifest and start URL.
export const metadata: Metadata = {
  title: "Caregiver alerts · One More Story",
  manifest: "/caregiver.webmanifest",
  appleWebApp: { capable: true, title: "OMS Alerts", statusBarStyle: "default" },
};

export default function CaregiverLayout({ children }: { children: React.ReactNode }) {
  return children;
}
