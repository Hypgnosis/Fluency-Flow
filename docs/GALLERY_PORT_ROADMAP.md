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

## Phase 2 — Tutor Skills (queued)

Port of Gallery's **Agent Skills** onto the Gemini Live voice session, using Live API function calling (`toolCall` → `toolResponse`).

- `log_mistake(word, incorrect, correct, category)` writes to `users/{uid}/mistakes`. `loadUserContext()` already reads that collection, but nothing writes to it today.
- `save_vocabulary(word, meaning, example, example_translation)` saves to the same deck Lens uses.
- `lookup_wikipedia(topic, lang)` ports Gallery's `query-wikipedia` skill: the MediaWiki extract plus the infobox, truncated per language.
- `show_card(title, body)` is a visual summary card, like Gallery's `learn-something-new`.
- Progressive disclosure, as in Gallery: only skill names and descriptions go in the system prompt, and full instructions load via `load_skill`.
- Later: user-loadable skills from a URL, using the `SKILL.md` format and a sandboxed iframe with the `ai_edge_gallery_get_result(data, secret)` contract.

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
- The Live model is `gemini-2.5-flash-native-audio-latest`. Google now limits 2.5 models to existing users, so plan a move to a current Live model.
