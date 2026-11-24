// @vitest-environment node
import { createHmac } from 'crypto';
import {
    PLANS, PAID_PLANS, MINUTE_USD, netRevenueMxn, worstCaseCostShare, textCostUsd, formatMinutes,
} from '../services/billing/plans';
import { memoryStore, update } from '../netlify/lib/billing/store';
import { createLedger, monthlyWindowStart } from '../netlify/lib/billing/ledger';
import { formEncode, verifyStripeSignature, subscriptionFrom, handleStripeEvent } from '../netlify/lib/billing/stripe';
import { createBillingHandler } from '../netlify/lib/billing/handler';
import { createGenaiHandler, createLiveTokenHandler, meterStream } from '../netlify/lib/api';

const silent = { warn: () => undefined, error: () => undefined };
const DAY = 24 * 3600 * 1000;
const T0 = Date.UTC(2026, 10, 24, 18, 0, 0); // 2026-11-24 12:00 in Mexico City

function setup(opts: Partial<Parameters<typeof createLedger>[0]> = {}) {
    let t = T0;
    const store = memoryStore();
    const ledger = createLedger({ store, ownerEmails: ['boss@example.com'], log: silent, now: () => t, ...opts });
    return { store, ledger, advance: (ms: number) => { t += ms; }, now: () => t };
}
const alice = { uid: 'alice', email: 'alice@example.com', emailVerified: true };
const boss = { uid: 'boss', email: 'boss@example.com', emailVerified: true };

describe('plans', () => {
    it('keep every paid plan profitable even if the user spends every minute', () => {
        for (const plan of PAID_PLANS) for (const interval of ['month', 'year'] as const) {
            expect(worstCaseCostShare(plan, interval)).toBeLessThan(0.8);
        }
    });

    it('computes what reaches the owner after IVA and Stripe fees', () => {
        expect(netRevenueMxn(199)).toBeCloseTo(159.76, 1);
    });

    it('prices text calls from Gemini token counts', () => {
        const usage = { promptTokenCount: 1000, candidatesTokenCount: 200, thoughtsTokenCount: 100 };
        expect(textCostUsd('gemini-3.5-flash-lite', usage)).toBeCloseTo((1000 * 0.3 + 300 * 2.5) / 1e6, 9);
        expect(textCostUsd('gemini-3.8-flash', undefined)).toBe(0);
        // A chat reply costs a small slice of a minute.
        expect(textCostUsd('gemini-3.8-flash', { promptTokenCount: 1500, candidatesTokenCount: 300 }) / MINUTE_USD).toBeLessThan(0.1);
    });

    it('formats minutes', () => {
        expect(formatMinutes(52.7)).toBe('52 min');
        expect(formatMinutes(4.56)).toBe('4.5 min');
        expect(formatMinutes(Infinity)).toBe('Unlimited');
    });
});

describe('monthly windows', () => {
    it('count whole months from the anchor, clamping short months', () => {
        const jan31 = Date.UTC(2026, 0, 31);
        expect(new Date(monthlyWindowStart(jan31, Date.UTC(2026, 1, 15))).toISOString().slice(0, 10)).toBe('2026-01-31');
        expect(new Date(monthlyWindowStart(jan31, Date.UTC(2026, 2, 1))).toISOString().slice(0, 10)).toBe('2026-02-28');
        expect(new Date(monthlyWindowStart(jan31, Date.UTC(2026, 2, 31, 1))).toISOString().slice(0, 10)).toBe('2026-03-31');
    });
});

describe('store', () => {
    it('never loses concurrent updates', async () => {
        const store = memoryStore();
        await Promise.all(Array.from({ length: 20 }, () => update<number>(store, 'n', cur => (cur ?? 0) + 1)));
        expect((await store.get<number>('n')).value).toBe(20);
    });
});

describe('ledger', () => {
    it('gives free users 5 minutes a month and charges text by real cost', async () => {
        const { ledger } = setup();
        expect((await ledger.status(alice)).minutesLeft).toBe(5);
        await ledger.chargeText(alice, MINUTE_USD); // one minute's worth
        expect((await ledger.status(alice)).minutesLeft).toBeCloseTo(4, 5);
        await ledger.chargeText(alice, MINUTE_USD * 4);
        const refusal = await ledger.checkText(alice);
        expect(refusal).toMatchObject({ ok: false, reason: 'quota', plan: 'free' });
    });

    it('refills free minutes a month later', async () => {
        const { ledger, advance } = setup();
        await ledger.chargeText(alice, MINUTE_USD * 5);
        advance(31 * DAY);
        expect((await ledger.status(alice)).minutesLeft).toBe(5);
    });

    it('reserves voice time up front, caps the token at what is left, and refunds unused time', async () => {
        const { ledger, advance } = setup();
        const grant = await ledger.reserveLive(alice, 'talk');
        expect(grant).toMatchObject({ ok: true, seconds: 300, plan: 'free' }); // all 5 free minutes
        expect((await ledger.status(alice)).minutesLeft).toBe(0);
        expect(await ledger.reserveLive(alice, 'talk')).toMatchObject({ ok: false, reason: 'quota' });

        advance(90_000);
        const settled = await ledger.settleLive(alice, (grant as any).leaseId);
        expect(settled!.chargedSeconds).toBe(90);
        expect((await ledger.status(alice)).minutesLeft).toBeCloseTo(3.5, 5);
        expect(await ledger.settleLive(alice, (grant as any).leaseId)).toBeNull(); // only once
    });

    it('charges an abandoned lease in full once it has expired', async () => {
        const { ledger, advance } = setup();
        await ledger.reserveLive(alice, 'talk');
        advance(10 * 60_000);
        expect((await ledger.status(alice)).minutesLeft).toBe(0);
    });

    it('refunds a token that was never used', async () => {
        const { ledger, advance } = setup();
        const grant: any = await ledger.reserveLive(alice, 'talk');
        advance(40_000);
        expect((await ledger.settleLive(alice, grant.leaseId, false))!.chargedSeconds).toBe(0);
        expect((await ledger.status(alice)).minutesLeft).toBe(5);
    });

    it('charges Assist listening far less than Talk', async () => {
        const { ledger } = setup();
        const grant: any = await ledger.reserveLive(alice, 'assist');
        expect(grant.seconds).toBe(1200); // 20 minutes of listening fit in the free minutes
    });

    it('limits how much voice time a client can lease per day', async () => {
        const { ledger, store } = setup();
        await ledger.applySubscription('alice', { plan: 'pro', interval: 'month', status: 'active', periodStart: T0, periodEnd: T0 + 30 * DAY });
        for (let i = 0; i < 12; i++) {
            const g: any = await ledger.reserveLive(alice, 'talk');
            expect(g.ok).toBe(true);
            await ledger.settleLive(alice, g.leaseId, false);
        }
        expect(await ledger.reserveLive(alice, 'talk')).toMatchObject({ ok: false, reason: 'daily' });
        expect(Object.keys(store.dump())).toContain('accounts/alice');
    });

    it('gives subscribers their plan from the billing date, with a grace period for late payment', async () => {
        const { ledger, advance } = setup();
        await ledger.chargeText(alice, MINUTE_USD * 5);
        await ledger.applySubscription('alice', { plan: 'plus', interval: 'month', status: 'active', periodStart: T0, periodEnd: T0 + 30 * DAY }, 'cus_1');
        const s = await ledger.status(alice);
        expect(s).toMatchObject({ plan: 'plus', minutesLeft: 80, hasCustomer: true });
        advance(31 * DAY); // renewal missed, still inside the 3-day grace
        expect((await ledger.status(alice)).plan).toBe('plus');
        advance(3 * DAY);
        expect((await ledger.status(alice)).plan).toBe('free');
    });

    it('drops to free when the subscription is canceled', async () => {
        const { ledger } = setup();
        await ledger.applySubscription('alice', { plan: 'plus', interval: 'month', status: 'canceled', periodStart: T0, periodEnd: T0 + 30 * DAY });
        expect((await ledger.status(alice)).plan).toBe('free');
    });

    it('gives verified owner emails unlimited use, but still counts their cost', async () => {
        const { ledger } = setup({ floatUsd: 0 });
        expect((await ledger.status(boss)).plan).toBe('owner');
        expect((await ledger.status({ ...boss, emailVerified: false })).plan).toBe('free');
        const grant: any = await ledger.reserveLive(boss, 'talk');
        expect(grant).toMatchObject({ ok: true, seconds: 1800 });
        expect((await ledger.report()).allTime.spendUsd.owner).toBeGreaterThan(0);
    });

    it('stops non-owner AI before spend passes the money collected', async () => {
        const { ledger } = setup({ floatUsd: 0.5, freeBudgetUsd: 100 });
        await ledger.chargeText(alice, 0.5);
        expect(await ledger.checkText({ uid: 'bob' })).toMatchObject({ ok: false, reason: 'paused' });
        expect((await ledger.checkText(boss)).ok).toBe(true);

        expect(await ledger.recordRevenue('evt_1', 199)).toBe(true);
        expect(await ledger.recordRevenue('evt_1', 199)).toBe(false); // retried webhook counted once
        expect((await ledger.checkText({ uid: 'bob' })).ok).toBe(true);
        const report = await ledger.report();
        expect(report.allTime.revenueGrossMxn).toBe(199);
        expect(report.guard.ceilingUsd).toBeCloseTo(0.5 + (netRevenueMxn(199) / 19) * 0.8, 5);
    });

    it('caps what free users together may cost per month', async () => {
        const { ledger } = setup({ freeBudgetUsd: 0.2, floatUsd: 50 });
        await ledger.chargeText(alice, 0.2);
        expect(await ledger.checkText({ uid: 'carol' })).toMatchObject({ ok: false, reason: 'paused' });
    });
});

describe('stripe', () => {
    const secret = 'whsec_test';
    const sign = (body: string, t: number) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;

    it('encodes nested params the way Stripe expects', () => {
        expect(decodeURIComponent(formEncode({ a: 1, line_items: [{ price_data: { currency: 'mxn' } }], meta: { uid: 'u' } })))
            .toBe('a=1&line_items[0][price_data][currency]=mxn&meta[uid]=u');
    });

    it('verifies webhook signatures and rejects tampering and replays', () => {
        const body = '{"id":"evt_1"}';
        const t = 1_800_000_000;
        expect(verifyStripeSignature(body, sign(body, t), secret, t + 10)).toBe(true);
        expect(verifyStripeSignature(body + ' ', sign(body, t), secret, t + 10)).toBe(false);
        expect(verifyStripeSignature(body, sign(body, t), secret, t + 3600)).toBe(false);
        expect(verifyStripeSignature(body, null, secret, t)).toBe(false);
    });

    it('reads subscriptions in both the old and new API shapes', () => {
        const sub = { id: 'sub_1', status: 'active', customer: 'cus_1', metadata: { uid: 'alice', plan: 'plus' },
            items: { data: [{ current_period_start: 100, current_period_end: 200, price: { recurring: { interval: 'year' } } }] } };
        expect(subscriptionFrom(sub)).toEqual({ uid: 'alice', customerId: 'cus_1', subscription: expect.objectContaining({ plan: 'plus', interval: 'year', periodStart: 100_000, periodEnd: 200_000 }) });
        expect(subscriptionFrom({ ...sub, current_period_start: 1, current_period_end: 2 }).subscription!.periodEnd).toBe(2000);
    });

    it('turns Stripe events into plans and revenue', async () => {
        const { ledger } = setup();
        await handleStripeEvent({ type: 'checkout.session.completed', data: { object: { client_reference_id: 'alice', customer: 'cus_9' } } }, ledger);
        await handleStripeEvent({ type: 'customer.subscription.created', data: { object: {
            id: 'sub_1', status: 'active', customer: 'cus_9', metadata: { uid: 'alice', plan: 'pro' },
            items: { data: [{ current_period_start: T0 / 1000, current_period_end: T0 / 1000 + 30 * 86400, price: { recurring: { interval: 'month' } } }] },
        } } }, ledger);
        expect((await ledger.status(alice)).plan).toBe('pro');
        expect(await ledger.customerOf('alice')).toBe('cus_9');
        await handleStripeEvent({ id: 'evt_p', type: 'invoice.paid', data: { object: { currency: 'mxn', amount_paid: 39900 } } }, ledger);
        expect((await ledger.report()).allTime.revenueGrossMxn).toBe(399);
        await handleStripeEvent({ type: 'customer.subscription.deleted', data: { object: {
            id: 'sub_1', status: 'active', customer: 'cus_9', metadata: { uid: 'alice', plan: 'pro' },
            items: { data: [{ current_period_start: T0 / 1000, current_period_end: T0 / 1000 + 30 * 86400, price: { recurring: { interval: 'month' } } }] },
        } } }, ledger);
        expect((await ledger.status(alice)).plan).toBe('free');
    });
});

const goodToken = async (token: string) => {
    if (token === 'alice') return { uid: 'alice', anonymous: false, email: 'alice@example.com', emailVerified: true };
    if (token === 'guest') return { uid: 'guest1', anonymous: true };
    if (token === 'boss') return { uid: 'boss', anonymous: false, email: 'boss@example.com', emailVerified: true };
    throw new Error('bad');
};
const post = (path: string, body: unknown, token = 'alice', extra: Record<string, string> = {}) => new Request(`https://glossos.example${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra },
    body: typeof body === 'string' ? body : JSON.stringify(body),
});

describe('/api/live-token with billing', () => {
    it('reserves time, sends a token that expires with it, and returns the lease', async () => {
        const { ledger, now } = setup();
        const upstream = vi.fn().mockResolvedValue(new Response(JSON.stringify({ name: 'auth_tokens/x' }), { status: 200 }));
        const handle = createLiveTokenHandler({ apiKey: 'k', projectId: 'p', fetchImpl: upstream, verifyToken: goodToken, log: silent, billing: ledger, now });
        const res = await handle(post('/api/live-token', { purpose: 'talk' }));
        const body = await res.json();
        expect(body).toMatchObject({ token: 'auth_tokens/x', seconds: 300 });
        expect(typeof body.leaseId).toBe('string');
        const sent = JSON.parse(upstream.mock.calls[0][1].body);
        expect(Date.parse(sent.expireTime) - now()).toBe(330_000);

        const out = await handle(post('/api/live-token', { purpose: 'talk' }));
        expect(out.status).toBe(402);
        expect((await out.json()).error.reason).toBe('quota');
    });

    it('gives the time back if Gemini fails to mint the token', async () => {
        const { ledger, now } = setup();
        const upstream = vi.fn().mockResolvedValue(new Response('{"error":{"message":"busy"}}', { status: 503 }));
        const handle = createLiveTokenHandler({ apiKey: 'k', projectId: 'p', fetchImpl: upstream, verifyToken: goodToken, log: silent, billing: ledger, now });
        expect((await handle(post('/api/live-token', {}))).status).toBe(503);
        expect((await ledger.status(alice)).minutesLeft).toBe(5);
    });
});

describe('/api/generate and /api/stream with billing', () => {
    it('charges the real token cost and refuses with 402 when minutes run out', async () => {
        const { ledger } = setup();
        const usage = { promptTokenCount: 2000, candidatesTokenCount: 500 };
        const upstream = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ candidates: [], usageMetadata: usage }), { status: 200 }));
        const handle = createGenaiHandler({ apiKey: 'k', projectId: 'p', fetchImpl: upstream, verifyToken: goodToken, log: silent, billing: ledger });
        const body = { model: 'gemini-3.8-flash', contents: [{ role: 'user', parts: [{ text: 'hi' }] }] };
        expect((await handle(post('/api/generate', body))).status).toBe(200);
        const left = (await ledger.status(alice)).minutesLeft;
        expect(5 - left).toBeCloseTo(textCostUsd('gemini-3.8-flash', usage) / MINUTE_USD, 6);

        await ledger.chargeText(alice, MINUTE_USD * 5);
        const res = await handle(post('/api/generate', body));
        expect(res.status).toBe(402);
        expect(upstream).toHaveBeenCalledTimes(1);
    });

    it('meters streams from their last usageMetadata without changing the bytes', async () => {
        const sse = 'data: {"candidates":[{"content":{"parts":[{"text":"Ho"}]}}]}\n\ndata: {"candidates":[],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":5}}\n\n';
        const charge = vi.fn().mockResolvedValue(undefined);
        const bytes = new TextEncoder().encode(sse);
        const src = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes.slice(0, 30)); c.enqueue(bytes.slice(30)); c.close(); } });
        const out = await new Response(meterStream(src, charge)).text();
        expect(out).toBe(sse);
        expect(charge).toHaveBeenCalledWith({ promptTokenCount: 10, candidatesTokenCount: 5 });
    });
});

describe('/api/billing', () => {
    const stripeOk = () => vi.fn().mockImplementation(async (url: string) => new Response(JSON.stringify(
        url.includes('billing_portal') ? { url: 'https://billing.stripe.com/p/1' } : { url: 'https://checkout.stripe.com/c/1' }), { status: 200 }));

    it('reports status and refuses checkout until payments are set up', async () => {
        const { ledger } = setup();
        const handle = createBillingHandler({ apiKey: '', projectId: 'p', verifyToken: goodToken, log: silent, ledger });
        const status = await (await handle(post('/api/billing/status', {}))).json();
        expect(status).toMatchObject({ plan: 'free', minutesLeft: 5, paymentsReady: false });
        expect((await handle(post('/api/billing/checkout', { plan: 'plus', interval: 'month' }))).status).toBe(503);
        expect((await handle(post('/api/billing/status', {}, ''))).status).toBe(401);
    });

    it('creates a Stripe checkout in MXN for signed-up users only', async () => {
        const { ledger } = setup();
        const fetchImpl = stripeOk();
        const handle = createBillingHandler({ apiKey: '', projectId: 'p', verifyToken: goodToken, log: silent, ledger, fetchImpl, stripeSecretKey: 'sk_test_1', stripeWebhookSecret: 'whsec_test' });
        const res = await handle(post('/api/billing/checkout', { plan: 'plus', interval: 'year' }));
        expect(await res.json()).toEqual({ url: 'https://checkout.stripe.com/c/1' });
        const form = decodeURIComponent(fetchImpl.mock.calls[0][1].body);
        expect(form).toContain('line_items[0][price_data][currency]=mxn');
        expect(form).toContain('line_items[0][price_data][unit_amount]=199000');
        expect(form).toContain('line_items[0][price_data][recurring][interval]=year');
        expect(form).toContain('subscription_data[metadata][uid]=alice');
        expect(form).toContain('success_url=https://glossos.example/?checkout=success');
        expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer sk_test_1');

        expect((await handle(post('/api/billing/checkout', { plan: 'plus', interval: 'month' }, 'guest'))).status).toBe(403);
        expect((await handle(post('/api/billing/checkout', { plan: 'gold', interval: 'month' }))).status).toBe(400);
        expect((await handle(post('/api/billing/portal', {}))).status).toBe(404);
    });

    it('accepts only signed webhooks and applies them', async () => {
        const { ledger } = setup();
        const handle = createBillingHandler({ apiKey: '', projectId: 'p', verifyToken: goodToken, log: silent, ledger, fetchImpl: stripeOk(), stripeSecretKey: 'sk', stripeWebhookSecret: 'whsec_test', now: () => T0 });
        const event = JSON.stringify({ id: 'evt_9', type: 'invoice.paid', data: { object: { currency: 'mxn', amount_paid: 19900 } } });
        const t = Math.floor(T0 / 1000);
        const sig = `t=${t},v1=${createHmac('sha256', 'whsec_test').update(`${t}.${event}`).digest('hex')}`;
        expect((await handle(post('/api/billing/webhook', event, '', { 'Stripe-Signature': 'nope' }))).status).toBe(400);
        expect((await handle(post('/api/billing/webhook', event, '', { 'Stripe-Signature': sig }))).status).toBe(200);
        expect((await ledger.report()).allTime.revenueGrossMxn).toBe(199);
    });

    it('ends leases and shows the report only to the owner', async () => {
        const { ledger, advance } = setup();
        const handle = createBillingHandler({ apiKey: '', projectId: 'p', verifyToken: goodToken, log: silent, ledger });
        const grant: any = await ledger.reserveLive(alice, 'talk');
        advance(60_000);
        expect(await (await handle(post('/api/billing/end', { leaseId: grant.leaseId }))).json()).toEqual({ settled: true, chargedSeconds: 60 });
        expect((await handle(post('/api/billing/report', {}))).status).toBe(403);
        expect((await handle(post('/api/billing/report', {}, 'boss'))).status).toBe(200);
    });
});
