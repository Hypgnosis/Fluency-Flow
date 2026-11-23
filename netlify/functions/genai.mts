// Netlify Function: Gemini text/vision calls for Lens Teacher and other non-Live features.
// The Gemini API key stays on the server; callers must be signed in with Firebase.
import { configFromEnv, createGenaiHandler } from '../lib/api.ts';

const handler = createGenaiHandler(configFromEnv());

export default (req: Request) => handler(req);

export const config = {
    path: ['/api/generate', '/api/stream'],
    method: 'POST',
};
