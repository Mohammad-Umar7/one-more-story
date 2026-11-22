"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { chainFromUrl, nextInChain } from "@/lib/client/chain";
import { STORY_FOLLOWUPS } from "@/lib/shared/demo-script";
import { useApp, useScreen, useVoice } from "@/components/AppProvider";
import { GameShell } from "@/components/GameShell";
import { RecordButton } from "@/components/RecordButton";
import { Button, Card, Spinner } from "@/components/ui";
import { CheckIcon, HomeIcon, PlayIcon, SkipIcon, StopIcon, TrashIcon } from "@/components/icons";
import { clientKey, sendJson, uploadMedia } from "@/lib/client/api";
import { MicCapture, type Recording } from "@/lib/client/recorder";
import { words } from "@/lib/shared/text";
import type { ActResult, CapturedTurn, ScreenController } from "@/lib/client/voice-engine";
import type { ScreenContext } from "@/lib/shared/agent";

type Phase = "photo" | "review" | "confirm-discard" | "saved" | "finished";

interface Clip {
  id: string;
  turnId: number | null;
  blob: Blob;
  url: string;
  durationMs: number;
  transcript: string;
  prompt: string;
}

const OPENING = "What would you like to share about this day?";
const DONE_FIRST = "Are you done, Dada?";
const DONE_AGAIN = "Anything else, Dada?";
const KEEP_GOING = "Okay, take your time. I'm listening.";
const REVIEW_Q = "Would you like to listen back, save it, or let it go?";
const TAP_PROMPTS = [
  "Who else was there with you?",
  "What do you remember most about that day?",
  "What was that like for you?",
  "Tell me a little more.",
];
const FINISH_PHRASES = ["that's all", "that's it", "that is all", "nothing more", "i'm finished", "finished", "the end", "no more", "that's my story"];

export default function TellTheStoryPage() {
  const { bundle } = useApp();
  const { engine, snap } = useVoice();
  const router = useRouter();
  const photos = bundle?.photos ?? [];
  const name = bundle ? bundle.player.familyName || bundle.player.name : "";
  const chain = useRef<string[] | null>(null);

  const [, render] = useReducer((x: number) => x + 1, 0);
  const st = useRef({
    phase: "photo" as Phase,
    index: 0,
    clips: [] as Clip[],
    prompt: OPENING,
    saving: false,
    listening: false,
    storyKey: clientKey("story"),
    tapPromptIndex: 0,
    doneCheck: false, // Led by the companion: we just asked "Are you done?"
    doneAsked: 0,
    outcome: "saved" as "saved" | "discarded" | "skipped",
  });
  const alive = useRef(true);
  const [tapMic] = useState(() => new MicCapture());
  const [error, setError] = useState<string | null>(null);

  const update = (patch: Partial<typeof st.current>) => {
    st.current = { ...st.current, ...patch };
    render();
  };

  useEffect(() => {
    chain.current = chainFromUrl();
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      tapMic.release();
      st.current.clips.forEach((c) => URL.revokeObjectURL(c.url));
    };
  }, [tapMic]);

  const s = st.current;
  const photo = photos[s.index] ?? null;

  function addClip(rec: { blob: Blob; durationMs: number }, transcript: string, turnId: number | null) {
    const clip: Clip = {
      id: clientKey("clip"),
      turnId,
      blob: rec.blob,
      url: URL.createObjectURL(rec.blob),
      durationMs: rec.durationMs,
      transcript,
      prompt: st.current.prompt,
    };
    update({ clips: [...st.current.clips, clip] });
  }

  /** Drop the clip that only contained a spoken command ("skip this one"). */
  function dropCommandClip(utterance: string | null) {
    if (!utterance) return;
    const cs = st.current.clips;
    const last = cs[cs.length - 1];
    if (last && last.transcript === utterance && words(utterance).length <= 7) {
      URL.revokeObjectURL(last.url);
      update({ clips: cs.slice(0, -1) });
    }
  }

  async function listenBack(): Promise<ActResult> {
    const clips = st.current.clips;
    if (clips.length === 0) return { speak: "There's nothing recorded yet." };
    update({ listening: true });
    await engine.say("Here's your story, in your own voice.");
    for (const c of clips) {
      if (!alive.current || !st.current.listening) break;
      const r = await engine.playClip(c.url, { knownText: c.transcript || null });
      if (r === "interrupted") break;
    }
    if (!alive.current) return { speak: null };
    update({ listening: false });
    if (st.current.phase === "review") await engine.say("Shall I save it for your family?");
    return { speak: null };
  }

  async function save(): Promise<ActResult> {
    const cur = st.current;
    // Led by the companion, never get stuck: nothing recorded means just carry on.
    if (chain.current && !cur.saving && (!photo || cur.clips.length === 0)) return nextPhoto();
    if (!photo || cur.clips.length === 0 || cur.saving) return { speak: null };
    update({ saving: true });
    setError(null);
    try {
      const uploaded = [];
      for (const c of cur.clips) {
        const m = await uploadMedia(c.blob, { durationMs: c.durationMs, transcript: c.transcript || undefined });
        uploaded.push({ mediaId: m.id, prompt: c.prompt, transcript: c.transcript || undefined });
      }
      await sendJson("/api/stories", { clientKey: cur.storyKey, photoId: photo.id, clips: uploaded });
    } catch {
      if (alive.current) {
        update({ saving: false });
        if (chain.current) return nextPhoto();
        setError("Saving didn't work just now. Please try again.");
      }
      return { speak: "I couldn't save it just now. Shall we try again?" };
    }
    if (!alive.current) return { speak: null };
    cur.clips.forEach((c) => URL.revokeObjectURL(c.url));
    update({ saving: false, phase: "saved", clips: [], outcome: "saved" });
    // Led by the companion: one photo, then back to say goodbye.
    const more = !chain.current && st.current.index + 1 < photos.length;
    await engine.say(
      more
        ? "Saved. Your family will love hearing this. Shall we look at another photo?"
        : `Saved. Your family will love hearing this. Thank you, ${name}.`,
    );
    if (chain.current && alive.current) router.push(nextInChain(chain.current));
    return { speak: null };
  }

  async function discard(): Promise<ActResult> {
    st.current.clips.forEach((c) => URL.revokeObjectURL(c.url));
    update({ clips: [], phase: "saved", outcome: "discarded" });
    const more = !chain.current && st.current.index + 1 < photos.length;
    if (chain.current) {
      await engine.say("All right, it's gone. Thank you for sharing it with me.");
      if (alive.current) router.push(nextInChain(chain.current));
      return { speak: null };
    }
    await engine.say(more ? "All right, it's gone. Shall we look at another photo?" : "All right, it's gone. That's all the photos for today.");
    return { speak: null };
  }

  async function nextPhoto(): Promise<ActResult> {
    if (chain.current) {
      await engine.say(`Thank you, ${name}.`);
      if (alive.current) router.push(nextInChain(chain.current));
      return { speak: null };
    }
    const next = st.current.index + 1;
    if (next >= photos.length) {
      update({ phase: "finished" });
      await engine.say(`That's all the photos for today. Thank you for sharing, ${name}.`);
      return { speak: null };
    }
    update({ index: next, phase: "photo", clips: [], prompt: OPENING, storyKey: clientKey("story") });
    window.scrollTo({ top: 0, behavior: "smooth" });
    await engine.say(`Here's another photo. ${OPENING}`);
    return { speak: null };
  }

  async function act(action: string, _target: string | null, meta: { source: "voice" | "tap"; say: string; utterance: string | null }): Promise<ActResult | void> {
    const cur = st.current;
    switch (action) {
      case "tell": {
        // The clip was already added when the turn's audio arrived.
        // Led by the companion: when Dada stops talking, Aamir checks he has finished.
        if (chain.current) {
          const line = cur.doneAsked === 0 ? DONE_FIRST : DONE_AGAIN;
          update({ doneCheck: true, doneAsked: cur.doneAsked + 1 });
          return { speak: line };
        }
        const follow = meta.say || TAP_PROMPTS[cur.tapPromptIndex % TAP_PROMPTS.length];
        update({ prompt: follow, tapPromptIndex: cur.tapPromptIndex + 1 });
        return { speak: follow };
      }
      case "done_yes": {
        // He has finished this part: the next question, or save after the last one.
        dropCommandClip(meta.utterance);
        update({ doneCheck: false, doneAsked: 0 });
        if (cur.tapPromptIndex >= STORY_FOLLOWUPS.length) return save();
        const follow = STORY_FOLLOWUPS[cur.tapPromptIndex];
        update({ prompt: follow, tapPromptIndex: cur.tapPromptIndex + 1 });
        return { speak: follow };
      }
      case "done_no": {
        dropCommandClip(meta.utterance);
        update({ doneCheck: false });
        return { speak: KEEP_GOING };
      }
      case "finish_story": {
        dropCommandClip(meta.utterance);
        if (st.current.clips.length === 0) {
          if (chain.current) return nextPhoto();
          return { speak: "That's all right. Would you like to skip this photo?" };
        }
        // Led by the companion: no "listen back or save?" question, it just saves.
        if (chain.current) return save();
        update({ phase: "review" });
        return { speak: `Thank you for sharing that. ${REVIEW_Q}` };
      }
      case "skip_photo":
        dropCommandClip(meta.utterance);
        if (st.current.clips.length > 0) {
          update({ phase: "review" });
          return { speak: "Before we move on: would you like to save what you told me, or let it go?" };
        }
        await engine.say("That's fine. Let's leave this one for another day.");
        return nextPhoto();
      case "listen_back":
        dropCommandClip(meta.utterance);
        return listenBack();
      case "tell_more":
        dropCommandClip(meta.utterance);
        update({ phase: "photo" });
        return { speak: "Of course. Go ahead, I'm listening." };
      case "save_story":
        dropCommandClip(meta.utterance);
        return save();
      case "discard_story":
        dropCommandClip(meta.utterance);
        update({ phase: "confirm-discard" });
        return { speak: "Let this recording go? It won't be saved." };
      case "confirm_discard":
        return discard();
      case "cancel_discard":
        update({ phase: "review" });
        return { speak: "All right, we'll keep it. Would you like to save it?" };
      case "next_photo":
        return nextPhoto();
    }
  }

  function context(): ScreenContext {
    const cur = st.current;
    const base = { game: "tell_the_story" as const };
    if (cur.phase === "photo" && cur.doneCheck) {
      return {
        ...base,
        screen: "done-check",
        version: `done-${cur.index}-${cur.clips.length}-${cur.doneAsked}`,
        mode: "conversation",
        talkAction: "tell",
        askedIfDone: true,
        scene: "The player is telling the story of a family photo. The companion just asked if they have finished this part.",
        question: cur.doneAsked > 1 ? DONE_AGAIN : DONE_FIRST,
        actions: [
          {
            name: "done_yes",
            description: "Yes, they have finished this part (yes, yeah, I'm done, that's it, that's all, finished, nothing more).",
            phrases: ["yes", "yeah", "yes i'm done", "i'm done", "done", "that's it", "that's all", "finished", "nothing more", "yes that's all"],
          },
          {
            name: "done_no",
            description: "No, not yet: they want to say more but haven't said it yet (no, not yet, wait, one more thing, hold on).",
            phrases: ["no", "not yet", "wait", "one more thing", "hold on", "no not yet", "there's more"],
          },
          {
            name: "tell",
            description: "Instead of answering yes or no, they simply carry on telling the story (any new detail about the photo or the day).",
          },
        ],
      };
    }
    if (cur.phase === "photo") {
      return {
        ...base,
        screen: "photo",
        version: `photo-${cur.index}-${cur.clips.length}`,
        mode: "conversation",
        talkAction: "tell",
        scene:
          "A family photo is on screen. The player is telling the story of it in their own words. Nothing is known about the photo except what the player says: do not guess who or what is in it.",
        question: cur.prompt,
        actions: [
          {
            name: "tell",
            description:
              "The player shares anything about the photo or the day: a memory, a name, a feeling, a detail, or says they don't remember. Reply with warm interest and ONE open follow-up question built on their own words.",
          },
          {
            name: "finish_story",
            description: "The player says they have finished telling the story (\"that's all\", \"that's it\", \"nothing more\").",
            phrases: FINISH_PHRASES,
          },
          {
            name: "skip_photo",
            description: "The player doesn't want to talk about this photo, or asks for a different one.",
            phrases: ["skip", "skip this", "next photo", "another photo", "different photo", "don't want to"],
          },
          ...(cur.clips.length
            ? [{ name: "listen_back", description: "The player wants to hear what they have recorded so far.", phrases: ["listen back", "play it back", "hear it", "play my story"] }]
            : []),
        ],
      };
    }
    if (cur.phase === "review") {
      return {
        ...base,
        screen: "review",
        version: `review-${cur.index}-${cur.clips.length}`,
        scene: "The player has finished telling their story about the photo. Their recording can be listened to, saved for the family, or let go (discarded).",
        question: "Would you like to listen back, save it, or let it go?",
        actions: [
          { name: "listen_back", description: "Play the recording back.", phrases: ["listen", "listen back", "play it", "hear it"] },
          { name: "save_story", description: "Save the recording for the family.", phrases: ["save", "save it", "keep it", "yes save", "keep"] },
          { name: "discard_story", description: "Let the recording go (do not keep it).", phrases: ["let it go", "delete", "discard", "throw it away", "don't keep", "get rid of it"] },
          { name: "tell_more", description: "The player wants to add more to the story.", phrases: ["add more", "one more thing", "tell more", "i forgot", "also"] },
        ],
      };
    }
    if (cur.phase === "confirm-discard") {
      return {
        ...base,
        screen: "confirm-discard",
        version: `confirm-${cur.index}`,
        scene: "Asking the player to confirm letting the recording go.",
        question: "Let this recording go? It won't be saved.",
        actions: [
          { name: "confirm_discard", description: "Yes, let it go.", phrases: ["yes", "yes let it go", "go ahead", "delete it"] },
          { name: "cancel_discard", description: "No, keep it.", phrases: ["no", "keep it", "don't", "wait"] },
        ],
      };
    }
    const more = cur.index + 1 < photos.length;
    return {
      ...base,
      screen: cur.phase,
      version: `${cur.phase}-${cur.index}`,
      scene: more ? "The story was saved or let go. Another photo is available." : "All photos are done for today.",
      question: more ? "Shall we look at another photo?" : undefined,
      actions: more ? [{ name: "next_photo", description: "Show the next photo.", phrases: ["yes", "another", "next", "okay", "sure"] }] : [],
    };
  }

  const ctrl: ScreenController | null = photo
    ? {
        id: "tell-the-story",
        context,
        greeting: () => {
          const cur = st.current;
          if (cur.phase === "photo") return cur.clips.length ? cur.prompt : `Here's a photo from your album. ${OPENING}`;
          return context().question ?? null;
        },
        repeatLine: () => context().question ?? null,
        captureAnswers: () => st.current.phase === "photo",
        // Storytelling has pauses: give Dada a little longer before his turn ends.
        turnPauseMs: () => (st.current.phase === "photo" && chain.current ? (st.current.doneCheck ? 1400 : 2200) : null),
        onTurnAudio: (turn: CapturedTurn) => {
          if (st.current.phase === "photo") addClip(turn, turn.transcript, turn.turnId);
        },
        onIgnored: (turnId: number) => {
          const cs = st.current.clips;
          const drop = cs.find((c) => c.turnId === turnId);
          if (drop) {
            URL.revokeObjectURL(drop.url);
            update({ clips: cs.filter((c) => c !== drop) });
          }
        },
        act,
      }
    : null;
  useScreen(ctrl);

  const tap = (action: string) => void engine.tap(action);

  if (!bundle) {
    return (
      <GameShell title="Tell the Story">
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      </GameShell>
    );
  }
  if (!photo) {
    return (
      <GameShell title="Tell the Story">
        <Card className="mx-auto mt-6 max-w-lg p-6 text-center">
          <p className="font-display text-2xl">No family photos have been added yet.</p>
          <Button variant="navy" className="mt-5" onClick={() => router.push("/family/setup/photos")}>
            Add photos
          </Button>
        </Card>
      </GameShell>
    );
  }

  const voiceOn = snap.active && !snap.paused;
  const totalSecs = Math.round(s.clips.reduce((a, c) => a + c.durationMs, 0) / 1000);

  const screenText = s.phase === "photo" ? s.prompt : s.phase === "review" ? REVIEW_Q : null;

  return (
    <GameShell title="Tell the Story" screenText={screenText}>
      <div className="grid gap-4 md:grid-cols-[1.4fr_1fr] md:items-start md:gap-8">
        <div className="photo-frame animate-fade-up" key={photo.id}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo.photo.url} alt="A family photo" className="aspect-[4/3] w-full rounded-[0.9rem] object-cover" />
        </div>

        <div className="flex flex-col gap-3">
          {s.phase === "photo" && (
            <>
              <h2 className="font-display text-[1.6rem] font-bold leading-tight animate-fade-up md:text-3xl" key={s.prompt}>
                {s.prompt}
              </h2>
              {(s.clips.length > 0 || (voiceOn && snap.capturing)) && (
                <p className="flex items-center gap-2 text-base font-bold text-navy-600">
                  {voiceOn && snap.capturing ? (
                    <>
                      <span className="size-2.5 animate-pulse rounded-full bg-clay-500" /> Recording your words
                    </>
                  ) : (
                    <>
                      <CheckIcon size={18} className="text-sage-500" /> {s.clips.length} part{s.clips.length === 1 ? "" : "s"} recorded ·{" "}
                      {Math.floor(totalSecs / 60)}:{String(totalSecs % 60).padStart(2, "0")}
                    </>
                  )}
                </p>
              )}
              {voiceOn ? (
                <p className="tap-hint text-base text-navy-600">Just talk. Say &ldquo;that&apos;s all&rdquo; when you&apos;ve finished.</p>
              ) : (
                <RecordButton
                  mic={tapMic}
                  label={s.clips.length ? "Record more" : "Record my story"}
                  onRecorded={(rec: Recording) => {
                    addClip(rec, "", null);
                    const next = TAP_PROMPTS[st.current.tapPromptIndex % TAP_PROMPTS.length];
                    update({ prompt: next, tapPromptIndex: st.current.tapPromptIndex + 1 });
                    void engine.say(next);
                  }}
                  onError={setError}
                />
              )}
              <div className="grid grid-cols-2 gap-2">
                <Button variant="ivory" size="md" icon={<CheckIcon size={20} />} disabled={s.clips.length === 0} onClick={() => tap("finish_story")}>
                  I&apos;ve finished
                </Button>
                <Button variant="ivory" size="md" icon={<SkipIcon size={20} />} onClick={() => tap("skip_photo")}>
                  Skip photo
                </Button>
              </div>
            </>
          )}

          {s.phase === "review" && (
            <div className="flex flex-col gap-2 animate-fade-up">
              <h2 className="mb-1 font-display text-[1.6rem] font-bold leading-tight md:text-3xl">{REVIEW_Q}</h2>
              {s.listening ? (
                <Button variant="ivory" size="lg" icon={<StopIcon size={20} />} onClick={() => { update({ listening: false }); engine.stopSpeaking(); }}>
                  Stop listening
                </Button>
              ) : (
                <Button variant="ivory" size="lg" icon={<PlayIcon size={22} />} onClick={() => tap("listen_back")}>
                  Listen back
                </Button>
              )}
              <Button variant="gold" size="lg" icon={s.saving ? <Spinner /> : <CheckIcon size={24} />} disabled={s.saving} onClick={() => tap("save_story")}>
                Save my story
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="danger" size="md" icon={<TrashIcon size={20} />} onClick={() => tap("discard_story")}>
                  Let it go
                </Button>
                <Button variant="ghost" size="md" onClick={() => tap("tell_more")}>
                  Add more
                </Button>
              </div>
            </div>
          )}

          {s.phase === "confirm-discard" && (
            <div className="animate-fade-up">
              <h2 className="font-display text-[1.6rem] font-bold leading-tight md:text-3xl">Let this recording go?</h2>
              <p className="mt-1 text-lg text-navy-700">It won&apos;t be saved.</p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Button variant="danger" size="lg" onClick={() => tap("confirm_discard")}>
                  Yes, let it go
                </Button>
                <Button variant="gold" size="lg" onClick={() => tap("cancel_discard")}>
                  No, keep it
                </Button>
              </div>
            </div>
          )}

          {(s.phase === "saved" || s.phase === "finished") && (
            <div className="animate-fade-up">
              <h2 className="font-display text-[1.6rem] font-bold leading-tight md:text-3xl">
                {s.phase === "finished"
                  ? "That's all the photos for today."
                  : s.outcome === "saved"
                    ? "Saved for your family."
                    : "All right. Nothing was saved."}
              </h2>
              {s.phase === "saved" && s.outcome === "saved" && <p className="mt-1 text-lg text-navy-700">Thank you for sharing.</p>}
              <div className="mt-4 grid gap-2">
                {s.phase === "saved" && s.index + 1 < photos.length && (
                  <Button variant="gold" size="lg" icon={<PlayIcon size={22} />} onClick={() => tap("next_photo")}>
                    Another photo
                  </Button>
                )}
                <Button variant="ivory" size="lg" icon={<HomeIcon size={24} />} onClick={() => router.push("/play")}>
                  Another game
                </Button>
              </div>
            </div>
          )}

          {error && <p className="rounded-2xl bg-white p-3 text-base font-bold text-clay-500 shadow-card">{error}</p>}
        </div>
      </div>
    </GameShell>
  );
}
