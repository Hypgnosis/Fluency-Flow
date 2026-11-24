import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Button } from '../ui/primitives';
import { Icon } from '../ui/Icon';
import { confirmAdult } from '../../services/billing';

/**
 * Asks once per account whether the user is 18 or older. Google's Gemini API terms do not allow
 * users under 18, so the AI features stay off until this is confirmed (the server enforces it).
 */
export const AgeGate: React.FC<{ open: boolean; onDone: () => void; onSignOut: () => void }> = ({ open, onDone, onSignOut }) => {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [under, setUnder] = useState(false);

    const confirm = async () => {
        setBusy(true);
        setError('');
        try {
            await confirmAdult();
            onDone();
        } catch (e) {
            setError((e as Error).message || 'Could not save that. Please try again.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                >
                    <motion.div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="age-title"
                        className="relative w-full max-w-[400px] overflow-hidden rounded-[28px] border border-white/[0.08] bg-ink-900/95 p-7 shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9)]"
                        initial={{ y: 16, scale: 0.98 }}
                        animate={{ y: 0, scale: 1 }}
                    >
                        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold-400/60 to-transparent" />
                        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gold-500/10 text-gold-400">
                            <Icon name="lock" size={20} />
                        </span>
                        {under ? (
                            <>
                                <h2 id="age-title" className="mt-4 font-display text-xl font-bold text-white">Glossos is for adults</h2>
                                <p className="mt-2 text-sm leading-relaxed text-slate-400">
                                    Sorry, the AI that powers Glossos is only available to people 18 or older. Please sign out.
                                </p>
                                <div className="mt-6 flex gap-2">
                                    <Button variant="ghost" className="flex-1" onClick={() => setUnder(false)}>Back</Button>
                                    <Button variant="primary" className="flex-1" onClick={onSignOut}>Sign out</Button>
                                </div>
                            </>
                        ) : (
                            <>
                                <h2 id="age-title" className="mt-4 font-display text-xl font-bold text-white">Are you 18 or older?</h2>
                                <p className="mt-2 text-sm leading-relaxed text-slate-400">
                                    Glossos uses Google's Gemini AI, which is only for adults. We ask once and save it on your account.
                                </p>
                                {error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
                                <div className="mt-6 space-y-2">
                                    <Button variant="primary" className="w-full" loading={busy} onClick={confirm}>Yes, I am 18 or older</Button>
                                    <Button variant="ghost" className="w-full" disabled={busy} onClick={() => setUnder(true)}>No, I am under 18</Button>
                                </div>
                            </>
                        )}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};
