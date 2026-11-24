import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion, type HTMLMotionProps } from 'motion/react';
import { Icon, type IconName } from './Icon';

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

// ─── Button ───────────────────────────────────────────────────────────────

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'mint';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
    primary: 'bg-gradient-to-b from-gold-400 to-gold-500 text-ink-950 shadow-[0_8px_30px_-10px_rgba(255,191,0,0.6)] hover:from-gold-300 hover:to-gold-400',
    secondary: 'bg-white/[0.06] text-white border border-white/[0.1] hover:bg-white/[0.1] hover:border-white/[0.16]',
    ghost: 'text-slate-300 hover:text-white hover:bg-white/[0.06]',
    danger: 'bg-rose-500/15 text-rose-200 border border-rose-400/30 hover:bg-rose-500/25',
    mint: 'bg-mint-400/15 text-mint-300 border border-mint-400/30 hover:bg-mint-400/25',
};

const SIZES: Record<Size, string> = {
    sm: 'h-8 px-3 text-xs gap-1.5 rounded-lg',
    md: 'h-10 px-4 text-sm gap-2 rounded-xl',
    lg: 'h-12 px-6 text-[15px] gap-2.5 rounded-2xl',
};

export interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
    variant?: Variant;
    size?: Size;
    icon?: IconName;
    iconRight?: IconName;
    loading?: boolean;
    children?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ variant = 'secondary', size = 'md', icon, iconRight, loading, className, children, disabled, ...rest }, ref) => (
        <motion.button
            ref={ref}
            whileTap={disabled || loading ? undefined : { scale: 0.97 }}
            disabled={disabled || loading}
            className={cx(
                'relative inline-flex items-center justify-center font-semibold transition-colors duration-200 select-none',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950',
                'disabled:opacity-40 disabled:cursor-not-allowed',
                VARIANTS[variant], SIZES[size], className,
            )}
            {...rest}
        >
            {loading ? <Spinner size={size === 'lg' ? 18 : 14} /> : icon && <Icon name={icon} size={size === 'sm' ? 14 : 18} />}
            {children}
            {iconRight && !loading && <Icon name={iconRight} size={size === 'sm' ? 14 : 16} />}
        </motion.button>
    ),
);
Button.displayName = 'Button';

export const IconButton: React.FC<Omit<ButtonProps, 'children' | 'icon'> & { icon: IconName; label: string; active?: boolean }> = ({
    icon, label, active, className, size = 'md', variant = 'ghost', ...rest
}) => (
    <Button
        variant={variant}
        size={size}
        aria-label={label}
        title={label}
        className={cx(size === 'sm' ? 'w-8 !px-0' : size === 'lg' ? 'w-12 !px-0' : 'w-10 !px-0', active && 'text-gold-400 bg-gold-500/10', className)}
        {...rest}
    >
        <Icon name={icon} size={size === 'sm' ? 15 : 19} />
    </Button>
);

export const Spinner: React.FC<{ size?: number; className?: string }> = ({ size = 16, className }) => (
    <span
        className={cx('inline-block rounded-full border-2 border-current border-t-transparent animate-spin opacity-80', className)}
        style={{ width: size, height: size }}
        aria-hidden="true"
    />
);

// ─── Surfaces ─────────────────────────────────────────────────────────────

/** Glass card: the one card style used across pages. */
export const Card: React.FC<React.HTMLAttributes<HTMLDivElement> & { glow?: boolean }> = ({ className, glow, ...rest }) => (
    <div
        className={cx(
            'rounded-[var(--radius-card)] border border-white/[0.07] bg-gradient-to-b from-white/[0.045] to-white/[0.015] shadow-[var(--shadow-card)] backdrop-blur-xl',
            glow && 'ring-1 ring-gold-500/20',
            className,
        )}
        {...rest}
    />
);

export const Eyebrow: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
    <span className={cx('text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500', className)}>{children}</span>
);

export const Badge: React.FC<{ children: React.ReactNode; tone?: 'gold' | 'mint' | 'slate' | 'rose'; className?: string }> = ({ children, tone = 'slate', className }) => {
    const tones = {
        gold: 'bg-gold-500/12 text-gold-300 border-gold-500/25',
        mint: 'bg-mint-400/12 text-mint-300 border-mint-400/25',
        slate: 'bg-white/[0.05] text-slate-300 border-white/[0.08]',
        rose: 'bg-rose-500/12 text-rose-200 border-rose-400/25',
    };
    return <span className={cx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold', tones[tone], className)}>{children}</span>;
};

/** Consistent heading block for the top of a page section. */
export const SectionTitle: React.FC<{ title: string; subtitle?: string; right?: React.ReactNode; className?: string }> = ({ title, subtitle, right, className }) => (
    <div className={cx('flex items-end justify-between gap-4', className)}>
        <div>
            <h2 className="font-display text-xl font-bold tracking-tight text-white">{title}</h2>
            {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
        </div>
        {right}
    </div>
);

// ─── Sheet (side panel on desktop, bottom sheet on phones) ─────────────────

interface SheetProps {
    open: boolean;
    onClose: () => void;
    title: string;
    subtitle?: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
}

export function useMediaQuery(query: string): boolean {
    const get = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
    const [matches, setMatches] = useState(get);
    useEffect(() => {
        if (typeof window.matchMedia !== 'function') return;
        const mq = window.matchMedia(query);
        const onChange = () => setMatches(mq.matches);
        onChange();
        mq.addEventListener?.('change', onChange);
        return () => mq.removeEventListener?.('change', onChange);
    }, [query]);
    return matches;
}

export const Sheet: React.FC<SheetProps> = ({ open, onClose, title, subtitle, children, footer }) => {
    const desktop = useMediaQuery('(min-width: 640px)');
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    return (
        <AnimatePresence>
            {open && (
                <motion.div className="fixed inset-0 z-50 flex justify-end items-end sm:items-stretch" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    <motion.button
                        aria-label="Close"
                        className="absolute inset-0 bg-black/60 backdrop-blur-sm cursor-default"
                        onClick={onClose}
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    />
                    <motion.aside
                        role="dialog"
                        aria-modal="true"
                        aria-label={title}
                        className="relative z-10 flex w-full max-h-[90dvh] sm:max-h-none sm:h-full sm:w-[440px] flex-col rounded-t-3xl sm:rounded-none sm:rounded-l-3xl border-t sm:border-t-0 sm:border-l border-white/[0.08] bg-ink-900/95 backdrop-blur-2xl shadow-2xl"
                        initial={desktop ? { x: '100%', y: 0 } : { y: '100%', x: 0 }}
                        animate={{ y: 0, x: 0 }}
                        exit={desktop ? { x: '100%' } : { y: '100%' }}
                        transition={{ type: 'spring', stiffness: 380, damping: 38 }}
                        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
                    >
                        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-white/15 sm:hidden" />
                        <header className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-white/[0.06]">
                            <div>
                                <h2 className="font-display text-lg font-bold text-white">{title}</h2>
                                {subtitle && <p className="mt-0.5 text-sm text-slate-400">{subtitle}</p>}
                            </div>
                            <IconButton icon="x" label="Close" size="sm" onClick={onClose} />
                        </header>
                        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
                        {footer && <footer className="border-t border-white/[0.06] px-6 py-4">{footer}</footer>}
                    </motion.aside>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

// ─── Switch ────────────────────────────────────────────────────────────────

export const Switch: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }> = ({ checked, onChange, label, disabled }) => (
    <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
            'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-200',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/70 disabled:opacity-40 disabled:cursor-not-allowed',
            checked ? 'bg-gold-500 border-gold-400' : 'bg-white/[0.08] border-white/[0.1]',
        )}
    >
        <motion.span
            layout
            transition={{ type: 'spring', stiffness: 600, damping: 35 }}
            className={cx('block h-4.5 w-4.5 rounded-full shadow-md', checked ? 'bg-ink-950 ml-[22px]' : 'bg-slate-300 ml-[3px]')}
            style={{ width: 18, height: 18 }}
        />
    </button>
);

/** Selectable option tile used for languages, levels and voices. */
export const OptionTile: React.FC<{
    selected: boolean; onSelect: () => void; disabled?: boolean; title: React.ReactNode; description?: React.ReactNode; leading?: React.ReactNode; className?: string;
}> = ({ selected, onSelect, disabled, title, description, leading, className }) => (
    <button
        type="button"
        role="radio"
        aria-checked={selected}
        disabled={disabled}
        onClick={onSelect}
        className={cx(
            'group relative flex w-full items-center gap-3 rounded-2xl border px-3.5 py-3 text-left transition-all duration-200',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/70 disabled:opacity-40 disabled:cursor-not-allowed',
            selected
                ? 'border-gold-500/50 bg-gold-500/[0.08] shadow-[inset_0_0_0_1px_rgba(255,191,0,0.15)]'
                : 'border-white/[0.07] bg-white/[0.025] hover:border-white/[0.14] hover:bg-white/[0.05]',
            className,
        )}
    >
        {leading && <span className="shrink-0 text-xl leading-none">{leading}</span>}
        <span className="min-w-0 flex-1">
            <span className={cx('block text-sm font-semibold leading-tight [overflow-wrap:anywhere]', selected ? 'text-gold-200' : 'text-white')}>{title}</span>
            {description && <span className="mt-0.5 block text-xs leading-snug text-slate-400">{description}</span>}
        </span>
        <span className={cx('flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors', selected ? 'border-gold-400 bg-gold-400 text-ink-950' : 'border-white/15')}>
            {selected && <Icon name="check" size={12} strokeWidth={3} />}
        </span>
    </button>
);

/** Small language code badge (used instead of flag emojis, which Windows does not draw). */
export const LangBadge: React.FC<{ code: string; tone?: 'gold' | 'mint' | 'slate'; size?: 'sm' | 'md' }> = ({ code, tone = 'slate', size = 'md' }) => (
    <span
        className={cx(
            'inline-flex shrink-0 items-center justify-center rounded-lg border font-mono font-semibold tracking-wide',
            size === 'sm' ? 'h-5 min-w-[1.6rem] px-1 text-[9px]' : 'h-7 min-w-[2.1rem] px-1.5 text-[10.5px]',
            tone === 'gold' && 'border-gold-500/35 bg-gold-500/10 text-gold-300',
            tone === 'mint' && 'border-mint-400/30 bg-mint-400/10 text-mint-300',
            tone === 'slate' && 'border-white/[0.1] bg-white/[0.04] text-slate-300',
        )}
    >
        {code}
    </span>
);

/** Two or three way segmented control with an animated thumb. */
export function Segmented<T extends string>({ value, onChange, options, id }: {
    value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode }[]; id: string;
}) {
    return (
        <div role="tablist" className="relative flex rounded-xl border border-white/[0.07] bg-white/[0.03] p-1">
            {options.map(o => (
                <button
                    key={o.value}
                    type="button"
                    role="tab"
                    aria-selected={value === o.value}
                    onClick={() => onChange(o.value)}
                    className={cx('relative flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition-colors', value === o.value ? 'text-white' : 'text-slate-400 hover:text-slate-200')}
                >
                    {value === o.value && (
                        <motion.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-lg bg-white/[0.08] ring-1 ring-white/[0.08]" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />
                    )}
                    <span className="relative">{o.label}</span>
                </button>
            ))}
        </div>
    );
}

// ─── Empty state with illustration ────────────────────────────────────────

export const EmptyState: React.FC<{ image?: string; title: string; body: string; children?: React.ReactNode }> = ({ image, title, body, children }) => (
    <motion.div
        className="mx-auto flex max-w-md flex-col items-center text-center"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
        {image && (
            <div className="relative mb-6">
                <div className="absolute inset-6 rounded-full bg-gold-500/20 blur-3xl" />
                <img src={image} alt="" className="relative h-44 w-44 rounded-[2rem] object-cover ring-1 ring-white/10 shadow-2xl" />
            </div>
        )}
        <h3 className="font-display text-2xl font-bold tracking-tight text-white">{title}</h3>
        <p className="mt-2 text-[15px] leading-relaxed text-slate-400">{body}</p>
        {children && <div className="mt-6 flex flex-wrap items-center justify-center gap-2">{children}</div>}
    </motion.div>
);

export { cx };
