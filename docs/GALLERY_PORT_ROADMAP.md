# Porting Google AI Edge Gallery features into Glossos

Gallery is open source (Apache-2.0), so features were ported by reading its source, not by
decompiling the app. See `THIRD_PARTY_NOTICES.md` for attribution.

## Phase 1 — Lens Teacher ✅ (done)

Port of Gallery's **XR Language Teacher**. It replaces the old Vision mode, which was a mock that always returned "manzana".

- Point the camera, or upload a photo, then ask by voice, by text, or with the shutter alone.
- The reply streams in and is spoken sentence by sentence: host text in your language, `<target>` words in the target language.
- A second model call extracts a vocabulary card. Save it to a study deck.
- Study: flash cards with spaced repetition (SM-2), plus a "say it" pronunciation check. Glossos adds both; Gallery only flips cards.
- Personas: Buddy, Nerdy, Secret Agent, Wizard. Glossos adds proficiency level to the prompt.
- Backend: `/api/generate` and `/api/stream` Netlify Functions, gated by Firebase ID tokens (see `docs/NETLIFY_DEPLOY.md`).

## Phase 1b — Everything on Netlify ✅ (done)

- The Gemini key moved out of the browser bundle and into Netlify Functions.
- Voice sessions use one-use ephemeral tokens from `/api/live-token`.
- The build fails if the key ever leaks into `dist/`.

## Phase 2 — Tutor Skills ✅ (done)

A port of Gallery's **Agent Skills** onto the voice tutor. Each skill can be switched on or off in the **Skills** panel.

| Skill | Mode | What it does |
|---|---|---|
| Wikipedia (`lookup_wikipedia`) | live | The tutor calls it mid-conversation for real facts. It ports Gallery's `query-wikipedia`. |
| Mistake memory (`log_mistake`) | review | Writes to `users/{uid}/mistakes`, which feeds the LEARNER PROFILE in the next session's prompt. |
| Progress tracking (`mark_mistake_fixed`) | review | Resolves a remembered mistake once the learner gets it right unaided. |
| Save words (`save_vocabulary`) | review | Adds a word to the same study deck Lens uses. |
| Visual cards (`show_card`) | review | Shows a card with the key phrases when the tutor starts a new role-play. |

**Why two modes.** Real-session tests showed that `gemini-2.5-flash-native-audio` is unreliable once several tools are declared:
- It sometimes spoke `<ctrl46>` control tokens instead of audio.
- It sometimes called the same tool in a loop.
- The `log_mistake` + `show_card` combination failed most often.

So only skills whose result the tutor needs *before* answering are declared as Live tools. Everything else runs after each exchange in `turnReview.ts`: a fast text model returns structured JSON, and the review skills act on it. This matches Gallery's own language teacher, where one pass speaks and a second pass extracts. Session memory stops anything being logged, saved or shown twice.

**Later:**
- User-loadable skills from a URL (the `SKILL.md` format, a sandboxed iframe, and the `ai_edge_gallery_get_result(data, secret)` contract).
- Revisit native Live tools when a newer Live model handles several tools reliably.

## Phase 3 — Study tools (queued)

- **Text chat with dictation and read-aloud** (Gallery AI Chat). A typed tutor for when voice isn't practical. It reuses `services/speech.ts`.
- **Writing Lab** (Gallery Prompt Lab). Single-turn templates: correct my grammar, rewrite in a tone, translate, explain a sentence, conjugate. It shows the prompt preview and has temperature/top-k/top-p controls.
- **Audio Scribe.** Record or upload a clip of up to 30 s, get a transcript and translation, and turn the key words into cards.

## Phase 4 — Offline mode (queued)

Gallery's core idea: on-device inference.

- Run Gemma in the browser with WebGPU (MediaPipe LLM Inference for Web / LiteRT web builds).
- A model manager with download progress, a cache in the Origin Private File System, and model allowlist JSON in Gallery's schema.
- A benchmark covering TTFT, prefill and decode tokens/sec, and init time, with min/median/max over N runs, as in Gallery's `ui/benchmark`.
- Offline Lens and Writing Lab when no network is available.

## Known follow-ups

- Phonetic feedback is still mocked (`createMockPhoneticAnalysis`). The `pronunciationFeedback.qualityScore` field it reads does not exist in the Live API.
- `services/visionService.ts`, `components/CameraCapture.tsx`, `components/VocabularyCard.tsx` and the `server/` folder are no longer used and can be deleted.
- Netlify-native rate limiting (`config.rateLimit` in the function files) could replace the in-memory limiter if abuse shows up.
- The Live model is `gemini-2.5-flash-native-audio-latest`. Google now limits 2.5 models to existing users, so plan a move to a current Live model and re-test tool calling then.
- Text calls fall back through `TEXT_MODELS` / `FAST_MODELS` in `services/genaiClient.ts` when a model is overloaded (503) or unavailable (404). In November 2026 the 3.x models often returned 503, and `gemini-2.5-flash` covered.
