/**
 * Glossos plans and the cost model behind them. Shared by the app (to show plans) and the
 * Netlify Functions (to enforce them), so it must stay free of secrets.
 *
 * Everything is measured in "AI minutes": one minute of the live voice tutor. Other features are
 * charged by what they really cost Google, converted to minutes (a Chat or Lens reply uses about
 * 0.05 min). Because every plan's minutes are priced so that even a user who spends all of them
 * costs well under what they paid (see worstCaseCostShare), the app cannot spend more on Gemini
 * than it collects.
 */

export type PlanId = 'free' | 'plus' | 'pro' | 'owner';
export type PaidPlanId = 'plus' | 'pro';
export type BillingInterval = 'month' | 'year';
export type LivePurpose = 'talk' | 'assist' | 'voice';
/** How a payment was made: card (subscriptions and pay-once) or cash at OXXO (pay-once only). */
export type PaymentMethod = 'card' | 'oxxo';

/** Plan order, for "is this plan at least as good as that one". */
export const PLAN_RANK: Record<PlanId, number> = { free: 0, plus: 1, pro: 2, owner: 3 };

export interface Plan {
    id: PlanId;
    name: string;
    /** AI minutes per monthly period. */
    minutes: number;
    /** Price in MXN, IVA included, per interval (paid plans only). */
    price?: Record<BillingInterval, number>;
    tagline: string;
    features: string[];
    /** Most voice time a client may lease per day (caps the damage of a tampered client). */
    dailyLeaseMinutes: number;
}

/** Measured on 2026-11-24 with real sessions, at Gemini paid-tier prices, with a safety margin. */
export const COST_USD = {
    /** One minute of Talk (gemini-3.8-live, context compression on, plus the per-turn review). */
    talkPerMinute: 0.07,
    /** One minute of Conversation Assist listening (the help calls are metered as text). */
    assistPerMinute: 0.012,
    /** One minute of the natural reading voice (Lens, Chat read-aloud). */
    voicePerMinute: 0.01,
} as const;

/** Value of one AI minute in USD. */
export const MINUTE_USD = COST_USD.talkPerMinute;

/** Conservative exchange rate used for the economics (override with USD_MXN on the server). */
export const DEFAULT_USD_MXN = 19;

/** Gemini paid-tier prices, USD per 1M tokens (aistudio.google.com/docs/pricing, 2026-11-24). */
export const TEXT_PRICES: Record<string, { input: number; audioInput?: number; output: number }> = {
    // 3.8-flash and 3.5-flash (routed to 3.6-flash) double on 2027-01-01; the higher price is used.
    'gemini-3.8-flash': { input: 1.5, output: 7.5 },
    'gemini-3.5-flash': { input: 1.5, output: 9 },
    'gemini-3.5-flash-lite': { input: 0.3, output: 2.5 },
    'gemini-2.5-flash': { input: 0.3, audioInput: 1, output: 2.5 },
    'gemini-3.5-transcribe': { input: 1, output: 4 },
};
const UNKNOWN_MODEL_PRICE = { input: 1.5, output: 9 };

export const PLANS: Record<PlanId, Plan> = {
    free: {
        id: 'free',
        name: 'Free',
        minutes: 5,
        tagline: 'Try everything',
        features: ['5 AI minutes every month', 'Offline chat on your device, unlimited', 'Lens, Chat, Write and Scribe'],
        dailyLeaseMinutes: 15,
    },
    plus: {
        id: 'plus',
        name: 'Plus',
        minutes: 80,
        price: { month: 199, year: 1990 },
        tagline: 'Practice a little every day',
        features: ['80 AI minutes every month', 'Talk and Conversation Assist', 'Lens, Chat, Write and Scribe', 'Offline chat, unlimited'],
        dailyLeaseMinutes: 60,
    },
    pro: {
        id: 'pro',
        name: 'Pro',
        minutes: 160,
        price: { month: 399, year: 3990 },
        tagline: 'For travel, work and fast progress',
        features: ['160 AI minutes every month', 'Everything in Plus', 'Best for daily conversation practice'],
        dailyLeaseMinutes: 120,
    },
    owner: {
        id: 'owner',
        name: 'Owner',
        minutes: Number.POSITIVE_INFINITY,
        tagline: 'Unlimited, for the Glossos team',
        features: ['Unlimited'],
        dailyLeaseMinutes: Number.POSITIVE_INFINITY,
    },
};

export const PAID_PLANS: PaidPlanId[] = ['plus', 'pro'];

export const isPaidPlan = (v: unknown): v is PaidPlanId => v === 'plus' || v === 'pro';
export const isInterval = (v: unknown): v is BillingInterval => v === 'month' || v === 'year';

/** USD cost of one Gemini text call from its usageMetadata. */
export function textCostUsd(model: string, usage: any): number {
    if (!usage) return 0;
    const price: { input: number; audioInput?: number; output: number } = TEXT_PRICES[model] ?? UNKNOWN_MODEL_PRICE;
    const details: { modality?: string; tokenCount?: number }[] = usage.promptTokensDetails ?? [];
    const audioIn = details.filter(d => d.modality === 'AUDIO').reduce((s, d) => s + (d.tokenCount || 0), 0);
    const promptTokens = Number(usage.promptTokenCount) || 0;
    const otherIn = Math.max(0, promptTokens - audioIn);
    const out = (Number(usage.candidatesTokenCount) || 0) + (Number(usage.thoughtsTokenCount) || 0);
    return (otherIn * price.input + audioIn * (price.audioInput ?? price.input) + out * price.output) / 1e6;
}

/** USD cost per second of a Live session for a purpose. */
export function liveCostPerSecond(purpose: LivePurpose): number {
    const perMinute = purpose === 'talk' ? COST_USD.talkPerMinute : purpose === 'assist' ? COST_USD.assistPerMinute : COST_USD.voicePerMinute;
    return perMinute / 60;
}

/** Stripe Mexico fees before IVA (stripe.com/mx/pricing, 2026-11-24): domestic cards and OXXO vouchers. */
export const STRIPE_FEES: Record<PaymentMethod, { share: number; fixedMxn: number }> = {
    card: { share: 0.036, fixedMxn: 3 },
    oxxo: { share: 0.04, fixedMxn: 3 },
};

/** What actually reaches the owner from one payment: IVA (16%) and Stripe's fee (plus IVA on the fee) removed. */
export function netRevenueMxn(grossMxn: number, method: PaymentMethod = 'card'): number {
    const fee = STRIPE_FEES[method];
    const iva = grossMxn - grossMxn / 1.16;
    const stripeFee = (grossMxn * fee.share + fee.fixedMxn) * 1.16;
    return grossMxn - iva - stripeFee;
}

/**
 * Share of a plan's net revenue that Gemini would cost if the user spent every minute.
 * Kept under 0.8 for every plan by a test, so even the heaviest users are profitable. The default
 * is OXXO, the dearer way to pay.
 */
export function worstCaseCostShare(plan: PaidPlanId, interval: BillingInterval, usdMxn = DEFAULT_USD_MXN, method: PaymentMethod = 'oxxo'): number {
    const p = PLANS[plan];
    const months = interval === 'year' ? 12 : 1;
    const costMxn = p.minutes * MINUTE_USD * months * usdMxn;
    return costMxn / netRevenueMxn(p.price![interval], method);
}

/** Formats minutes for display ("52 min", "4.5 min", "Unlimited"). */
export function formatMinutes(min: number): string {
    if (!Number.isFinite(min)) return 'Unlimited';
    if (min <= 0) return '0 min';
    return min < 10 ? `${(Math.floor(min * 10) / 10).toString()} min` : `${Math.floor(min)} min`;
}

/** Monthly price shown on the plan card ("$199" / "$166 per month, billed yearly"). */
export function monthlyEquivalent(plan: PaidPlanId, interval: BillingInterval): number {
    const price = PLANS[plan].price![interval];
    return interval === 'year' ? Math.round(price / 12) : price;
}
