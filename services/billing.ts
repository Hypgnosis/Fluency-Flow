/**
 * The app's side of plans and AI minutes: reads the account status from /api/billing, opens
 * Stripe Checkout / the customer portal, and tells the server when a voice session ends.
 *
 * Any call that comes back 402 (out of minutes, or paused) raises the paywall event, which the
 * app shell turns into the plans sheet. A 403 with reason "age" raises the age check instead
 * (Google's Gemini terms require users to be 18 or older).
 */

import { authHeaders } from './genaiClient';
import type { BillingInterval, PaidPlanId, PlanId } from './billing/plans';

export interface BillingStatus {
    plan: PlanId;
    minutesTotal: number;
    minutesLeft: number;
    renewsAt: number;
    /** A live Stripe subscription (renews by card unless cancelAtPeriodEnd). */
    subscription: { plan: PaidPlanId; interval: BillingInterval; status: string; periodEnd: number; cancelAtPeriodEnd: boolean } | null;
    /** A plan paid once (card or OXXO) that ends on periodEnd and does not renew. */
    pass: { plan: PaidPlanId; interval: BillingInterval; periodEnd: number } | null;
    /** A subscription waiting to start (first charge) when the current paid plan ends. */
    upcoming: { plan: PaidPlanId; interval: BillingInterval; startsAt: number } | null;
    hasCustomer: boolean;
    owner: boolean;
    /** The account confirmed it is 18 or older. */
    adult: boolean;
    paymentsReady: boolean;
    guest: boolean;
}

export type PaywallReason = 'quota' | 'daily' | 'paused' | 'full' | 'upgrade';
export interface PaywallRequest { reason: PaywallReason; message?: string }

const PAYWALL_EVENT = 'glossos:paywall';
const STATUS_EVENT = 'glossos:billing-status';
const AGE_EVENT = 'glossos:age-check';

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

/** Asks the app shell to show the 18+ confirmation. */
export function requestAgeCheck() {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(AGE_EVENT));
}

export function onAgeCheck(cb: () => void): () => void {
    window.addEventListener(AGE_EVENT, cb);
    return () => window.removeEventListener(AGE_EVENT, cb);
}

/** Is this error body one the billing UI handles (out of minutes, paused, or the age check)? */
export function isBillingRefusal(status: number, body: any): boolean {
    return status === 402 || (status === 403 && body?.error?.reason === 'age');
}

/** Reads a 402 (or age 403) body and raises the paywall or the age check. Returns the server's message. */
export function handlePaymentRequired(body: any): string {
    if (body?.error?.reason === 'age') {
        requestAgeCheck();
        return body.error.message || 'Please confirm you are 18 or older to use the AI features.';
    }
    const message = body?.error?.message || 'You have used your AI minutes.';
    const reason: PaywallReason = ['quota', 'daily', 'paused', 'full'].includes(body?.error?.reason) ? body.error.reason : 'quota';
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
        .then(publishStatus)
        .catch(() => lastStatus)
        .finally(() => { inflight = null; });
    return inflight;
}

function publishStatus(s: BillingStatus): BillingStatus {
    // JSON has no Infinity: the owner's unlimited minutes arrive as null.
    const fix = (n: unknown) => (typeof n === 'number' ? n : Number.POSITIVE_INFINITY);
    lastStatus = { ...s, minutesLeft: fix(s.minutesLeft), minutesTotal: fix(s.minutesTotal), pass: s.pass ?? null, upcoming: s.upcoming ?? null };
    window.dispatchEvent(new CustomEvent(STATUS_EVENT, { detail: lastStatus }));
    return lastStatus;
}

/** Records on the account that the user confirmed they are 18 or older. */
export async function confirmAdult(): Promise<void> {
    if (!enabled()) {
        if (lastStatus) publishStatus({ ...lastStatus, adult: true });
        return;
    }
    publishStatus(await post('adult', { confirm: true }));
}

/**
 * `npm run dev` preview only (never in a build): a sample account so the plans UI can be seen
 * without the Netlify functions. `?billing=out` shows the out-of-minutes state.
 */
function devPreviewStatus(): BillingStatus | null {
    if (process.env.GLOSSOS_DEV_PREVIEW !== 'true' || typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    const out = params.get('billing') === 'out';
    const pass = params.get('billing') === 'pass';
    if (!lastStatus) {
        lastStatus = {
            plan: pass ? 'plus' : 'free', minutesTotal: pass ? 80 : 5, minutesLeft: out ? 0 : pass ? 61.5 : 3.4, renewsAt: Date.now() + 12 * 86_400_000,
            subscription: null, pass: pass ? { plan: 'plus', interval: 'month', periodEnd: Date.now() + 12 * 86_400_000 } : null, upcoming: null,
            hasCustomer: false, owner: false, adult: !params.has('age'), paymentsReady: true, guest: false,
        };
        if (out) setTimeout(() => showPaywall({ reason: 'quota', message: 'You have used your free AI minutes for this month. Choose a plan to keep practicing.' }), 600);
    }
    window.dispatchEvent(new CustomEvent(STATUS_EVENT, { detail: lastStatus }));
    return lastStatus;
}

/**
 * Sends the user to Stripe Checkout for a plan: a subscription that renews by card, or
 * `once` to pay for one month or one year by card or with cash at OXXO.
 */
export async function startCheckout(plan: PaidPlanId, interval: BillingInterval, once = false): Promise<void> {
    const { url } = await post('checkout', { plan, interval, once });
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
