/**
 * Firebase ID token verification for Netlify Functions, with no extra dependencies.
 *
 * Checks the RS256 signature against Google's published securetoken certificates and the claims
 * Firebase documents for ID tokens:
 * https://firebase.google.com/docs/auth/admin/verify-id-tokens#verify_id_tokens_using_a_third-party_jwt_library
 */

import { createVerify } from 'node:crypto';

const CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const CLOCK_SKEW_SECONDS = 60;

export interface VerifiedUser {
    uid: string;
    anonymous: boolean;
    email?: string;
    emailVerified?: boolean;
}

let certCache: { certs: Record<string, string> | null; expiresAt: number } = { certs: null, expiresAt: 0 };

async function getCerts(): Promise<Record<string, string>> {
    if (certCache.certs && Date.now() < certCache.expiresAt) return certCache.certs;
    const res = await fetch(CERTS_URL);
    if (!res.ok) throw new Error(`Failed to fetch Firebase certs: ${res.status}`);
    const certs = (await res.json()) as Record<string, string>;
    const maxAge = /max-age=(\d+)/.exec(res.headers.get('cache-control') || '');
    certCache = { certs, expiresAt: Date.now() + (maxAge ? Number(maxAge[1]) * 1000 : 3600 * 1000) };
    return certs;
}

function decodeSegment(segment: string): any {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

export async function verifyFirebaseIdToken(token: string, projectId: string): Promise<VerifiedUser> {
    const parts = String(token).split('.');
    if (parts.length !== 3) throw new Error('Malformed token');
    const [headerB64, payloadB64, signatureB64] = parts;

    let header: any;
    let payload: any;
    try {
        header = decodeSegment(headerB64);
        payload = decodeSegment(payloadB64);
    } catch {
        throw new Error('Malformed token');
    }

    if (header.alg !== 'RS256') throw new Error('Unexpected algorithm');
    const cert = (await getCerts())[header.kid];
    if (!cert) throw new Error('Unknown signing key');

    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${headerB64}.${payloadB64}`);
    if (!verifier.verify(cert, Buffer.from(signatureB64, 'base64url'))) throw new Error('Bad signature');

    const now = Math.floor(Date.now() / 1000);
    if (payload.aud !== projectId) throw new Error('Wrong audience');
    if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('Wrong issuer');
    if (typeof payload.exp !== 'number' || payload.exp < now - CLOCK_SKEW_SECONDS) throw new Error('Token expired');
    if (typeof payload.iat !== 'number' || payload.iat > now + CLOCK_SKEW_SECONDS) throw new Error('Token issued in the future');
    if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('Missing subject');

    return {
        uid: payload.sub,
        anonymous: payload.firebase?.sign_in_provider === 'anonymous',
        ...(typeof payload.email === 'string' ? { email: payload.email, emailVerified: payload.email_verified === true } : {}),
    };
}

/** Test hook: clears the certificate cache. */
export function _resetCertCache() {
    certCache = { certs: null, expiresAt: 0 };
}
