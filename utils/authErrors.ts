/**
 * Turns Firebase Auth errors into messages that say what is actually wrong. The sign-in screen used
 * to show a generic "Please try again" for everything, which hid configuration problems such as an
 * unapproved domain or a disabled sign-in method.
 */

export type AuthMethod = 'google' | 'guest' | 'email-sign-in' | 'email-sign-up';

export function describeAuthError(err: unknown, method: AuthMethod): string {
    const code = String((err as { code?: string })?.code ?? '').trim()
        || /auth\/[a-z-]+/.exec(String((err as Error)?.message ?? ''))?.[0]
        || '';
    const host = typeof window !== 'undefined' ? window.location.hostname : 'this site';

    switch (code) {
        case 'auth/unauthorized-domain':
            return `Google sign-in isn't allowed on ${host} yet. The app owner must add it in Firebase → Authentication → Settings → Authorized domains.`;
        case 'auth/admin-restricted-operation':
        case 'auth/operation-not-allowed':
            return method === 'guest'
                ? 'Guest access is turned off for this app. The app owner can enable it in Firebase → Authentication → Sign-in method → Anonymous.'
                : 'This sign-in method is turned off for this app. The app owner can enable it in Firebase → Authentication → Sign-in method.';
        case 'auth/popup-blocked':
            return 'Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.';
        case 'auth/popup-closed-by-user':
        case 'auth/cancelled-popup-request':
            return 'The Google sign-in window was closed before finishing.';
        case 'auth/network-request-failed':
            return 'Could not reach the sign-in service. Check your internet connection.';
        case 'auth/invalid-credential':
        case 'auth/invalid-login-credentials':
        case 'auth/wrong-password':
        case 'auth/user-not-found':
            return 'Invalid email or password. If you usually sign in with Google, use that button, or create an account first.';
        case 'auth/email-already-in-use':
            return 'An account with this email already exists. Sign in instead.';
        case 'auth/weak-password':
            return 'Choose a password with at least 6 characters.';
        case 'auth/invalid-email':
            return 'That email address is not valid.';
        case 'auth/too-many-requests':
            return 'Too many attempts. Please wait a minute and try again.';
        default: {
            const fallback = method === 'google' ? 'Google sign-in failed.' : method === 'guest' ? 'Guest sign-in failed.' : 'Sign-in failed.';
            return code ? `${fallback} (${code})` : `${fallback} Please try again.`;
        }
    }
}
