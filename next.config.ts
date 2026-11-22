import type { NextConfig } from "next";

/**
 * Cache Components is deliberately off: every screen in this app reads live,
 * per-player data, and the voice session must be torn down (mic released)
 * when a game screen unmounts. With Cache Components on, Next keeps hidden
 * routes mounted inside <Activity> and may prerender GET handlers.
 */
const nextConfig: NextConfig = {
  // The demo photos and clue recordings are read from ./seed at run time, so a
  // serverless deploy (Vercel) must ship them with the API functions.
  // Route handlers also leave maxDuration unset on purpose: on Vercel, routes
  // with the same settings share one function, and so one /tmp database.
  outputFileTracingIncludes: {
    "/api/**": ["./seed/**/*"],
  },
  // Lets a phone or tablet reach `next dev` through an HTTPS tunnel.
  allowedDevOrigins: [
    "*.trycloudflare.com",
    "*.ngrok-free.app",
    "*.ngrok.app",
    "*.loca.lt",
  ],
  turbopack: {
    // There is a stray package-lock.json in the user's home folder; pin the root.
    root: process.cwd(),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Mic for SpeechRecognition / MediaRecorder on this origin only.
          { key: "Permissions-Policy", value: "microphone=(self), camera=(self)" },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
