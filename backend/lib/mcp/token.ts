/**
 * MCP connection tokens.
 *
 * The raw token is returned to the user exactly once, at creation. Only its
 * SHA-256 hash is stored, so a database read cannot yield a working token.
 */

import { randomBytes, createHash, timingSafeEqual } from 'crypto';

export const TOKEN_PREFIX = 'oem_mcp_';

export interface GeneratedToken {
    /** Shown to the user once. Never persisted. */
    raw: string;
    hash: string;
    /** Safe to display in a list, e.g. "oem_mcp_a1b2c3d4". */
    prefix: string;
}

export function generateToken(): GeneratedToken {
    const secret = randomBytes(32).toString('base64url');
    const raw = `${TOKEN_PREFIX}${secret}`;
    return {
        raw,
        hash: hashToken(raw),
        prefix: `${TOKEN_PREFIX}${secret.slice(0, 8)}`,
    };
}

export function hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
}

/** Constant-time compare so a hash cannot be probed byte by byte. */
export function tokenMatches(rawCandidate: string, storedHash: string): boolean {
    const a = Buffer.from(hashToken(rawCandidate), 'hex');
    const b = Buffer.from(storedHash, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
}

/** Pull the bearer token out of an Authorization header. */
export function extractBearer(header: string | null): string | null {
    if (!header) return null;
    const m = /^Bearer\s+(.+)$/i.exec(header.trim());
    const token = m?.[1]?.trim();
    if (!token || !token.startsWith(TOKEN_PREFIX)) return null;
    return token;
}
