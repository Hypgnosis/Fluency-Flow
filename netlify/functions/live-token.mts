// Netlify Function: mints a one-use ephemeral token so the browser can open a Gemini Live
// voice session without ever seeing the real API key. Callers must be signed in with Firebase.
import { configFromEnv, createLiveTokenHandler } from '../lib/api.ts';

const handler = createLiveTokenHandler(configFromEnv());

export default (req: Request) => handler(req);

export const config = {
    path: '/api/live-token',
    method: 'POST',
};
