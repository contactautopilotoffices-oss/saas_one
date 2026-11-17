import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { authIssuer } from './config';

export type McpCaller = {
    userId: string;
    email: string | null;
    clientId: string;
    accessToken: string;
    expiresAt: number; // seconds since epoch
};

export type TokenCheck = { ok: true; caller: McpCaller } | { ok: false; reason: string };

/** Pull the bearer token from an Authorization header. Only the header form is accepted. */
export function readBearer(header: string | null): string | null {
    if (!header) return null;
    const m = header.match(/^Bearer\s+([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)\s*$/);
    return m ? m[1] : null;
}

/** Decode a JWT payload WITHOUT verifying it. Only used after Supabase has verified the token. */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
    const part = token.split('.')[1];
    if (!part) return null;
    try {
        const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
        const parsed = JSON.parse(json);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

/**
 * Checks the claims of an already-verified token. Pure, so it can be tested.
 * Rules:
 *  - issued by this project's Supabase Auth,
 *  - not expired,
 *  - issued to an OAuth client (has client_id). An ordinary browser session token is
 *    refused, so every MCP connection is one the user approved on the consent screen
 *    and can revoke on its own.
 */
export function checkClaims(
    claims: Record<string, unknown> | null,
    expectedIssuer: string | null,
    nowSeconds: number,
): { ok: true; clientId: string; exp: number; sub: string } | { ok: false; reason: string } {
    if (!claims) return { ok: false, reason: 'unreadable token' };
    if (!expectedIssuer) return { ok: false, reason: 'server is missing NEXT_PUBLIC_SUPABASE_URL' };
    if (claims.iss !== expectedIssuer) return { ok: false, reason: 'token was not issued by this FMS' };
    const exp = typeof claims.exp === 'number' ? claims.exp : NaN;
    if (!Number.isFinite(exp) || exp <= nowSeconds) return { ok: false, reason: 'token expired' };
    const clientId = typeof claims.client_id === 'string' ? claims.client_id : '';
    if (!clientId) return { ok: false, reason: 'token was not issued through the FMS connect (OAuth) screen' };
    const sub = typeof claims.sub === 'string' ? claims.sub : '';
    if (!sub) return { ok: false, reason: 'token has no user' };
    if (claims.role !== 'authenticated') return { ok: false, reason: 'token is not a signed-in user token' };
    return { ok: true, clientId, exp, sub };
}

/**
 * Verify the caller's token with Supabase Auth (a network check, so a signed-out, deleted or
 * banned user is refused), then check its claims.
 */
export async function verifyMcpToken(authorizationHeader: string | null): Promise<TokenCheck> {
    const token = readBearer(authorizationHeader);
    if (!token) return { ok: false, reason: 'missing bearer token' };

    const { data, error } = await supabaseAdmin.auth.getUser(token);
    const user = data?.user;
    if (error || !user) return { ok: false, reason: 'token rejected by FMS sign-in' };

    const bannedUntil = (user as { banned_until?: string | null }).banned_until;
    if (bannedUntil && new Date(bannedUntil).getTime() > Date.now()) {
        return { ok: false, reason: 'user is blocked' };
    }

    const claims = checkClaims(decodeJwtPayload(token), authIssuer(), Math.floor(Date.now() / 1000));
    if (!claims.ok) return claims;
    if (claims.sub !== user.id) return { ok: false, reason: 'token user mismatch' };

    return {
        ok: true,
        caller: {
            userId: user.id,
            email: user.email ?? null,
            clientId: claims.clientId,
            accessToken: token,
            expiresAt: claims.exp,
        },
    };
}
