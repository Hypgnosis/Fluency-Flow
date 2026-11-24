/**
 * The Glossos billing ledger: who is on which plan, how many AI minutes they have left, and a
 * global guard that keeps total Gemini spend below the money actually collected.
 *
 * Money rules (the owner's requirement: never owe Google before users have paid):
 * - Every user has a monthly allowance in USD of Gemini cost (plan minutes x MINUTE_USD).
 * - Text calls are charged after the fact from Gemini's real token counts.
 * - Live voice sessions are charged up front: the server reserves the session's time before it
 *   mints the token, and the token itself expires when that time runs out, so a session can never
 *   outlive what the user has left. When the session ends the unused part is given back.
 * - The global guard refuses non-owner AI when estimated spend would pass
 *   `floatUsd + net revenue x maxSpendShare`, and caps free-plan spend per month.
 * - A client could lie about when a voice session ended. Free voice time handed out (before any
 *   refunds) is therefore capped too, so free accounts can never cost more than a fixed amount.
 *
 * A user's plan can come from a Stripe subscription (renews by card) or a pass (paid once by
 * card or cash at OXXO, for a month or a year). If several are live, the best plan wins.
 *
 * Google's Gemini API terms require users to be 18 or older, so AI stays off until the account
 * has confirmed its age once.
 */

import {
    PLANS, PLAN_RANK, MINUTE_USD, DEFAULT_USD_MXN, liveCostPerSecond, netRevenueMxn,
    type PlanId, type PaidPlanId, type BillingInterval, type LivePurpose, type PaymentMethod,
} from '../../../services/billing/plans.ts';
import { update, ConflictError, type VersionedStore } from './store.ts';

export interface Caller {
    uid: string;
    email?: string;
    emailVerified?: boolean;
    anonymous?: boolean;
}

export interface Subscription {
    plan: PaidPlanId;
    interval: BillingInterval;
    /** Stripe subscription status (active, trialing, past_due, canceled, ...). */
    status: string;
    periodStart: number;
    periodEnd: number;
    cancelAtPeriodEnd?: boolean;
    subscriptionId?: string;
}

/** A plan paid once (card or OXXO) for a month or a year. It does not renew. */
export interface Pass {
    plan: PaidPlanId;
    interval: BillingInterval;
    periodStart: number;
    periodEnd: number;
    /** Checkout sessions already applied, so a retried webhook does not add time twice. */
    payments: string[];
}

/** One live source of a paid plan. */
export interface Entitlement {
    kind: 'subscription' | 'pass';
    plan: PaidPlanId;
    interval: BillingInterval;
    status: string;
    periodStart: number;
    periodEnd: number;
    /** False only for a subscription that will renew by itself. */
    ending: boolean;
}

export interface Lease {
    purpose: LivePurpose;
    at: number;
    seconds: number;
    reservedUsd: number;
    plan: PlanId;
}

export interface Account {
    uid: string;
    createdAt: number;
    customerId?: string;
    /** Stripe subscriptions by id (older accounts kept a single `subscription`). */
    subs?: Record<string, Subscription>;
    subscription?: Subscription;
    pass?: Pass;
    /** When the user confirmed they are 18 or older. */
    adultAt?: number;
    /** Start of the current monthly usage window. */
    windowStart: number;
    /** Which plan the window belongs to; a new plan starts a fresh window. */
    windowPlan?: PlanId;
    /** Settled Gemini cost in this window, USD. */
    usedUsd: number;
    leases: Record<string, Lease>;
    /** Mexico City date of `leasedUsdToday`. */
    day: string;
    /** Voice time leased today, valued in USD (never refunded: it caps a tampered client). */
    leasedUsdToday: number;
}

export interface MonthTotals {
    freeUsd: number; paidUsd: number; ownerUsd: number; revenueGrossMxn: number; revenueNetMxn: number;
    /** Voice time handed out this month before refunds, USD: the most it could have cost. */
    freeLeasedUsd?: number; paidLeasedUsd?: number;
}

export interface Totals {
    spendUsd: { free: number; paid: number; owner: number };
    revenueGrossMxn: number;
    revenueNetMxn: number;
    months: Record<string, MonthTotals>;
    /** Recently processed payment event ids, so retried webhooks are not counted twice. */
    events: string[];
}

export interface LedgerOptions {
    store: VersionedStore;
    /** Emails (verified) that get the unlimited owner plan. */
    ownerEmails?: string[];
    /** USD the owner pre-loaded on Gemini Prepay before any revenue (covers free trials). */
    floatUsd?: number;
    /** Most of the net revenue that Gemini spend may reach (0.8 = 80%). */
    maxSpendShare?: number;
    /** Monthly cap on what free users together may cost, USD. */
    freeBudgetUsd?: number;
    usdMxn?: number;
    /** Keep AI off until the account confirms it is 18 or older (default on). */
    requireAdult?: boolean;
    now?: () => number;
    log?: Pick<Console, 'warn' | 'error'>;
}

export type RefusalReason = 'quota' | 'daily' | 'paused' | 'full' | 'age';
export type Refusal = { ok: false; reason: RefusalReason; message: string; plan: PlanId };
export type LeaseGrant = { ok: true; leaseId: string; seconds: number; plan: PlanId };

const GRACE_MS = 3 * 24 * 3600 * 1000;
/** Subscription statuses that give the plan. 'trialing' is left out on purpose: Glossos only uses a
 *  trial to start a new subscription when a plan the user already paid for runs out. */
const LIVE_STATUSES = new Set(['active', 'past_due']);
/** Statuses of a subscription that will charge the card again by itself. */
const RENEWING_STATUSES = new Set(['active', 'past_due', 'trialing']);
const MAX_LEASE_SECONDS: Record<LivePurpose, number> = { talk: 600, assist: 1200, voice: 600 };
const OWNER_LEASE_SECONDS = 1800;
const MIN_LEASE_SECONDS = 20;
const MIN_TEXT_USD = 0.0005;
/** Free voice time handed out per month may reach this many times the free budget. */
const FREE_LEASE_FACTOR = 3;
const OLD_SUBSCRIPTION_MS = 90 * 24 * 3600 * 1000;
const TOTALS_KEY = 'global/totals';
const TOTALS_CACHE_MS = 15_000;

const mexicoDay = (t: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);
const monthKey = (t: number) => new Date(t).toISOString().slice(0, 7);

/** Adds `n` calendar months to a timestamp (UTC), clamping to the month's last day. */
export function addMonths(t: number, n: number): number {
    const d = new Date(t);
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + n);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
    return d.getTime();
}

/** Start of the monthly window that contains `now`, counting whole months from `anchor`. */
export function monthlyWindowStart(anchor: number, now: number): number {
    if (now <= anchor) return anchor;
    const a = new Date(anchor), b = new Date(now);
    let n = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
    while (n > 0 && addMonths(anchor, n) > now) n--;
    return addMonths(anchor, n);
}

export function emptyTotals(): Totals {
    return { spendUsd: { free: 0, paid: 0, owner: 0 }, revenueGrossMxn: 0, revenueNetMxn: 0, months: {}, events: [] };
}

const emptyMonth = (): MonthTotals => ({ freeUsd: 0, paidUsd: 0, ownerUsd: 0, revenueGrossMxn: 0, revenueNetMxn: 0, freeLeasedUsd: 0, paidLeasedUsd: 0 });

/** The account's live paid plans, best first (higher plan; on a tie a pass, then the older one). */
export function liveEntitlements(a: Account | null, t: number): Entitlement[] {
    if (!a) return [];
    const out: Entitlement[] = [];
    const subs = Object.values(a.subs ?? {}).concat(a.subscription ? [a.subscription] : []);
    for (const s of subs) {
        if (!LIVE_STATUSES.has(s.status) || s.periodEnd + GRACE_MS <= t) continue;
        out.push({ kind: 'subscription', plan: s.plan, interval: s.interval, status: s.status, periodStart: s.periodStart, periodEnd: s.periodEnd, ending: !!s.cancelAtPeriodEnd });
    }
    const p = a.pass;
    if (p && p.periodEnd > t) {
        out.push({ kind: 'pass', plan: p.plan, interval: p.interval, status: 'active', periodStart: p.periodStart, periodEnd: p.periodEnd, ending: true });
    }
    return out.sort((x, y) =>
        PLAN_RANK[y.plan] - PLAN_RANK[x.plan]
        || (x.kind === y.kind ? 0 : x.kind === 'pass' ? -1 : 1)
        || x.periodStart - y.periodStart);
}

/** A subscription that will charge the card again by itself (including one waiting to start). */
export function renewingSubscription(a: Account | null, t: number): Subscription | null {
    const subs = Object.values(a?.subs ?? {}).concat(a?.subscription ? [a.subscription] : []);
    return subs.find(s => RENEWING_STATUSES.has(s.status) && !s.cancelAtPeriodEnd && s.periodEnd + GRACE_MS > t) ?? null;
}

export function createLedger(opts: LedgerOptions) {
    const store = opts.store;
    const now = opts.now ?? Date.now;
    const log = opts.log ?? console;
    const owners = new Set((opts.ownerEmails ?? []).map(e => e.trim().toLowerCase()).filter(Boolean));
    const floatUsd = opts.floatUsd ?? 5;
    const maxSpendShare = opts.maxSpendShare ?? 0.8;
    const freeBudgetUsd = opts.freeBudgetUsd ?? 3;
    const usdMxn = opts.usdMxn ?? DEFAULT_USD_MXN;
    const requireAdult = opts.requireAdult ?? true;
    let totalsCache: { value: Totals; at: number } | null = null;

    const accountKey = (uid: string) => `accounts/${uid.replace(/[^A-Za-z0-9_-]/g, '_')}`;

    const isOwner = (c: Caller) => !!c.email && c.emailVerified !== false && owners.has(c.email.toLowerCase());

    function planOf(acct: Account | null, caller: Caller, t: number): PlanId {
        if (isOwner(caller)) return 'owner';
        return liveEntitlements(acct, t)[0]?.plan ?? 'free';
    }

    const isAdult = (a: Account, caller: Caller) => !requireAdult || isOwner(caller) || !!a.adultAt;

    /** Brings an account up to date: new window, new day, expired leases charged in full. */
    function normalize(acct: Account | null, caller: Caller, t: number): Account {
        const a: Account = acct ?? {
            uid: caller.uid, createdAt: t, windowStart: t, usedUsd: 0, leases: {}, day: mexicoDay(t), leasedUsdToday: 0,
        };
        if (a.subscription) {
            a.subs = { ...(a.subs ?? {}), [a.subscription.subscriptionId ?? 'default']: a.subscription };
            delete a.subscription;
        }
        for (const [id, s] of Object.entries(a.subs ?? {})) {
            if (s.periodEnd + OLD_SUBSCRIPTION_MS < t) delete a.subs![id];
        }
        for (const [id, lease] of Object.entries(a.leases)) {
            if (t > lease.at + lease.seconds * 1000 + 60_000) {
                a.usedUsd += lease.reservedUsd;
                delete a.leases[id];
            }
        }
        const best = liveEntitlements(a, t)[0];
        const start = monthlyWindowStart(best ? best.periodStart : a.createdAt, t);
        const windowPlan: PlanId = best?.plan ?? 'free';
        if (start !== a.windowStart || windowPlan !== (a.windowPlan ?? 'free')) {
            a.windowStart = start;
            a.windowPlan = windowPlan;
            a.usedUsd = 0;
        }
        const day = mexicoDay(t);
        if (day !== a.day) {
            a.day = day;
            a.leasedUsdToday = 0;
        }
        a.leasedUsdToday ??= 0;
        return a;
    }

    const reservedUsd = (a: Account) => Object.values(a.leases).reduce((s, l) => s + l.reservedUsd, 0);

    function remainingUsd(a: Account, plan: PlanId): number {
        const allowance = PLANS[plan].minutes * MINUTE_USD;
        return Math.max(0, allowance - a.usedUsd - reservedUsd(a));
    }

    async function readTotals(fresh = false): Promise<Totals> {
        const t = now();
        if (!fresh && totalsCache && t - totalsCache.at < TOTALS_CACHE_MS) return totalsCache.value;
        const { value } = await store.get<Totals>(TOTALS_KEY);
        totalsCache = { value: value ?? emptyTotals(), at: t };
        return totalsCache.value;
    }

    /** Spend the guard allows for non-owner usage, USD. */
    const spendCeilingUsd = (tot: Totals) => floatUsd + (tot.revenueNetMxn / usdMxn) * maxSpendShare;

    async function guard(plan: PlanId, extraUsd: number, voice = false): Promise<{ reason: RefusalReason; message: string } | null> {
        if (plan === 'owner') return null;
        const tot = await readTotals();
        const spent = tot.spendUsd.free + tot.spendUsd.paid;
        if (spent + extraUsd > spendCeilingUsd(tot)) {
            log.warn(`[billing] guard: spend $${spent.toFixed(2)} at ceiling $${spendCeilingUsd(tot).toFixed(2)}`);
            return { reason: 'paused', message: 'Glossos is very busy right now. Please try again later.' };
        }
        if (plan === 'free') {
            const month = tot.months[monthKey(now())];
            if ((month?.freeUsd ?? 0) + extraUsd > freeBudgetUsd) {
                return { reason: 'full', message: 'Free practice is full for this month. Choose a plan to keep going.' };
            }
            if (voice && (month?.freeLeasedUsd ?? 0) + extraUsd > freeBudgetUsd * FREE_LEASE_FACTOR) {
                log.warn('[billing] guard: free voice time handed out reached its monthly cap');
                return { reason: 'full', message: 'Free voice practice is full for this month. Choose a plan to keep talking.' };
            }
        }
        return null;
    }

    /** Adds spend (and voice time handed out) to the global totals. Best effort: a failure here must not fail the user's request. */
    async function addSpend(plan: PlanId, usd: number, leasedUsd = 0) {
        if (!usd && !leasedUsd) return;
        const bucket = plan === 'owner' ? 'owner' : plan === 'free' ? 'free' : 'paid';
        const ym = monthKey(now());
        try {
            const next = await update<Totals>(store, TOTALS_KEY, cur => {
                const tot = cur ?? emptyTotals();
                tot.spendUsd[bucket] = Math.max(0, tot.spendUsd[bucket] + usd);
                const m = (tot.months[ym] ??= emptyMonth());
                const field = bucket === 'owner' ? 'ownerUsd' : bucket === 'free' ? 'freeUsd' : 'paidUsd';
                m[field] = Math.max(0, m[field] + usd);
                if (leasedUsd > 0 && bucket !== 'owner') {
                    const lf = bucket === 'free' ? 'freeLeasedUsd' : 'paidLeasedUsd';
                    m[lf] = (m[lf] ?? 0) + leasedUsd;
                }
                return tot;
            });
            totalsCache = { value: next, at: now() };
        } catch (err) {
            log.error(`[billing] could not record spend: ${(err as Error).message}`);
        }
    }

    async function getAccount(caller: Caller): Promise<Account> {
        const { value } = await store.get<Account>(accountKey(caller.uid));
        return normalize(value, caller, now());
    }

    function quotaRefusal(plan: PlanId): Refusal {
        return {
            ok: false, reason: 'quota', plan,
            message: plan === 'free'
                ? 'You have used your free AI minutes for this month. Choose a plan to keep practicing.'
                : 'You have used this month\'s AI minutes. They refill on your next billing date, or you can upgrade.',
        };
    }

    const ageRefusal = (plan: PlanId): Refusal => ({
        ok: false, reason: 'age', plan,
        message: 'Please confirm you are 18 or older to use the AI features.',
    });

    let lastPing = 0;

    return {
        planOf,
        isOwner,

        /** Round trip through the store (a write at most once a minute per instance). */
        async ping(): Promise<boolean> {
            const t = now();
            if (t - lastPing < 60_000) return (await store.get<number>('health/ping')).value !== null;
            const next = await update<number>(store, 'health/ping', () => t);
            lastPing = t;
            return next === t && (await store.get<number>('health/ping')).value === t;
        },

        /** Account summary for the app. */
        async status(caller: Caller) {
            const t = now();
            const a = await getAccount(caller);
            const plan = planOf(a, caller, t);
            const allowance = PLANS[plan].minutes;
            const left = remainingUsd(a, plan) / MINUTE_USD;
            const live = liveEntitlements(a, t);
            const sub = live.find(e => e.kind === 'subscription');
            const pass = live.find(e => e.kind === 'pass');
            const waiting = Object.values(a.subs ?? {}).find(s => s.status === 'trialing' && s.periodEnd > t);
            return {
                plan,
                minutesTotal: allowance,
                minutesLeft: Number.isFinite(allowance) ? Math.max(0, left) : Number.POSITIVE_INFINITY,
                /** When the minutes refill. */
                renewsAt: addMonths(a.windowStart, 1),
                subscription: sub ? {
                    plan: sub.plan, interval: sub.interval, status: sub.status, periodEnd: sub.periodEnd, cancelAtPeriodEnd: sub.ending,
                } : null,
                pass: pass ? { plan: pass.plan, interval: pass.interval, periodEnd: pass.periodEnd } : null,
                /** A subscription that starts charging when a paid plan runs out. */
                upcoming: waiting ? { plan: waiting.plan, interval: waiting.interval, startsAt: waiting.periodEnd } : null,
                hasCustomer: !!a.customerId,
                owner: plan === 'owner',
                adult: isAdult(a, caller),
            };
        },

        /** Records that the user confirmed they are 18 or older (once). */
        async confirmAdult(caller: Caller): Promise<void> {
            const t = now();
            await update<Account>(store, accountKey(caller.uid), cur => {
                const a = normalize(cur, caller, t);
                a.adultAt ??= t;
                return a;
            });
        },

        /** Reserves Live voice time and returns how long the token may live. */
        async reserveLive(caller: Caller, purpose: LivePurpose): Promise<LeaseGrant | Refusal> {
            const t = now();
            const rate = liveCostPerSecond(purpose);
            let result: LeaseGrant | Refusal | null = null;
            let reserved = 0;
            const peek = await getAccount(caller);
            const peekPlan = planOf(peek, caller, t);
            if (!isAdult(peek, caller)) return ageRefusal(peekPlan);
            const blocked = await guard(peekPlan, rate * MIN_LEASE_SECONDS, true);
            if (blocked) return { ok: false, ...blocked, plan: peekPlan };

            await update<Account>(store, accountKey(caller.uid), cur => {
                const a = normalize(cur, caller, t);
                const plan = planOf(a, caller, t);
                const dailyLeft = (PLANS[plan].dailyLeaseMinutes * MINUTE_USD - a.leasedUsdToday) / rate;
                const affordable = Math.floor(remainingUsd(a, plan) / rate);
                const max = plan === 'owner' ? OWNER_LEASE_SECONDS : MAX_LEASE_SECONDS[purpose];
                const seconds = Math.floor(Math.min(max, affordable, dailyLeft));
                if (seconds < MIN_LEASE_SECONDS) {
                    result = affordable < MIN_LEASE_SECONDS
                        ? quotaRefusal(plan)
                        : { ok: false, reason: 'daily', plan, message: 'You have reached today\'s voice limit. It resets tomorrow.' };
                    reserved = 0;
                    return a;
                }
                const leaseId = `${t.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
                reserved = seconds * rate;
                a.leases[leaseId] = { purpose, at: t, seconds, reservedUsd: reserved, plan };
                a.leasedUsdToday += reserved;
                result = { ok: true, leaseId, seconds, plan };
                return a;
            });
            if (result && (result as LeaseGrant).ok) await addSpend((result as LeaseGrant).plan, reserved, reserved);
            return result!;
        },

        /** Ends a Live lease: charges the time used (by the server clock) and returns the rest. */
        async settleLive(caller: Caller, leaseId: string, used = true): Promise<{ chargedSeconds: number } | null> {
            const t = now();
            let refundUsd = 0, chargedSeconds = 0, plan: PlanId = 'free', found = false;
            await update<Account>(store, accountKey(caller.uid), cur => {
                const a = normalize(cur, caller, t);
                const lease = a.leases[leaseId];
                refundUsd = 0; chargedSeconds = 0; found = !!lease;
                if (!lease) return a;
                const rate = lease.reservedUsd / lease.seconds;
                const elapsed = Math.min(lease.seconds, Math.max(0, (t - lease.at) / 1000));
                chargedSeconds = used ? Math.max(5, elapsed) : 0;
                chargedSeconds = Math.min(chargedSeconds, lease.seconds);
                a.usedUsd += chargedSeconds * rate;
                refundUsd = lease.reservedUsd - chargedSeconds * rate;
                plan = lease.plan;
                delete a.leases[leaseId];
                return a;
            });
            if (!found) return null;
            await addSpend(plan, -refundUsd);
            return { chargedSeconds };
        },

        /** Before a text call: is there anything left? */
        async checkText(caller: Caller): Promise<{ ok: true; plan: PlanId } | Refusal> {
            const a = await getAccount(caller);
            const plan = planOf(a, caller, now());
            if (!isAdult(a, caller)) return ageRefusal(plan);
            if (remainingUsd(a, plan) < MIN_TEXT_USD) return quotaRefusal(plan);
            const blocked = await guard(plan, MIN_TEXT_USD);
            if (blocked) return { ok: false, ...blocked, plan };
            return { ok: true, plan };
        },

        /** After a text call: charge its real cost. */
        async chargeText(caller: Caller, usd: number) {
            if (!(usd > 0)) return;
            const t = now();
            let plan: PlanId = 'free';
            await update<Account>(store, accountKey(caller.uid), cur => {
                const a = normalize(cur, caller, t);
                plan = planOf(a, caller, t);
                a.usedUsd += usd;
                return a;
            });
            await addSpend(plan, usd);
        },

        /** Stores a subscription Stripe reports for a user (and links the Stripe customer). */
        async applySubscription(uid: string, sub: Subscription | null, customerId?: string) {
            await update<Account>(store, accountKey(uid), cur => {
                const a = normalize(cur, { uid }, now());
                if (customerId) a.customerId = customerId;
                if (sub) a.subs = { ...(a.subs ?? {}), [sub.subscriptionId ?? 'default']: sub };
                return normalize(a, { uid }, now());
            });
        },

        /**
         * Adds a paid-once plan. The same plan while one is live adds the time on top; a different
         * plan starts today. Returns false if this payment was already applied.
         */
        async applyPass(uid: string, plan: PaidPlanId, interval: BillingInterval, paymentId: string): Promise<boolean> {
            const t = now();
            const months = interval === 'year' ? 12 : 1;
            let added = false;
            await update<Account>(store, accountKey(uid), cur => {
                const a = normalize(cur, { uid }, t);
                const p = a.pass;
                added = !p?.payments.includes(paymentId);
                if (!added) return a;
                const payments = [...(p?.payments ?? []), paymentId].slice(-20);
                a.pass = p && p.periodEnd > t && p.plan === plan
                    ? { ...p, interval, periodEnd: addMonths(p.periodEnd, months), payments }
                    : { plan, interval, periodStart: t, periodEnd: addMonths(t, months), payments };
                return normalize(a, { uid }, t);
            });
            return added;
        },

        /** What a user already pays for: live plans and any subscription that renews by itself. */
        async coverage(uid: string): Promise<{ live: Entitlement[]; renewing: Subscription | null }> {
            const t = now();
            const { value } = await store.get<Account>(accountKey(uid));
            const a = value ? normalize(value, { uid }, t) : null;
            return { live: liveEntitlements(a, t), renewing: renewingSubscription(a, t) };
        },

        async customerOf(uid: string): Promise<string | undefined> {
            return (await store.get<Account>(accountKey(uid))).value?.customerId;
        },

        /** Counts a payment once (by event id). Returns false if it was already counted. */
        async recordRevenue(eventId: string, grossMxn: number, method: PaymentMethod = 'card'): Promise<boolean> {
            let added = false;
            const ym = monthKey(now());
            const next = await update<Totals>(store, TOTALS_KEY, cur => {
                const tot = cur ?? emptyTotals();
                added = !tot.events.includes(eventId);
                if (!added) return tot;
                const net = netRevenueMxn(grossMxn, method);
                tot.revenueGrossMxn += grossMxn;
                tot.revenueNetMxn += net;
                const m = (tot.months[ym] ??= emptyMonth());
                m.revenueGrossMxn += grossMxn;
                m.revenueNetMxn += net;
                tot.events = [...tot.events, eventId].slice(-500);
                return tot;
            });
            totalsCache = { value: next, at: now() };
            return added;
        },

        /** Numbers for the owner: money in, estimated Gemini cost, and what the guard allows. */
        async report() {
            const tot = await readTotals(true);
            const ym = monthKey(now());
            const m = { ...emptyMonth(), ...(tot.months[ym] ?? {}) };
            const spent = tot.spendUsd.free + tot.spendUsd.paid + tot.spendUsd.owner;
            return {
                month: ym,
                usdMxn,
                thisMonth: {
                    ...m,
                    totalUsd: m.freeUsd + m.paidUsd + m.ownerUsd,
                    voiceLeasedUsd: (m.freeLeasedUsd ?? 0) + (m.paidLeasedUsd ?? 0),
                },
                allTime: {
                    revenueGrossMxn: tot.revenueGrossMxn,
                    revenueNetMxn: tot.revenueNetMxn,
                    spendUsd: tot.spendUsd,
                    totalSpendUsd: spent,
                    estimatedProfitMxn: tot.revenueNetMxn - spent * usdMxn,
                },
                guard: { ceilingUsd: spendCeilingUsd(tot), floatUsd, maxSpendShare, freeBudgetUsd, freeVoiceCapUsd: freeBudgetUsd * FREE_LEASE_FACTOR },
            };
        },
    };
}

export type Ledger = ReturnType<typeof createLedger>;
export { ConflictError };
