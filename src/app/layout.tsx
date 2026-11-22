import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible } from "next/font/google";
import { AppProvider } from "@/components/AppProvider";
import "./globals.css";

// One font for everything: Atkinson Hyperlegible, designed by the Braille
// Institute for readers with low vision. Plain sans-serif, as dementia-friendly
// design guidance recommends (no serif or decorative display faces).
const atkinson = Atkinson_Hyperlegible({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-atkinson",
  display: "swap",
});

export const metadata: Metadata = {
  title: "One More Story",
  description:
    "Voice-guided memory games built from a family's own rooms, photos and streets, with gentle caregiver alerts.",
  applicationName: "One More Story",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "One More Story", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0c1a42",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={atkinson.variable}>
      <body className="paper">
        <AppProvider>{children}</AppProvider>
      </body>
    </html>
  );
}
