"use client";

import { useEffect, useState } from "react";
import { useVoice } from "./AppProvider";

/**
 * Hidden test panel, shown with ?debug=1. Lets you type what the player
 * "said" (same path as real speech) and shows which interpreter answered.
 */
export function DebugPanel() {
  const { engine, snap } = useVoice();
  const [enabled, setEnabled] = useState(false);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let on = false;
    try {
      const q = new URLSearchParams(window.location.search).get("debug");
      if (q === "1") sessionStorage.setItem("oms-debug", "1");
      if (q === "0") sessionStorage.removeItem("oms-debug");
      on = sessionStorage.getItem("oms-debug") === "1";
    } catch {
      on = new URLSearchParams(window.location.search).get("debug") === "1";
    }
    if (on) {
      (window as unknown as { __oms: unknown }).__oms = engine;
      setEnabled(true);
    }
  }, [engine]);

  if (!enabled) return null;
  const d = snap.lastDecision;
  return (
    <div className={`fixed right-2 top-[4.75rem] z-[60] rounded-2xl bg-navy-950/95 text-xs text-ivory-100 shadow-photo ${open ? "w-72 p-3" : "px-3 py-1.5"}`}>
      <button type="button" className="mb-1 w-full text-left font-bold text-gold-300" onClick={() => setOpen(!open)}>
        Debug {open ? "▾" : "▸"} · {snap.status}
      </button>
      {open && (
        <div className="space-y-1">
          <div>mic: {snap.mic} · recognition: {snap.recognition}</div>
          <div>voice: {snap.voiceSource ?? "-"} · playing: {snap.playing ?? "-"} · capture: {String(snap.capturing)}</div>
          <div className="truncate">interim: {snap.interim || "-"}</div>
          <div className="truncate">heard: {snap.heard || "-"}</div>
          {d && (
            <div className="rounded bg-navy-800 p-1.5">
              <div>
                {d.source} → <b>{d.action}</b> {d.target ?? ""} {d.latencyMs ? `(${d.latencyMs} ms)` : ""}
              </div>
              {d.say && <div className="italic">“{d.say}”</div>}
              {d.note && <div>note: {d.note}</div>}
            </div>
          )}
          <form
            className="flex gap-1 pt-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (!text.trim()) return;
              engine.simulateHeard(text.trim());
              setText("");
            }}
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Say…"
              className="min-w-0 flex-1 rounded bg-white px-2 py-1 text-navy-900"
              aria-label="Simulated speech"
            />
            <button type="submit" className="rounded bg-gold-400 px-2 font-bold text-navy-950">
              Say
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
