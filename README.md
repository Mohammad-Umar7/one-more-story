# One More Story

**Voice-guided memory games for people living with Alzheimer's, built from their own rooms, family photos and streets, with a gentle, automatic alert to a trusted person when they start needing more help than usual.**

Built for the **HealthX Ajyal Hackathon** (Department of Health, Abu Dhabi), theme **Protecting Brain Health**: *"How might we use AI to support early identification, monitoring and care for people at risk of or living with Alzheimer's and other dementias, and for their caregivers?"*

Mobile-first (phone in Chrome is the primary layout), scales up to tablets. Navy, ivory and gold; large type in one plain sans-serif (Atkinson Hyperlegible, designed for low-vision readers; no serif, italics or all-caps, as dementia-friendly guidance recommends); one question per screen; Home, Pause and a tap alternative for every spoken choice.

---

## The three games

| Game | What happens | Voice | Tap |
|---|---|---|---|
| **My Memory Room** | A photo of the player's own room with familiar places marked. "Where do you usually keep your glasses?" Four objects per round. "Can I hear my clue?" plays the clue **the player recorded in their own voice**. The round and its hint count are saved. | "I think they're in the bowl", "Can I hear my clue?", "Show me" | Tap the place on the photo; *Hear my clue* |
| **Tell the Story** | One family photo. "What would you like to share about this day?" Claude asks one relevant follow-up built only on the player's words ("That was my cricket team" → "What did you enjoy about playing with them?"). The player's own voice is recorded; they can **listen back, save, let it go, or skip**. Unscored. | Just talk; "that's all", "play it back", "save it", "let it go", "skip" | Record / I've finished / Listen back / Save / Let it go / Skip |
| **Show Me Your Street** | The player is the tour guide on a small branching route of family street photos. At the bakery, **"Let's take the lane on the left" changes the scene**, exactly like tapping the left arrow. Both directions are valid. Voice notes at any stop; the family can **replay the exact route** and hear the player narrate it. | "Let's take the lane on the left", "let's go back", "leave a note" | Arrows on the photo + labelled buttons; *Leave a voice note* |

The **Family corner** (link on the home screen) has the caregiver inbox, a "help over time" chart with the rule explained in plain words, saved stories, tour replays, and setup screens where families replace all demo content: room photo + tap-to-mark places + four objects + clue recordings, story photos, street photos and their left/straight/right connections, the player's profile, and the trusted person.

## Automatic caregiver alerts (the exact hackathon rule)

Implemented in [`src/lib/shared/baseline.ts`](src/lib/shared/baseline.ts) (pure functions, unit-tested) and [`src/lib/server/memory.ts`](src/lib/server/memory.ts):

- **Only My Memory Room counts.** A hint is counted when a requested clue **actually starts playing** (the audio element's `playing` event), and each playback is counted once: the server stores `(round, playbackId)` as unique, so retries never double count.
- **Baseline** = median hint count of the player's **first five valid four-object rounds** with the **same objects (in the same places) and difficulty**. Interrupted rounds and rounds affected by a **microphone or playback failure** are excluded. (Blocking the mic permission is treated as tap mode, not a failure; a missing/busy mic or an unreachable speech service is a failure.) **Every baseline is personal**: there is no default. A new player has no usual level and gets no alerts until their own first five rounds are played; the family page shows "Getting to know Dad's usual: N more rounds to go". The demo pre-loads Yusuf's history only so judges can see an alert; for a real person use *Family → Demo controls → Start fresh*.
- **Three consecutive comparable rounds, each at least two hints above baseline → one alert**, pushed automatically to the trusted person's subscribed phone, **even when the caregiver page is closed** (service worker). The alert is keyed by the first round of the streak, so retries and a continuing pattern never send a second one; push deliveries are unique per (alert, device), and the notification `tag` collapses repeats on the phone too.
- Wording, exactly as briefed: *"Dad usually uses 1 hint per round. In his last 3 sessions, he used 3 hints each time."* Shown with the game, the date and **Mark as seen** (also available as a button on the notification itself). The alert stays in the inbox when push isn't available.
- Prototype gameplay thresholds only. The app describes the observed change in plain language; it never infers disease progression or produces a risk score.

## Voice stack

| Job | Provider | Where |
|---|---|---|
| Listening | Browser `SpeechRecognition` / `webkitSpeechRecognition` (target: **Chrome**) | `src/lib/client/recognizer.ts` |
| Conversation + game actions | **Anthropic API, direct** (`ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, default `claude-opus-5-5`, effort `low`, server-side refusal fallback enabled) | `src/lib/server/claude.ts`, `POST /api/agent` |
| Speaking | **OpenRouter** `google/gemini-3.8-flash-tts-20260922` (`/audio/speech`, PCM → WAV, voice *Sulafat* "warm"), spoken replies only, every phrase cached on disk; **browser speech synthesis if TTS fails** | `src/lib/server/tts.ts`, `POST /api/tts`, `src/lib/client/speaker.ts` |

How the agent behaves (`src/lib/client/voice-engine.ts`):

- **Voice from the first moment.** The app opens on a welcome screen with one big **Start** button; that single tap turns the voice on and the companion greets the player out loud. (Browsers only let a page talk and listen after one tap.) If the browser already allows it (sound allowed for the site, microphone already permitted, OpenRouter voice configured), it skips the tap and starts talking straight away. *Play without voice* is there for tap-only play, and **Start voice** stays in the bottom bar.
- Then talk naturally across turns and screens. Status always shows **Listening**, **Speaking** or **Paused** (plus "One moment" while thinking).
- **One short question at a time.** Pauses are allowed: the turn only ends after a silence, longer if the sentence sounds unfinished ("we used to go to the…") or is only "um…"; *Give extra time to answer* in setup makes it longer still.
- **Interrupt any time**: say something different (or "stop", "wait") while it talks, or tap **Stop speaking**. The mic stays on during playback, but anything that matches the companion's own words (or the player's own clue recording) is ignored, so **its own playback is never taken as an answer**.
- **"I'm done"** ends the session and releases the microphone.
- Claude gets the current game, the scene, the choices on screen and the recent conversation, and must answer with a JSON schema whose enums contain **only the actions valid on that screen**; the client validates again. **Taps and voice call the same game functions.**
- Unclear words → **one gentle clarification** naming the likely choices, then an invitation to tap. **Recognition failures are never counted as game mistakes.**
- No keys, no network, or a slow API? A local matcher (`src/lib/shared/agent.ts`) keeps every game playable.

## Run it

Requires **Node.js 22.13+** (uses the built-in `node:sqlite`, no native build step) and Chrome.

```powershell
npm install
Copy-Item .env.example .env.local   # then paste the keys into .env.local
npm run demo                         # production build + server on http://localhost:3000
```

`npm run dev` runs the dev server. The database seeds itself on first start (fictional family, room, cricket photo, bakery route, alert history).

### Environment variables (`.env.local`, server-only, git-ignored)

| Variable | Required | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | for Claude | Without it the local matcher answers |
| `ANTHROPIC_MODEL` | no | Default `claude-opus-5-5` |
| `ANTHROPIC_EFFORT` | no | `low` (default) / `medium` / `high` |
| `OPENROUTER_API_KEY` | for the natural voice | Team key ($40 limit), used **only** for spoken replies |
| `OPENROUTER_BASE_URL` | no | Default `https://openrouter.ai/api/v1` |
| `OPENROUTER_TTS_MODEL` | no | Default `google/gemini-3.8-flash-tts-20260922` |
| `OPENROUTER_TTS_VOICE` | no | Default `Sulafat`; try `Achernar`, `Vindemiatrix`, `Gacrux` |
| `TTS_DAILY_CHAR_LIMIT` | no | Default 60000 characters/day (cached phrases cost nothing) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | no | Generated once and stored locally if empty |
| `VAPID_SUBJECT` | no | `mailto:` contact for push services |
| `DATA_DIR` | no | SQLite database + photos + recordings. Default `./data` |

`GET /api/health` shows which services are configured (true/false only, never values).

## Two-device live demo (tablet + caregiver phone)

Phones only allow microphones and notifications on **https://**, so put the laptop's server behind an HTTPS tunnel:

```powershell
npm run demo
```

```powershell
npm run tunnel
```

(`npm run tunnel` runs a free Cloudflare quick tunnel and prints an `https://…trycloudflare.com` address. Alternatives: `winget install Cloudflare.cloudflared` then `cloudflared tunnel --url http://localhost:3000`, or `ngrok http 3000`.) Use that https address on **both** devices.

1. **Tablet or phone for the player (Chrome)**: open the https address. The home screen shows the three games.
2. **Pair the caregiver phone once**: on the player's device, *For family → People & alerts*. Mariam (Daughter) is the chosen trusted person. Scan the QR code with the caregiver phone, tap **Turn on notifications**, allow. (iPhone: Share → *Add to Home Screen* first, open *OMS Alerts* from the home screen, then turn on.) Tap **Send a test notification** to confirm. Then close the page or lock the phone.
3. **Reset the history**: *For family → Overview → Demo controls → Reset the alert demo*. History is now 1, 0, 1, 2, 1 (baseline 1) then 3, 3. Seeded history only: nothing is faked from here on.
4. **The judge plays**: Home → **My Memory Room** → **Start voice** → "Yes" (or tap **Begin**) → for three of the objects say **"Can I hear my clue?"** (each clue plays in the player's recorded voice), then answer, e.g. "I think they're in the bowl", "on the hooks by the door", "in the top drawer", "by the window". Tapping works the same.
5. When the fourth object is found, the round is saved with 3 hints: the third elevated round in a row. **The caregiver phone gets the notification automatically**: *"Dad · My Memory Room — Dad usually uses 1 hint per round. In his last 3 sessions, he used 3 hints each time."* with **Mark as seen**. Tapping it opens the inbox.
6. Show *For family → Overview*: the alert, the chart (usual level, alert level, the three rounds) and every round with why it was or wasn't counted.
7. Run it again: **Reset the alert demo**. The phone stays paired.

Before judging, record the four clues with a real voice: *For family → Memory Room → Record clue* on each object. The seeded clues are synthetic stand-ins for the player's own recordings.

## Verify

```powershell
npm test
```
24 unit tests: the baseline math (median of the first five), the 3-in-a-row rule, exclusions, duplicate prevention, the exact alert wording, the local intent matcher, echo detection and action validation.

```powershell
npm run build; npm run verify:alerts
```
26 end-to-end checks over real HTTP against the production build: a fake phone push service on `https://localhost` decrypts the Web Push message (VAPID + aes128gcm) just like a browser. It plays the judge's 3-clue round (with a retried request), and confirms one alert, the exact text, exactly one push, no duplicate on retry or while the pattern continues, mic-failure and interrupted rounds excluded, Mark as seen, and reset.

## Architecture

- **Next.js 16 (App Router) + TypeScript + Tailwind CSS 4**, client screens over JSON route handlers.
- **SQLite** (`node:sqlite`, WAL) in `data/one-more-story.db`; photos and recordings in `data/media`; TTS cache in `data/tts-cache`.
- `src/lib/shared/` rule, intent and text logic shared by server, client and tests · `src/lib/server/` database, seed, Claude, TTS, push, rounds · `src/lib/client/` voice engine, recognizer, speaker, recorder, push · `src/app/play/*` the three games · `src/app/family/*` setup, dashboard, tour replay · `src/app/caregiver` the phone inbox · `public/sw.js` notifications.

## Privacy and safety

- Synthetic demo data only (a fictional family; AI-generated photos; synthetic clue voices). No real patient data.
- API keys live only on the server; the browser never sees them, and logs never include them.
- Story recordings are uploaded only when the player taps **Save**; "Let it go" means nothing is stored. Tour narration saving can be switched off in setup.
- **Prototype: there is no login.** Anyone with the address can open the family area. Add authentication before using it with a real family.
- Not a medical device; alerts describe a change in one game.

## Needs testing on the real devices

- **Speech recognition on the actual tablet** (Chrome on Android usually restarts listening after each phrase and may beep; iPad Safari's recognition is less reliable, so use Chrome).
- **Recording while listening**: Tell the Story and the street tour record the player's words while recognition runs. This works in desktop Chrome; some Android devices allow only one microphone user at a time.
- **Echo handling with the tablet's own speaker** at demo volume, and barge-in timing in a noisy room.
- **Push on the caregiver phone**: Android Chrome needs notifications allowed for Chrome; iPhone needs iOS 16.4+ and *Add to Home Screen*. Check delivery with the screen locked and the app closed.
- **OpenRouter TTS** with the team key: the voice, latency and the PCM sample rate (24 kHz assumed if the response doesn't say).
- **Claude latency** on the venue Wi-Fi (the local matcher takes over after ~9 s).
- The HTTPS tunnel on the venue network.

## Credits

- Seed photos: AI-generated for this demo (HiDream-O1-Image and FLUX.1-Krea-dev via Hugging Face Spaces). Fictional people and places.
- Demo clue voices: Windows speech synthesis, as stand-ins for the player's own recordings.
- Font: Atkinson Hyperlegible (Braille Institute).
- Built with AI assistance (Claude Code), disclosed per the hackathon rules.
