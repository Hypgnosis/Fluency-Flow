# Deploying Glossos on Netlify

Glossos runs entirely on Netlify. The website and its small server functions deploy together.
The Gemini API key lives only in the functions and is never sent to the browser.

## How it fits together

| Part | Where | What it does |
|---|---|---|
| Website | `dist/` (built by `npm run build`) | The React app. It contains **no** Gemini key. |
| `/api/generate`, `/api/stream` | `netlify/functions/genai.mts` | Lens Teacher's Gemini calls, made server-side with the key. |
| `/api/live-token` | `netlify/functions/live-token.mts` | Hands the browser a **one-use, 30-minute** Gemini Live token for voice sessions. |
| Shared logic | `netlify/lib/` | Firebase sign-in verification, request checks, model allowlist, rate limit. |

Every `/api` call must carry the signed-in user's Firebase ID token. Anonymous guest sign-ins count as signed in.

## Netlify environment variables

**Site configuration → Environment variables**:

| Variable | Value | Notes |
|---|---|---|
| `GEMINI_API_KEY` | your Gemini key | Tick **"Contains secret values"**. If your plan lets you choose scopes, select **Functions**. |
| `FIREBASE_PROJECT_ID` | `glossos` | Already there for the website. The functions use it too. |
| other `FIREBASE_*` | unchanged | Used by the website. |
| `VITE_WS_PROXY_URL` | *(leave unset)* | Only for a self-hosted proxy. |

Redeploy after changing variables (**Deploys → Trigger deploy**).

## Safety nets

- `vite.config.ts` only passes `GEMINI_API_KEY` to the local dev server, never to `npm run build`.
- The `forbidSecretsInBundle` plugin (`vite-plugins/forbidSecrets.ts`) **fails the build** if the key text appears anywhere in the output.
- Marking the variable as a secret in Netlify adds Netlify's own secret scanning on top.

## Check after deploying

1. Open the site, sign in, and start a voice session. In the browser's Network tab you should see a `POST /api/live-token` and then a WebSocket to `...BidiGenerateContentConstrained?access_token=auth_tokens/...`. No `key=` should appear anywhere.
2. Switch to **Lens** and ask about something. You should see `POST /api/stream` return `200`.
3. Look under **Logs → Functions** in Netlify. A `503 The Glossos server is not configured yet` means `GEMINI_API_KEY` or `FIREBASE_PROJECT_ID` is missing.

## Local development

- `npm run dev` uses `GEMINI_API_KEY` from `.env.local` directly. This is the quickest option.
- To run the real functions locally, run `npx netlify-cli dev`. It serves the site and `/api/*` on one port.

## Not needed anymore

The `server/` folder (a WebSocket proxy for Cloud Run and similar hosts) is not used on Netlify. It can stay as an alternative or be deleted.
