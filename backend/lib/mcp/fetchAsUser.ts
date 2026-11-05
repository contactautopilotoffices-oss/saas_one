import { FETCH_TIMEOUT_MS, MAX_RESPONSE_BYTES, MAX_RESULT_CHARS } from './config';

/**
 * Calls one of the FMS's own GET routes AS the connected user, so the route's existing sign-in,
 * role and property checks decide what comes back, exactly as when the user opens the app.
 *
 * The user's access token is presented twice, because the routes read it in two ways:
 *  - as the Supabase session cookie (@supabase/ssr format), for routes that use createClient(),
 *  - as an Authorization: Bearer header, for routes that also accept mobile-app tokens.
 * No refresh token is ever sent or stored: when the access token expires, the assistant
 * refreshes it with Supabase Auth and calls again.
 */

const MAX_COOKIE_CHUNK = 3180; // same chunk size as @supabase/ssr

/** The cookie name @supabase/ssr uses: sb-<project ref>-auth-token */
export function sessionCookieName(supabaseUrl: string): string {
    const ref = new URL(supabaseUrl).hostname.split('.')[0];
    return `sb-${ref}-auth-token`;
}

/** Build the Cookie header value that @supabase/ssr reads as a signed-in session. */
export function buildSessionCookie(supabaseUrl: string, accessToken: string, expiresAt: number): string {
    const session = {
        access_token: accessToken,
        token_type: 'bearer',
        expires_at: expiresAt,
        expires_in: Math.max(0, expiresAt - Math.floor(Date.now() / 1000)),
        refresh_token: '', // deliberately empty: the MCP never holds a refresh token
    };
    const value = 'base64-' + Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');
    const name = sessionCookieName(supabaseUrl);
    if (value.length <= MAX_COOKIE_CHUNK) return `${name}=${value}`;
    const parts: string[] = [];
    for (let i = 0, n = 0; i < value.length; i += MAX_COOKIE_CHUNK, n++) {
        parts.push(`${name}.${n}=${value.slice(i, i + MAX_COOKIE_CHUNK)}`);
    }
    return parts.join('; ');
}

/** Build the URL to call. Refuses anything that would leave the FMS origin or the /api/ tree. */
export function buildTargetUrl(origin: string, path: string, query: Record<string, string>): URL | null {
    let url: URL;
    try {
        url = new URL(path, origin);
    } catch {
        return null;
    }
    if (url.origin !== new URL(origin).origin) return null;
    if (url.pathname !== path.replace(/\/$/, '') && url.pathname !== path) return null;
    if (!url.pathname.startsWith('/api/')) return null;
    url.search = '';
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    return url;
}

export type FetchResult = {
    status: number;
    ok: boolean;
    contentType: string;
    text: string; // what is handed to the assistant (possibly shortened)
    truncated: boolean;
};

export async function fetchAsUser(opts: {
    origin: string;
    supabaseUrl: string;
    accessToken: string;
    expiresAt: number;
    path: string;
    query: Record<string, string>;
}): Promise<FetchResult> {
    const url = buildTargetUrl(opts.origin, opts.path, opts.query);
    if (!url) throw new Error('refused: target is outside the FMS API');

    const res = await fetch(url, {
        method: 'GET',
        redirect: 'manual', // a redirect could point anywhere; never follow one with the user's token
        cache: 'no-store',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
            accept: 'application/json, text/plain;q=0.8',
            authorization: `Bearer ${opts.accessToken}`,
            cookie: buildSessionCookie(opts.supabaseUrl, opts.accessToken, opts.expiresAt),
            'x-fms-mcp': '1',
            'user-agent': 'fms-mcp/1.0',
        },
    });

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (res.status >= 300 && res.status < 400) {
        return { status: res.status, ok: false, contentType, text: 'The FMS answered with a redirect, which the MCP does not follow.', truncated: false };
    }

    const declared = parseInt(res.headers.get('content-length') || '', 10);
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
        await res.body?.cancel();
        return { status: res.status, ok: false, contentType, text: `The response is too large (${declared} bytes). Narrow the request with filters or paging.`, truncated: false };
    }

    const isText = contentType.includes('json') || contentType.startsWith('text/');
    if (!isText) {
        await res.body?.cancel();
        return { status: res.status, ok: res.ok, contentType, text: `The route returned a file (${contentType || 'unknown type'}), which the MCP does not pass on.`, truncated: false };
    }

    const body = await readCapped(res, MAX_RESPONSE_BYTES);
    if (body === null) {
        return { status: res.status, ok: false, contentType, text: 'The response is too large. Narrow the request with filters or paging.', truncated: false };
    }
    let text = body;
    if (contentType.includes('json')) {
        try {
            text = JSON.stringify(JSON.parse(body));
        } catch {
            /* keep raw text */
        }
    }
    const truncated = text.length > MAX_RESULT_CHARS;
    if (truncated) text = text.slice(0, MAX_RESULT_CHARS);
    return { status: res.status, ok: res.ok, contentType, text, truncated };
}

async function readCapped(res: Response, maxBytes: number): Promise<string | null> {
    if (!res.body) return '';
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel();
            return null;
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks.map(c => Buffer.from(c))).toString('utf8');
}
