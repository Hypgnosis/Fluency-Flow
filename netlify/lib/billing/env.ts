/**
 * Billing configuration from Netlify environment variables.
 *
 *   OWNER_EMAILS          comma-separated verified emails with unlimited use
 *   STRIPE_SECRET_KEY     sk_test_... / sk_live_...
 *   STRIPE_WEBHOOK_SECRET whsec_... (endpoint: /api/billing/webhook)
 *   PREPAY_FLOAT_USD      what was pre-loaded on Gemini Prepay before revenue (default 5)
 *   MAX_SPEND_SHARE       most of net revenue Gemini may cost (default 0.8)
 *   FREE_BUDGET_USD       monthly cap for all free users together (default 3)
 *   USD_MXN               exchange rate for the economics (default 19)
 *   BILLING_ENFORCE       "off" disables limits in an emergency (default on)
 */

import { createLedger, type Ledger } from './ledger.ts';
import { blobsStore, type VersionedStore } from './store.ts';

type Env = Record<string, string | undefined>;

/** A Blobs store that connects on first use (Blobs needs the request's Netlify context). */
function lazyBlobs(): VersionedStore {
    let store: Promise<VersionedStore> | null = null;
    const get = () => (store ??= blobsStore());
    return {
        get: async key => (await get()).get(key),
        put: async (key, value, etag) => (await get()).put(key, value, etag),
    };
}

const num = (v: string | undefined, fallback: number) => {
    const n = Number(v);
    return v !== undefined && v !== '' && Number.isFinite(n) ? n : fallback;
};

export function billingEnabled(env: Env = process.env): boolean {
    return (env.BILLING_ENFORCE || '').toLowerCase() !== 'off';
}

let cached: Ledger | null = null;

export function ledgerFromEnv(env: Env = process.env): Ledger {
    return (cached ??= createLedger({
        store: lazyBlobs(),
        ownerEmails: (env.OWNER_EMAILS || '').split(','),
        floatUsd: num(env.PREPAY_FLOAT_USD, 5),
        maxSpendShare: num(env.MAX_SPEND_SHARE, 0.8),
        freeBudgetUsd: num(env.FREE_BUDGET_USD, 3),
        usdMxn: num(env.USD_MXN, 19),
    }));
}
