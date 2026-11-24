import React, { useEffect, useState } from 'react';
import { Badge, Button, Segmented, Sheet, Spinner, cx } from '../ui/primitives';
import { Icon } from '../ui/Icon';
import {
    PLANS, PAID_PLANS, PLAN_RANK, formatMinutes, monthlyEquivalent, type BillingInterval, type PaidPlanId,
} from '../../services/billing/plans';
import {
    openBillingPortal, refreshBillingStatus, startCheckout, type BillingStatus, type PaywallRequest,
} from '../../services/billing';
import { authHeaders } from '../../services/genaiClient';

const mxn = (n: number) => `$${n.toLocaleString('es-MX', { maximumFractionDigits: 0 })}`;
const date = (t: number) => new Date(t).toLocaleDateString('en-US', { day: 'numeric', month: 'long' });

const REASON_TITLE: Record<PaywallRequest['reason'], string> = {
    quota: 'You are out of AI minutes',
    daily: 'That is today\'s voice limit',
    paused: 'Glossos is busy right now',
    full: 'Free practice is full this month',
    upgrade: 'Get more practice',
};

/** Minutes left, as a bar. */
export const MinutesMeter: React.FC<{ status: BillingStatus }> = ({ status }) => {
    const unlimited = !Number.isFinite(status.minutesTotal);
    const share = unlimited ? 1 : Math.max(0, Math.min(1, status.minutesLeft / Math.max(1, status.minutesTotal)));
    const low = !unlimited && status.minutesLeft < Math.min(5, status.minutesTotal * 0.15);
    return (
        <div>
            <div className="flex items-baseline justify-between gap-3">
                <span className="font-display text-2xl font-bold text-white" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {unlimited ? 'Unlimited' : formatMinutes(status.minutesLeft)}
                </span>
                <span className="text-xs text-slate-400">
                    {unlimited ? 'Owner account' : `of ${status.minutesTotal} · refills ${date(status.renewsAt)}`}
                </span>
            </div>
            <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-white/[0.06]">
                <div
                    className={cx('h-full rounded-full transition-[width] duration-700', low ? 'bg-rose-400' : 'bg-gradient-to-r from-gold-500 to-gold-300')}
                    style={{ width: `${Math.max(share * 100, share > 0 ? 3 : 0)}%` }}
                />
            </div>
        </div>
    );
};

interface Report {
    month: string;
    usdMxn: number;
    thisMonth: { revenueGrossMxn: number; revenueNetMxn: number; totalUsd: number; freeUsd: number; paidUsd: number; ownerUsd: number; voiceLeasedUsd?: number };
    allTime: { revenueNetMxn: number; totalSpendUsd: number; estimatedProfitMxn: number };
    guard: { ceilingUsd: number };
}

/** Money in vs. estimated Gemini cost, for the owner. */
const OwnerReport: React.FC = () => {
    const [report, setReport] = useState<Report | null>(null);
    const [error, setError] = useState('');
    useEffect(() => {
        (async () => {
            try {
                const res = await fetch('/api/billing/report', { method: 'POST', headers: await authHeaders(), body: '{}' });
                if (!res.ok) throw new Error(`(${res.status})`);
                setReport(await res.json());
            } catch (e) {
                setError(`Could not load the numbers ${(e as Error).message}`);
            }
        })();
    }, []);
    if (error) return <p className="text-sm text-slate-400">{error}</p>;
    if (!report) return <Spinner />;
    const m = report.thisMonth;
    const row = (label: string, value: string, tone = 'text-white') => (
        <div className="flex items-center justify-between py-1.5 text-sm">
            <span className="text-slate-400">{label}</span>
            <span className={cx('font-semibold', tone)} style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</span>
        </div>
    );
    return (
        <div className="divide-y divide-white/[0.06]">
            {row('Paid by users this month', `${mxn(m.revenueGrossMxn)} MXN`)}
            {row('Yours after IVA and Stripe', `${mxn(m.revenueNetMxn)} MXN`, 'text-mint-300')}
            {row('Gemini cost this month (estimate)', `$${m.totalUsd.toFixed(2)} USD`)}
            {row('  of it free users / you', `$${m.freeUsd.toFixed(2)} / $${m.ownerUsd.toFixed(2)}`, 'text-slate-300')}
            {row('Profit so far, all time (estimate)', `${mxn(report.allTime.estimatedProfitMxn)} MXN`, report.allTime.estimatedProfitMxn >= 0 ? 'text-mint-300' : 'text-rose-300')}
            {row('Gemini spend allowed so far', `$${report.guard.ceilingUsd.toFixed(2)} USD`, 'text-slate-300')}
            {/* Far above the Gemini cost would mean someone is ending voice sessions early on purpose. */}
            {row('Voice time handed out (if all used)', `$${(m.voiceLeasedUsd ?? 0).toFixed(2)} USD`, 'text-slate-300')}
        </div>
    );
};

export const PlansSheet: React.FC<{
    open: boolean;
    onClose: () => void;
    status: BillingStatus | null;
    reason?: PaywallRequest | null;
}> = ({ open, onClose, status, reason }) => {
    const [interval, setBillingInterval] = useState<BillingInterval>('month');
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState('');

    useEffect(() => { if (open) { setError(''); void refreshBillingStatus(); } }, [open]);

    const ready = !!status?.paymentsReady;
    const sub = status?.subscription ?? null;
    const pass = status?.pass ?? null;
    const upcoming = status?.upcoming ?? null;
    /** A subscription that charges the card again by itself: changes go through the Stripe portal. */
    const renewing = (!!sub && !sub.cancelAtPeriodEnd) || !!upcoming;
    const current: PaidPlanId | null = status && (status.plan === 'plus' || status.plan === 'pro') ? status.plan : null;
    /** When what the user already paid for runs out (canceled subscription or pass). */
    const paidUntil = current && !renewing ? Math.max(sub?.periodEnd ?? 0, pass?.periodEnd ?? 0) : 0;
    const blocked = !ready || !!status?.guest || !!busy || !!status?.owner;
    const length = interval === 'year' ? '1 year' : '1 month';

    const run = async (key: string, action: () => Promise<void>) => {
        setError('');
        setBusy(key);
        try {
            await action();
        } catch (e) {
            setError((e as Error).message);
            setBusy(null);
        }
    };
    const manage = () => run('portal', openBillingPortal);

    return (
        <Sheet
            open={open}
            onClose={onClose}
            title={reason ? REASON_TITLE[reason.reason] : 'Plans'}
            subtitle="1 AI minute = 1 minute talking with your tutor"
            footer={
                <p className="text-center text-[11px] leading-relaxed text-slate-500">
                    Prices in MXN, IVA included. Subscriptions renew until you cancel; paying once (card or OXXO) does not renew. Payments by Stripe: Glossos never sees your card.
                </p>
            }
        >
            <div className="space-y-5">
                {reason?.message && (
                    <div className="rounded-2xl border border-gold-400/25 bg-gold-500/[0.08] p-4 text-sm text-gold-100">
                        {reason.message}
                    </div>
                )}

                {status && (
                    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
                        <div className="mb-3 flex items-center justify-between">
                            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Your minutes</span>
                            <Badge tone={status.plan === 'free' ? 'slate' : 'gold'}>{PLANS[status.plan].name}</Badge>
                        </div>
                        <MinutesMeter status={status} />
                        {sub?.cancelAtPeriodEnd && !pass && (
                            <p className="mt-3 text-xs text-slate-400">Your plan ends on {date(sub.periodEnd)}.</p>
                        )}
                        {pass && !sub && (
                            <p className="mt-3 text-xs text-slate-400">Paid until {date(pass.periodEnd)}. It does not renew by itself.</p>
                        )}
                        {upcoming && (
                            <p className="mt-3 text-xs text-slate-400">Your {PLANS[upcoming.plan].name} subscription starts on {date(upcoming.startsAt)}, when your current plan ends.</p>
                        )}
                    </div>
                )}

                {status?.owner && (
                    <div className="rounded-2xl border border-mint-400/20 bg-mint-400/[0.05] p-4">
                        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-mint-300">Business</p>
                        <OwnerReport />
                    </div>
                )}

                <div className="flex items-center justify-between gap-3">
                    <Segmented<BillingInterval>
                        id="billing-interval"
                        value={interval}
                        onChange={setBillingInterval}
                        options={[{ value: 'month', label: 'Monthly' }, { value: 'year', label: 'Yearly' }]}
                    />
                    {interval === 'year' && <Badge tone="mint">2 months free</Badge>}
                </div>

                <div className="space-y-3">
                    {PAID_PLANS.map(id => {
                        const plan = PLANS[id];
                        const isCurrent = current === id || upcoming?.plan === id;
                        const featured = id === 'plus';
                        // Subscribing to a plan no better than the one already paid for starts charging when that ends.
                        const startsLater = !!paidUntil && current !== null && PLAN_RANK[current] >= PLAN_RANK[id] && paidUntil - Date.now() > 49 * 3600 * 1000;
                        return (
                            <div
                                key={id}
                                className={cx(
                                    'relative rounded-2xl border p-4',
                                    featured ? 'border-gold-400/35 bg-gradient-to-b from-gold-500/[0.09] to-transparent' : 'border-white/[0.08] bg-white/[0.025]',
                                )}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <h3 className="font-display text-lg font-bold text-white">{plan.name}</h3>
                                            {featured && !isCurrent && <Badge tone="gold">Most popular</Badge>}
                                            {isCurrent && <Badge tone="mint">Your plan</Badge>}
                                        </div>
                                        <p className="mt-0.5 text-xs text-slate-400">{plan.tagline}</p>
                                    </div>
                                    <div className="shrink-0 text-right">
                                        <div className="font-display text-xl font-bold text-white" style={{ fontVariantNumeric: 'tabular-nums' }}>
                                            {mxn(monthlyEquivalent(id, interval))}
                                            <span className="text-xs font-medium text-slate-400"> /mo</span>
                                        </div>
                                        <div className="text-[11px] text-slate-500">
                                            {interval === 'year' ? `${mxn(plan.price!.year)} MXN a year` : 'MXN, billed monthly'}
                                        </div>
                                    </div>
                                </div>
                                <ul className="mt-3 space-y-1.5">
                                    {plan.features.map(f => (
                                        <li key={f} className="flex items-start gap-2 text-sm text-slate-300">
                                            <Icon name="check" size={15} className="mt-0.5 shrink-0 text-gold-400" />
                                            <span>{f}</span>
                                        </li>
                                    ))}
                                </ul>
                                <div className="mt-4 space-y-2">
                                    {renewing ? (
                                        isCurrent ? (
                                            <Button variant="secondary" className="w-full" loading={busy === 'portal'} disabled={!!busy} onClick={manage}>Manage subscription</Button>
                                        ) : (
                                            <p className="rounded-xl bg-white/[0.04] p-3 text-xs leading-relaxed text-slate-400">
                                                To switch to {plan.name}, cancel your current plan in Manage subscription. It keeps working until its end date, and then you can choose {plan.name} here.
                                            </p>
                                        )
                                    ) : (
                                        <>
                                            <Button
                                                variant={featured ? 'primary' : 'secondary'}
                                                className="w-full"
                                                disabled={blocked}
                                                loading={busy === id}
                                                onClick={() => run(id, () => startCheckout(id, interval))}
                                            >
                                                {!ready ? 'Opening soon' : isCurrent ? 'Renew automatically by card' : `Choose ${plan.name}`}
                                            </Button>
                                            {ready && startsLater && (
                                                <p className="text-center text-[11px] text-slate-500">Your card is first charged on {date(paidUntil)}, when your current plan ends.</p>
                                            )}
                                            {ready && (
                                                <button
                                                    type="button"
                                                    disabled={blocked}
                                                    onClick={() => run(`${id}-once`, () => startCheckout(id, interval, true))}
                                                    className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-semibold text-gold-300 transition-colors hover:bg-white/[0.04] hover:text-gold-200 disabled:opacity-40"
                                                >
                                                    {busy === `${id}-once` ? <Spinner /> : <Icon name="sparkles" size={14} />}
                                                    {isCurrent ? `Add ${length} · card or OXXO` : `Pay once for ${length} · card or OXXO cash`}
                                                </button>
                                            )}
                                            {ready && pass && !isCurrent && (
                                                <p className="text-center text-[11px] text-slate-500">Paying once for {plan.name} starts today and replaces your {PLANS[pass.plan].name} time.</p>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {status?.guest && (
                    <p className="rounded-xl bg-white/[0.04] p-3 text-xs text-slate-300">
                        You are using Glossos as a guest. Sign out and create a free account with Google or email to choose a plan, so it stays with you on every device.
                    </p>
                )}
                {error && <p className="text-sm text-rose-300">{error}</p>}

                <div className="rounded-2xl border border-white/[0.06] p-4 text-xs leading-relaxed text-slate-400">
                    <p className="mb-1.5 font-semibold text-slate-300">How minutes work</p>
                    <p>Talk uses 1 minute per minute. Conversation Assist uses about half. Lens, Chat, Write and Scribe use a little: around 15 replies per minute. Offline chat runs on your phone and is always free.</p>
                    {status && status.plan === 'free' && <p className="mt-1.5">The free plan includes {PLANS.free.minutes} minutes every month.</p>}
                    <p className="mt-1.5">Paying at OXXO: Stripe gives you a voucher to pay in cash at any OXXO store within 3 days. Your plan starts once OXXO confirms the payment, usually within a day.</p>
                </div>
            </div>
        </Sheet>
    );
};

/** Header chip with the minutes left; opens the plans sheet. */
export const MinutesChip: React.FC<{ status: BillingStatus | null; onClick: () => void; compact?: boolean }> = ({ status, onClick, compact }) => {
    if (!status) return null;
    const unlimited = !Number.isFinite(status.minutesLeft);
    const out = !unlimited && status.minutesLeft < 0.5;
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={unlimited ? 'Plans' : `${formatMinutes(status.minutesLeft)} of AI time left. See plans`}
            className={cx(
                'flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/70',
                out ? 'border-rose-400/40 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20'
                    : 'border-white/[0.08] bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]',
            )}
            style={{ fontVariantNumeric: 'tabular-nums' }}
        >
            <Icon name="bolt" size={14} className={out ? 'text-rose-300' : 'text-gold-400'} />
            {unlimited ? (compact ? '∞' : 'Unlimited') : out ? (compact ? 'Upgrade' : '0 min · Upgrade') : formatMinutes(status.minutesLeft)}
        </button>
    );
};
