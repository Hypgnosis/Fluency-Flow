/**
 * The app's side of plans and AI minutes: reads the account status from /api/billing, opens
 * Stripe Checkout / the customer portal, and tells the server when a voice session ends.
 *
 * Any call that comes back 402 (out of minutes, or paused) raises the paywall event, which the
 * app shell turns into the plans sheet.
 */

import { authHeaders } from './genaiClient';
import type { BillingInterval, PaidPlanId, PlanId } from './billing/plans';

export interface BillingStatus {
    plan: PlanId;
    minutesTotal: number;
    minutesLeft: number;
    renewsAt: number;
    subscription: { plan: PaidPlanId; interval: BillingInterval; status: string; periodEnd: number; cancelAtPeriodEnd: boolean } | null;
    hasCustomer: boolean;
    owner: boolean;
    paymentsReady: boolean;
    guest: boolean;
}

export type PaywallReason = 'quota' | 'daily' | 'paused' | 'upgrade';
export interface PaywallRequest { reason: PaywallReason; message?: string }

const PAYWALL_EVENT = 'glossos:paywall';
const STATUS_EVENT = 'glossos:billing-status';

/** Billing is a production (Netlify) feature; the local dev build talks to Gemini directly. */
const enabled = () => !(process.env.GEMINI_API_KEY || process.env.API_KEY);

let lastStatus: BillingStatus | null = null;
let inflight: Promise<BillingStatus | null> | null = null;

/** Opens the plans sheet. */
export function showPaywall(req: PaywallRequest) {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<PaywallRequest>(PAYWALL_EVENT, { detail: req }));
}

export function onPaywall(cb: (req: PaywallRequest) => void): () => void {
    const handler = (e: Event) => cb((e as CustomEvent<PaywallRequest>).detail);
    window.addEventListener(PAYWALL_EVENT, handler);
    return () => window.removeEventListener(PAYWALL_EVENT, handler);
}

export function onBillingStatus(cb: (s: BillingStatus | null) => void): () => void {
    const handler = (e: Event) => cb((e as CustomEvent<BillingStatus | null>).detail);
    window.addEventListener(STATUS_EVENT, handler);
    return () => window.removeEventListener(STATUS_EVENT, handler);
}

export const cachedBillingStatus = () => lastStatus;

/** Reads a 402 body and raises the paywall. Returns the server's message. */
export function handlePaymentRequired(body: any): string {
    const message = body?.error?.message || 'You have used your AI minutes.';
    const reason: PaywallReason = ['quota', 'daily', 'paused'].includes(body?.error?.reason) ? body.error.reason : 'quota';
    showPaywall({ reason, message });
    void refreshBillingStatus();
    return message;
}

async function post(path: string, body: unknown = {}, keepalive = false): Promise<any> {
    const res = await fetch(`/api/billing/${path}`, { method: 'POST', headers: await authHeaders(), body: JSON.stringify(body), keepalive });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message || `Request failed (${res.status})`);
    return json;
}

/** Fetches the account status (deduplicated) and tells listeners. */
export function refreshBillingStatus(): Promise<BillingStatus | null> {
    if (!enabled()) return Promise.resolve(devPreviewStatus());
    inflight ??= post('status')
        .then((s: BillingStatus) => {
            // JSON has no Infinity: the owner's unlimited minutes arrive as null.
            const fix = (n: unknown) => (typeof n === 'number' ? n : Number.POSITIVE_INFINITY);
            lastStatus = { ...s, minutesLeft: fix(s.minutesLeft), minutesTotal: fix(s.minutesTotal) };
            window.dispatchEvent(new CustomEvent(STATUS_EVENT, { detail: lastStatus }));
            return lastStatus;
        })
        .catch(() => lastStatus)
        .finally(() => { inflight = null; });
    return inflight;
}

/**
 * `npm run dev` preview only (never in a build): a sample account so the plans UI can be seen
 * without the Netlify functions. `?billing=out` shows the out-of-minutes state.
 */
function devPreviewStatus(): BillingStatus | null {
    if (process.env.GLOSSOS_DEV_PREVIEW !== 'true' || typeof window === 'undefined') return null;
    const out = new URLSearchParams(window.location.search).get('billing') === 'out';
    if (!lastStatus) {
        lastStatus = {
            plan: 'free', minutesTotal: 5, minutesLeft: out ? 0 : 3.4, renewsAt: Date.now() + 12 * 86_400_000,
            subscription: null, hasCustomer: false, owner: false, paymentsReady: true, guest: false,
        };
        if (out) setTimeout(() => showPaywall({ reason: 'quota', message: 'You have used your free AI minutes for this month. Choose a plan to keep practicing.' }), 600);
    }
    window.dispatchEvent(new CustomEvent(STATUS_EVENT, { detail: lastStatus }));
    return lastStatus;
}

/** Sends the user to Stripe Checkout for a plan. */
export async function startCheckout(plan: PaidPlanId, interval: BillingInterval): Promise<void> {
    const { url } = await post('checkout', { plan, interval });
    window.location.assign(url);
}

/** Sends the user to the Stripe customer portal (change card or plan, cancel). */
export async function openBillingPortal(): Promise<void> {
    const { url } = await post('portal');
    window.location.assign(url);
}

/**
 * Tells the server a voice session ended so the unused part of its reserved time comes back.
 * `used: false` for a token that never opened a session.
 */
export function endLease(leaseId: string, used = true): void {
    if (!enabled() || !leaseId) return;
    post('end', { leaseId, used }, true)
        .then(() => refreshBillingStatus())
        .catch(() => { /* the lease is charged in full when it expires */ });
}
