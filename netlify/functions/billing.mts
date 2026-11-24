// Netlify Function: plans, AI minutes and Stripe payments for Glossos (see netlify/lib/billing/).
import { configFromEnv } from '../lib/api.ts';
import { createBillingHandler } from '../lib/billing/handler.ts';
import { ledgerFromEnv } from '../lib/billing/env.ts';

const env = process.env;
const handler = createBillingHandler({
    ...configFromEnv(),
    ledger: ledgerFromEnv(),
    stripeSecretKey: env.STRIPE_SECRET_KEY,
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET,
});

export default (req: Request) => handler(req);

export const config = {
    path: ['/api/billing/status', '/api/billing/checkout', '/api/billing/portal', '/api/billing/end', '/api/billing/webhook', '/api/billing/report', '/api/billing/health'],
    method: ['POST', 'GET'],
};
