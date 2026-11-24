// Netlify Function: mints a one-use ephemeral token so the browser can open a Gemini Live
// voice session without ever seeing the real API key. Callers must be signed in with Firebase.
// With billing on, the session's time is reserved from the caller's AI minutes first and the
// token expires when that time runs out.
import { configFromEnv, createLiveTokenHandler } from '../lib/api.ts';
import { billingEnabled, ledgerFromEnv } from '../lib/billing/env.ts';

const handler = createLiveTokenHandler({ ...configFromEnv(), billing: billingEnabled() ? ledgerFromEnv() : undefined });

export default (req: Request) => handler(req);

export const config = {
    path: '/api/live-token',
    method: 'POST',
};
