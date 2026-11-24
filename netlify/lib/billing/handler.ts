/**
 * /api/billing/* routes:
 *   status    - plan, AI minutes left, subscription (signed in)
 *   checkout  - Stripe Checkout page for a plan (signed in, not a guest)
 *   portal    - Stripe customer portal (signed in, has paid before)
 *   end       - ends a Live voice lease, returning unused time (signed in)
 *   webhook   - Stripe events (Stripe signature, no sign-in)
 *   report    - money in vs estimated Gemini cost (owner only)
 */

import { createGuard, errorResponse, type ApiConfig } from '../api.ts';
import { isInterval, isPaidPlan } from '../../../services/billing/plans.ts';
import type { Ledger } from './ledger.ts';
import { createStripeClient, handleStripeEvent, verifyStripeSignature, StripeError } from './stripe.ts';

export interface BillingHandlerConfig extends Pick<ApiConfig, 'apiKey' | 'projectId' | 'verifyToken' | 'rateLimitPerMinute' | 'log' | 'fetchImpl'> {
    ledger: Ledger;
    stripeSecretKey?: string;
    stripeWebhookSecret?: string;
    now?: () => number;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

export function createBillingHandler(config: BillingHandlerConfig) {
    const log = config.log ?? console;
    const now = config.now ?? Date.now;
    const ledger = config.ledger;
    // The guard only needs the Firebase project; billing routes never call Gemini.
    const guard = createGuard({ ...config, apiKey: config.apiKey || 'unused', rateLimitPerMinute: config.rateLimitPerMinute ?? 60 });
    const stripe = config.stripeSecretKey ? createStripeClient(config.stripeSecretKey, config.fetchImpl) : null;
    const paymentsReady = !!(stripe && config.stripeWebhookSecret);

    return async (req: Request): Promise<Response> => {
        const url = new URL(req.url);
        const route = url.pathname.replace(/\/+$/, '').split('/').pop();
        if (req.method !== 'POST') return errorResponse(405, 'Use POST');

        if (route === 'webhook') {
            if (!paymentsReady) return errorResponse(503, 'Payments are not set up');
            const raw = await req.text();
            if (!verifyStripeSignature(raw, req.headers.get('stripe-signature'), config.stripeWebhookSecret!, Math.floor(now() / 1000))) {
                log.warn('[billing] webhook with a bad signature');
                return errorResponse(400, 'Bad signature');
            }
            try {
                const note = await handleStripeEvent(JSON.parse(raw), ledger);
                log.warn(`[billing] webhook: ${note}`);
                return json(200, { received: true });
            } catch (err) {
                // 500 makes Stripe retry later.
                log.error(`[billing] webhook failed: ${(err as Error).message}`);
                return errorResponse(500, 'Could not process the event');
            }
        }

        const caller = await guard(req);
        if (caller instanceof Response) return caller;
        let body: any = {};
        try { body = JSON.parse((await req.text()) || '{}'); } catch { return errorResponse(400, 'Invalid JSON body'); }

        try {
            switch (route) {
                case 'status':
                    return json(200, { ...(await ledger.status(caller)), paymentsReady, guest: !!caller.anonymous });

                case 'checkout': {
                    if (!paymentsReady) return errorResponse(503, 'Payments open soon.');
                    if (caller.anonymous) return errorResponse(403, 'Create a free account first, so your plan stays with you.');
                    if (!isPaidPlan(body.plan) || !isInterval(body.interval)) return errorResponse(400, 'Unknown plan');
                    const checkoutUrl = await stripe!.checkout({
                        uid: caller.uid,
                        plan: body.plan,
                        interval: body.interval,
                        origin: url.origin,
                        customerId: await ledger.customerOf(caller.uid),
                        email: caller.email,
                    });
                    return json(200, { url: checkoutUrl });
                }

                case 'portal': {
                    if (!stripe) return errorResponse(503, 'Payments open soon.');
                    const customerId = await ledger.customerOf(caller.uid);
                    if (!customerId) return errorResponse(404, 'No subscription yet.');
                    return json(200, { url: await stripe.portal(customerId, `${url.origin}/`) });
                }

                case 'end': {
                    if (typeof body.leaseId !== 'string') return errorResponse(400, 'leaseId is required');
                    const settled = await ledger.settleLive(caller, body.leaseId, body.used !== false);
                    return json(200, { settled: !!settled, chargedSeconds: settled?.chargedSeconds ?? 0 });
                }

                case 'report':
                    if (!ledger.isOwner(caller)) return errorResponse(403, 'Owner only');
                    return json(200, await ledger.report());

                default:
                    return errorResponse(404, 'Not found');
            }
        } catch (err) {
            if (err instanceof StripeError) {
                log.error(`[billing] Stripe: ${err.message}`);
                return errorResponse(502, 'The payment service did not respond. Please try again.');
            }
            log.error(`[billing] ${route} failed: ${(err as Error).message}`);
            return errorResponse(500, 'Something went wrong. Please try again.');
        }
    };
}
