// Netlify Function: Gemini text/vision calls for Lens Teacher and other non-Live features.
// The Gemini API key stays on the server; callers must be signed in with Firebase, and each call
// is charged to the caller's AI minutes (netlify/lib/billing/).
import { configFromEnv, createGenaiHandler, type RequestContext } from '../lib/api.ts';
import { billingEnabled, ledgerFromEnv } from '../lib/billing/env.ts';

const handler = createGenaiHandler({ ...configFromEnv(), billing: billingEnabled() ? ledgerFromEnv() : undefined });

export default (req: Request, context: RequestContext) => handler(req, context);

export const config = {
    path: ['/api/generate', '/api/stream'],
    method: 'POST',
};
