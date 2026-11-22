"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { NightSky } from "@/components/companion/NightSky";

/**
 * For the clinic: a card with a QR code the doctor shows (or prints) when
 * they share the diagnosis. Scanning it opens the welcome page on the
 * family's phone, where they add the app and begin setup.
 */
export default function DoctorCard() {
  const [qr, setQr] = useState<string | null>(null);
  const [link, setLink] = useState("");

  useEffect(() => {
    const url = `${window.location.origin}/welcome`;
    setLink(url);
    void QRCode.toDataURL(url, { margin: 1, width: 560, errorCorrectionLevel: "M", color: { dark: "#2a1458", light: "#ffffff" } }).then(setQr);
  }, []);

  return (
    <div className="night">
      <NightSky />
      <main className="relative z-10 mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-6 px-5 py-10 text-center safe-top safe-bottom">
        <p className="text-sm font-bold tracking-wide text-gold-200">For the family, from your doctor</p>
        <h1 className="text-[2.2rem] font-bold leading-tight">
          <span className="gold-text">One More Story</span>
        </h1>
        <p className="text-lg leading-relaxed text-ivory-200">
          Gentle daily memory games, led by the face and voice of someone they love, and built from their own life story.
        </p>

        <div className="glass w-full rounded-[2.2rem] p-6">
          <div className="mx-auto aspect-square w-full max-w-[17rem] overflow-hidden rounded-3xl bg-white p-3 shadow-[0_20px_40px_-20px_rgb(76_29_149/0.5)]">
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr} alt="QR code to set up One More Story" className="h-full w-full" />
            ) : (
              <div className="shimmer h-full w-full rounded-2xl bg-[#f3edff]" />
            )}
          </div>
          <p className="mt-4 text-xl font-bold">Scan with your phone camera</p>
          <p className="mt-1 break-all text-sm text-ivory-200">{link}</p>
        </div>

        <ol className="glass w-full rounded-[2rem] p-5 text-left text-lg leading-relaxed">
          {[
            "Scan the code and add the app to your phone.",
            "Tell it their life story by voice, about 15 minutes.",
            "Hand them the phone. A familiar face does the rest, every day.",
          ].map((s, i) => (
            <li key={s} className="flex gap-3 py-1.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gold-400 text-base font-bold text-navy-950">{i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>

        <button type="button" onClick={() => window.print()} className="min-h-12 text-base font-bold text-ivory-200 underline underline-offset-4 print:hidden">
          Print this card
        </button>
      </main>
    </div>
  );
}
