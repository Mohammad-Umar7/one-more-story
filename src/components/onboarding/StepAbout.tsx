"use client";

import { useState } from "react";
import { Chip, Field, GoldButton, inputClass, postJson, StepTitle, type OnboardingState, type StepProps } from "./shared";

const RELATIONS = ["Son", "Daughter", "Wife", "Husband", "Grandchild", "Friend", "Carer"];
const LANGS = [
  { tag: "en-US", label: "English" },
  { tag: "en-GB", label: "English (UK)" },
  { tag: "ar-AE", label: "العربية" },
  { tag: "ur-PK", label: "اردو" },
  { tag: "hi-IN", label: "हिन्दी" },
];

/** Who is setting this up, for whom, and consent to use their voice and face. */
export function StepAbout({ state, setState, guide, next }: StepProps) {
  const [memberName, setMemberName] = useState(state.member?.name ?? "");
  const [relation, setRelation] = useState(state.member?.relation ?? "");
  const [playerName, setPlayerName] = useState(state.member ? state.player.name : "");
  const [callName, setCallName] = useState(state.member ? state.player.callName : "");
  const [pronoun, setPronoun] = useState<"he" | "she" | "they">(state.member ? state.player.pronoun : "he");
  const [lang, setLang] = useState(state.player.lang || "en-US");
  const [consent, setConsent] = useState(state.member?.consent ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = memberName.trim() && relation.trim() && playerName.trim() && consent;
  const call = callName.trim() || playerName.trim() || "them";

  const submit = async () => {
    guide.unlock();
    setBusy(true);
    setError(null);
    try {
      const saved = await postJson<OnboardingState>("/api/onboarding/about", { memberName, relation, playerName, callName, pronoun, lang, consent });
      setState(saved);
      next();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) void submit();
      }}
    >
      <StepTitle eyebrow="Step 1 · About you" title="Who are we making this for?">
        I&apos;ll learn your voice and your face, so they always see someone they love.
      </StepTitle>

      <div className="glass flex flex-col gap-4 rounded-[2rem] p-5">
        <Field label="Your first name">
          <input className={inputClass} value={memberName} onChange={(e) => setMemberName(e.target.value)} placeholder="Ahmed" autoComplete="given-name" />
        </Field>
        <div>
          <span className="mb-1.5 block text-base font-bold text-ivory-200">You are their…</span>
          <div className="flex flex-wrap gap-2">
            {RELATIONS.map((r) => (
              <Chip key={r} active={relation === r} onClick={() => setRelation(r)}>
                {r}
              </Chip>
            ))}
          </div>
        </div>
      </div>

      <div className="glass flex flex-col gap-4 rounded-[2rem] p-5">
        <Field label="Their name">
          <input className={inputClass} value={playerName} onChange={(e) => setPlayerName(e.target.value)} placeholder="Yusuf" />
        </Field>
        <Field label="What do you call them at home?">
          <input className={inputClass} value={callName} onChange={(e) => setCallName(e.target.value)} placeholder="Baba, Dad, Nani, Ammi…" />
        </Field>
        <div>
          <span className="mb-1.5 block text-base font-bold text-ivory-200">They are</span>
          <div className="flex flex-wrap gap-2">
            {(["he", "she", "they"] as const).map((p) => (
              <Chip key={p} active={pronoun === p} onClick={() => setPronoun(p)}>
                {p === "he" ? "He / him" : p === "she" ? "She / her" : "They / them"}
              </Chip>
            ))}
          </div>
        </div>
        <div>
          <span className="mb-1.5 block text-base font-bold text-ivory-200">They speak</span>
          <div className="flex flex-wrap gap-2">
            {LANGS.map((l) => (
              <Chip key={l.tag} active={lang === l.tag} onClick={() => setLang(l.tag)}>
                {l.label}
              </Chip>
            ))}
          </div>
        </div>
      </div>

      <label className="glass flex cursor-pointer items-start gap-4 rounded-[2rem] p-5">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 size-7 shrink-0 accent-gold-400" />
        <span className="text-lg leading-relaxed text-ivory-100">
          I agree that my voice and my photo are used so that {call} hears and sees me in these games. I can change or remove them any time.
        </span>
      </label>

      {error && <p className="text-center text-lg font-bold text-gold-200">{error}</p>}
      <GoldButton type="submit" disabled={!ready || busy}>
        {busy ? "Saving…" : "Continue"}
      </GoldButton>
    </form>
  );
}
