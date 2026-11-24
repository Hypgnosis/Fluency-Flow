import React, { useState, useEffect } from 'react';
import { describeAuthError } from '../utils/authErrors';
import {
    signInAnonymously,
    signInWithPopup,
    signOut,
    GoogleAuthProvider,
    User,
    onAuthStateChanged,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
} from 'firebase/auth';
import { auth, isFirebaseConfigured } from '../services/firebase';

interface AuthContextType {
    user: User | null;
    loading: boolean;
    /** Resolve to the signed-in user's id. */
    signInWithGoogle: () => Promise<string | undefined>;
    signInAsGuest: () => Promise<string | undefined>;
    logout: () => Promise<void>;
}

const AuthContext = React.createContext<AuthContextType>({
    user: null,
    loading: true,
    signInWithGoogle: async () => undefined,
    signInAsGuest: async () => undefined,
    logout: async () => { }
});

export const useAuth = () => React.useContext(AuthContext);

/**
 * Google's Gemini API terms require users to be 18 or older. The sign-in card asks for that, and
 * remembers which account confirmed it, so the app can record it on the account right after.
 */
const ADULT_KEY = 'glossos_adult_uid';
export function rememberAdult(uid: string | undefined) {
    if (!uid) return;
    try { localStorage.setItem(ADULT_KEY, uid); } catch { /* storage unavailable */ }
}
export function confirmedAdultHere(uid: string | undefined): boolean {
    try { return !!uid && localStorage.getItem(ADULT_KEY) === uid; } catch { return false; }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Local development only (stripped from production builds): ?ui-preview shows the signed-in
        // app with a stand-in user, so screens can be reviewed without signing in.
        if (process.env.GLOSSOS_DEV_PREVIEW && new URLSearchParams(window.location.search).has('ui-preview')) {
            const params = new URLSearchParams(window.location.search);
            if (params.has('onboarding')) localStorage.removeItem('glossos_onboarded');
            else localStorage.setItem('glossos_onboarded', 'true');
            setUser(params.has('signed-out') ? null : ({
                uid: 'ui-preview', isAnonymous: false, displayName: 'Alex Rivera', email: 'alex@example.com',
            } as any as User));
            setLoading(false);
            return;
        }
        if (!isFirebaseConfigured || !auth) {
            // Firebase not configured — create a mock guest user so the app works
            console.warn('Firebase not configured, using mock guest user');
            setUser({
                uid: 'local-guest-' + Date.now(),
                isAnonymous: true,
                displayName: 'Guest',
                email: null,
            } as any as User);
            setLoading(false);
            return;
        }

        const unsubscribe = onAuthStateChanged(auth, (user) => {
            setUser(user);
            setLoading(false);
        });

        return unsubscribe;
    }, []);

    const signInWithGoogle = async () => {
        if (!auth) {
            throw new Error('Firebase is not configured. Please set FIREBASE_* environment variables.');
        }
        try {
            const provider = new GoogleAuthProvider();
            return (await signInWithPopup(auth, provider)).user.uid;
        } catch (error) {
            console.error('Error signing in with Google:', error);
            throw error;
        }
    };

    const signInAsGuest = async () => {
        if (!auth) {
            throw new Error('Firebase is not configured. Please set FIREBASE_* environment variables.');
        }
        try {
            return (await signInAnonymously(auth)).user.uid;
        } catch (error) {
            console.error('Error signing in anonymously:', error);
            throw error;
        }
    };

    const logout = async () => {
        if (!auth) {
            console.warn('Firebase not configured, clearing local user state');
            setUser(null);
            return;
        }
        try {
            await signOut(auth);
        } catch (error) {
            console.error('Error signing out:', error);
            throw error;
        }
    };

    return (
        <AuthContext.Provider value={{ user, loading, signInWithGoogle, signInAsGuest, logout }}>
            {children}
        </AuthContext.Provider>
    );
};

export const AuthModal: React.FC<{ onClose?: () => void }> = ({ onClose }) => {
    const { signInWithGoogle, signInAsGuest } = useAuth();
    const [isRegistering, setIsRegistering] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [adult, setAdult] = useState(false);
    const [ageMissing, setAgeMissing] = useState(false);

    /** Every way in needs the 18+ box ticked first. */
    const needsAge = () => {
        if (adult) return false;
        setAgeMissing(true);
        setError('Please confirm you are 18 or older to continue.');
        return true;
    };

    const handleGoogleSignIn = async () => {
        if (needsAge()) return;
        setLoading(true);
        setError(null);
        try {
            rememberAdult(await signInWithGoogle());
            onClose?.();
        } catch (err) {
            setError(describeAuthError(err, 'google'));
        } finally {
            setLoading(false);
        }
    };

    const handleGuestSignIn = async () => {
        if (needsAge()) return;
        setLoading(true);
        setError(null);
        try {
            rememberAdult(await signInAsGuest());
            onClose?.();
        } catch (err) {
            setError(describeAuthError(err, 'guest'));
        } finally {
            setLoading(false);
        }
    };

    const handleEmailAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!auth) {
            setError('Firebase is not configured.');
            return;
        }
        if (!email || !password) {
            setError('Please enter both email and password.');
            return;
        }
        if (needsAge()) return;

        setLoading(true);
        setError(null);

        try {
            const cred = isRegistering
                ? await createUserWithEmailAndPassword(auth, email, password)
                : await signInWithEmailAndPassword(auth, email, password);
            rememberAdult(cred.user.uid);
            onClose?.();
        } catch (err: any) {
            console.error('Email auth error:', err);
            setError(describeAuthError(err, isRegistering ? 'email-sign-up' : 'email-sign-in'));
        } finally {
            setLoading(false);
        }
    };

    const inputClass = 'h-12 w-full rounded-xl border border-white/[0.09] bg-white/[0.04] px-4 text-[15px] text-white placeholder-slate-500 transition-colors focus:border-gold-400/60 focus:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-gold-400/20';

    return (
        <div className={onClose ? 'fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm' : 'w-full'}>
            <div className="relative w-full max-w-[420px] overflow-hidden rounded-[28px] border border-white/[0.08] bg-ink-900/80 shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9)] backdrop-blur-2xl">
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold-400/60 to-transparent" />
                {onClose && (
                    <button onClick={onClose} aria-label="Close" className="absolute right-4 top-4 rounded-full p-1.5 text-slate-500 transition-colors hover:bg-white/[0.06] hover:text-white">
                        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M6 6l12 12M18 6 6 18" /></svg>
                    </button>
                )}

                <div className="p-7 sm:p-8">
                    <h2 className="font-display text-2xl font-bold tracking-tight text-white">
                        {isRegistering ? 'Create your account' : 'Welcome to Glossos'}
                    </h2>
                    <p className="mt-1.5 text-sm text-slate-400">
                        {isRegistering ? 'Your progress, saved words and mistakes follow you on every device.' : 'Sign in to pick up where you left off.'}
                    </p>

                    {error && (
                        <div role="alert" className="mt-5 rounded-xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm leading-snug text-rose-100">
                            {error}
                        </div>
                    )}

                    <label
                        className={`mt-5 flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 text-sm leading-snug transition-colors ${ageMissing && !adult ? 'border-rose-400/40 bg-rose-500/[0.06]' : 'border-white/[0.08] bg-white/[0.025]'}`}
                    >
                        <input
                            type="checkbox"
                            checked={adult}
                            onChange={(e) => { setAdult(e.target.checked); if (e.target.checked) { setAgeMissing(false); setError(null); } }}
                            className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[#FFBF00]"
                        />
                        <span className="text-slate-300">
                            <span className="font-semibold text-white">I am 18 or older.</span>{' '}
                            Glossos uses Google's Gemini AI, which is only for adults.
                        </span>
                    </label>

                    <button
                        onClick={handleGoogleSignIn}
                        disabled={loading}
                        type="button"
                        className="mt-6 flex h-12 w-full items-center justify-center gap-3 rounded-xl bg-white text-[15px] font-semibold text-gray-900 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
                            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                        </svg>
                        Continue with Google
                    </button>

                    <div className="my-6 flex items-center gap-4">
                        <div className="h-px flex-grow bg-white/[0.08]" />
                        <span className="text-xs font-medium text-slate-500">or with email</span>
                        <div className="h-px flex-grow bg-white/[0.08]" />
                    </div>

                    <form onSubmit={handleEmailAuth} className="space-y-3">
                        <input
                            type="email"
                            autoComplete="email"
                            aria-label="Email address"
                            placeholder="Email address"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className={inputClass}
                            required
                        />
                        <input
                            type="password"
                            autoComplete={isRegistering ? 'new-password' : 'current-password'}
                            aria-label="Password"
                            placeholder={isRegistering ? 'Password (6+ characters)' : 'Password'}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className={inputClass}
                            required
                        />
                        <button
                            type="submit"
                            disabled={loading}
                            className="flex h-12 w-full items-center justify-center rounded-xl bg-gradient-to-b from-gold-400 to-gold-500 text-[15px] font-semibold text-ink-950 shadow-[0_10px_30px_-12px_rgba(255,191,0,0.7)] transition-colors hover:from-gold-300 hover:to-gold-400 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {loading ? 'One moment…' : (isRegistering ? 'Create account' : 'Sign in')}
                        </button>
                    </form>

                    <p className="mt-5 text-center text-sm text-slate-400">
                        {isRegistering ? 'Already have an account?' : 'New to Glossos?'}{' '}
                        <button type="button" onClick={() => { setIsRegistering(!isRegistering); setError(null); }} className="font-semibold text-gold-300 transition-colors hover:text-gold-200">
                            {isRegistering ? 'Sign in' : 'Create an account'}
                        </button>
                    </p>
                </div>

                <div className="border-t border-white/[0.06] bg-white/[0.015] px-7 py-4 sm:px-8">
                    <button
                        onClick={handleGuestSignIn}
                        disabled={loading}
                        type="button"
                        className="flex w-full items-center justify-center gap-2 text-sm font-medium text-slate-400 transition-colors hover:text-white disabled:opacity-50"
                    >
                        Try it first as a guest
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M5 12h14M13 6l6 6-6 6" /></svg>
                    </button>
                </div>
            </div>
        </div>
    );
};
