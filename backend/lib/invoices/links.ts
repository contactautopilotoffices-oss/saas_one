import crypto from 'crypto';

/**
 * Upload-link tokens. 32 random bytes (256 bits), URL-safe. Only the SHA-256 is stored,
 * so a database leak does not yield a working link. The raw token exists in exactly one
 * place: the response to the person who generated it.
 *
 * The token carries nothing: no vendor, no PO, no amount.
 */
export function newLinkToken(): { token: string; hash: string } {
    const token = crypto.randomBytes(32).toString('base64url');
    return { token, hash: hashToken(token) };
}

export const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

/** base64url, 43 chars. Anything else is rejected before it touches the database. */
export const looksLikeToken = (t: unknown): t is string => typeof t === 'string' && /^[A-Za-z0-9_-]{43}$/.test(t);

/**
 * Best-effort throttle for the public endpoints. In-memory, so each server instance
 * counts separately: it slows a script hammering one instance, it is not a global limit.
 * The real guards are the 256-bit token and the atomic single-use link.
 */
const hits = new Map<string, number[]>();
export function tooManyRequests(key: string, max = 30, windowMs = 60_000): boolean {
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
    return recent.length > max;
}

export function clientKey(request: Request, scope: string): string {
    const fwd = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    return `${scope}:${fwd || request.headers.get('x-real-ip') || 'unknown'}`;
}
