/**
 * Settings for the FMS MCP server (/api/mcp). All read from environment variables, with
 * safe defaults. Nothing secret lives here.
 */

/** The public origin of the FMS, e.g. https://fms.example.com. */
export function publicOrigin(requestUrl?: string): string | null {
    const configured = process.env.MCP_PUBLIC_ORIGIN || process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
    if (configured) {
        try {
            return new URL(configured).origin;
        } catch {
            return null;
        }
    }
    // Only outside production may we fall back to the request's own host. In production the
    // Host header is caller-controlled, and the MCP sends the user's token to this origin.
    if (process.env.NODE_ENV !== 'production' && requestUrl) {
        try {
            return new URL(requestUrl).origin;
        } catch {
            return null;
        }
    }
    return null;
}

/** Where the MCP server sends its own internal calls to the FMS routes. Defaults to the public origin. */
export function internalOrigin(requestUrl?: string): string | null {
    if (process.env.MCP_INTERNAL_ORIGIN) {
        try {
            return new URL(process.env.MCP_INTERNAL_ORIGIN).origin;
        } catch {
            return null;
        }
    }
    return publicOrigin(requestUrl);
}

export function supabaseUrl(): string | null {
    const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!raw) return null;
    try {
        return new URL(raw).origin;
    } catch {
        return null;
    }
}

/** The Supabase Auth issuer that signs OAuth tokens, e.g. https://abc.supabase.co/auth/v1 */
export function authIssuer(): string | null {
    const base = supabaseUrl();
    return base ? `${base}/auth/v1` : null;
}

/** Hosts an OAuth client may send the user back to after they approve. */
export function allowedRedirectHosts(): string[] {
    const extra = (process.env.MCP_ALLOWED_REDIRECT_HOSTS || '')
        .split(',')
        .map(h => h.trim().toLowerCase())
        .filter(Boolean);
    return Array.from(new Set(['claude.ai', 'claude.com', ...extra]));
}

/** Calls allowed per user per minute (per server instance). */
export function rateLimitPerMinute(): number {
    const n = parseInt(process.env.MCP_RATE_LIMIT_PER_MINUTE || '', 10);
    return Number.isFinite(n) && n > 0 ? n : 60;
}

/** Most characters of one FMS response handed back to the assistant. */
export const MAX_RESULT_CHARS = 60_000;
/** Most bytes read from one FMS response. Anything larger is refused. */
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
/** Time limit for one FMS call made by the MCP. */
export const FETCH_TIMEOUT_MS = 25_000;
