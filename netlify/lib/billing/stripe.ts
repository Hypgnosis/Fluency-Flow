/**
 * Stripe for Glossos, with no SDK: Checkout for subscriptions, the customer portal, and webhook
 * signature checks. Prices come from services/billing/plans.ts (sent as price_data), so nothing
 * has to be created in the Stripe dashboard first.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { PLANS, isPaidPlan, isInterval, type PaidPlanId, type BillingInterval } from '../../../services/billing/plans.ts';
import type { Ledger, Subscription } from './ledger.ts';

const STRIPE_API = 'https://api.stripe.com/v1';

export class StripeError extends Error {
    constructor(message: string, readonly status: number) { super(message); }
}

/** Encodes nested params the way Stripe expects: a[b][0][c]=d. */
export function formEncode(params: Record<string, unknown>, prefix = ''): string {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(params)) {
        if (v === undefined || v === null) continue;
        const key = prefix ? `${prefix}[${k}]` : k;
        if (Array.isArray(v)) {
            v.forEach((item, i) => {
                if (item !== null && typeof item === 'object') parts.push(formEncode(item as Record<string, unknown>, `${key}[${i}]`));
                else parts.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
            });
        } else if (typeof v === 'object') {
            parts.push(formEncode(v as Record<string, unknown>, key));
        } else {
            parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
        }
    }
    return parts.filter(Boolean).join('&');
}

export function createStripeClient(secretKey: string, fetchImpl: typeof fetch = fetch) {
    async function call(method: 'GET' | 'POST', path: string, params: Record<string, unknown> = {}) {
        const body = formEncode(params);
        const res = await fetchImpl(`${STRIPE_API}${path}${method === 'GET' && body ? `?${body}` : ''}`, {
            method,
            headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: method === 'POST' ? body : undefined,
        });
        const json: any = await res.json().catch(() => ({}));
        if (!res.ok) throw new StripeError(json?.error?.message || `Stripe error ${res.status}`, res.status);
        return json;
    }

    return {
        /** A Checkout page for a plan. Returns its URL. */
        async checkout(opts: { uid: string; plan: PaidPlanId; interval: BillingInterval; origin: string; customerId?: string; email?: string }): Promise<string> {
            const plan = PLANS[opts.plan];
            const meta = { uid: opts.uid, plan: opts.plan, interval: opts.interval };
            const session = await call('POST', '/checkout/sessions', {
                mode: 'subscription',
                client_reference_id: opts.uid,
                ...(opts.customerId ? { customer: opts.customerId } : opts.email ? { customer_email: opts.email } : {}),
                line_items: [{
                    quantity: 1,
                    price_data: {
                        currency: 'mxn',
                        unit_amount: Math.round(plan.price![opts.interval] * 100),
                        recurring: { interval: opts.interval },
                        product_data: { name: `Glossos ${plan.name}`, description: `${plan.minutes} AI minutes every month` },
                    },
                }],
                metadata: meta,
                subscription_data: { metadata: meta },
                allow_promotion_codes: 'true',
                success_url: `${opts.origin}/?checkout=success`,
                cancel_url: `${opts.origin}/?checkout=cancel`,
            });
            if (!session.url) throw new StripeError('Stripe did not return a checkout page', 502);
            return session.url;
        },

        /** The Stripe customer portal (change plan, card, cancel). Returns its URL. */
        async portal(customerId: string, returnUrl: string): Promise<string> {
            const session = await call('POST', '/billing_portal/sessions', { customer: customerId, return_url: returnUrl });
            return session.url;
        },
    };
}

/**
 * Checks a Stripe-Signature header (t=...,v1=...) against the raw body.
 * https://docs.stripe.com/webhooks#verify-manually
 */
export function verifyStripeSignature(rawBody: string, header: string | null, secret: string, nowSeconds: number, toleranceSeconds = 300): boolean {
    if (!header || !secret) return false;
    const fields = header.split(',').map(p => p.split('=') as [string, string]);
    const t = Number(fields.find(([k]) => k === 't')?.[1]);
    const signatures = fields.filter(([k]) => k === 'v1').map(([, v]) => v);
    if (!Number.isFinite(t) || !signatures.length) return false;
    if (Math.abs(nowSeconds - t) > toleranceSeconds) return false;
    const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`, 'utf8').digest();
    return signatures.some(sig => {
        const got = Buffer.from(sig, 'hex');
        return got.length === expected.length && timingSafeEqual(got, expected);
    });
}

/** Reads the subscription fields Glossos needs (period fields moved to items in newer API versions). */
export function subscriptionFrom(sub: any): { uid?: string; customerId?: string; subscription: Subscription | null } {
    const meta = sub?.metadata ?? {};
    const item = sub?.items?.data?.[0];
    const plan = meta.plan;
    const interval = item?.price?.recurring?.interval ?? meta.interval;
    const start = sub?.current_period_start ?? item?.current_period_start;
    const end = sub?.current_period_end ?? item?.current_period_end;
    const customerId = typeof sub?.customer === 'string' ? sub.customer : sub?.customer?.id;
    if (!isPaidPlan(plan) || !isInterval(interval) || !start || !end) return { uid: meta.uid, customerId, subscription: null };
    return {
        uid: meta.uid,
        customerId,
        subscription: {
            plan,
            interval,
            status: String(sub.status),
            periodStart: start * 1000,
            periodEnd: end * 1000,
            cancelAtPeriodEnd: !!sub.cancel_at_period_end,
            subscriptionId: sub.id,
        },
    };
}

/** Applies one verified Stripe event to the ledger. Returns a short note for the logs. */
export async function handleStripeEvent(event: any, ledger: Ledger): Promise<string> {
    const obj = event?.data?.object;
    switch (event?.type) {
        case 'checkout.session.completed': {
            const uid = obj?.client_reference_id || obj?.metadata?.uid;
            const customerId = typeof obj?.customer === 'string' ? obj.customer : obj?.customer?.id;
            if (uid && customerId) await ledger.applySubscription(uid, null, customerId);
            return `checkout completed for ${uid ? 'user' : 'unknown user'}`;
        }
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted': {
            const { uid, customerId, subscription } = subscriptionFrom(obj);
            if (!uid) return 'subscription without uid ignored';
            if (subscription && event.type === 'customer.subscription.deleted') subscription.status = 'canceled';
            await ledger.applySubscription(uid, subscription, customerId);
            return `subscription ${subscription?.status ?? 'unreadable'}`;
        }
        case 'invoice.paid': {
            if (String(obj?.currency).toLowerCase() !== 'mxn' || !(obj?.amount_paid > 0)) return 'invoice without MXN amount';
            const added = await ledger.recordRevenue(event.id, obj.amount_paid / 100);
            return added ? `revenue +${obj.amount_paid / 100} MXN` : 'invoice already counted';
        }
        default:
            return `ignored ${event?.type}`;
    }
}
