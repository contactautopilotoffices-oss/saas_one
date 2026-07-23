import { supabaseAdmin } from '@/backend/lib/supabase/admin';

/**
 * LinkedIn Marketing API client.
 *
 * Centralizes:
 *   - OAuth token refresh (access tokens last ~60 days; we refresh proactively)
 *   - Versioned REST calls (LinkedIn requires a `LinkedIn-Version` header)
 *   - URN helpers
 *
 * All network access uses the org's stored credentials in `crm_linkedin_config`.
 * The service role owns these rows; nothing here is exposed to the browser.
 */

// LinkedIn versions its API monthly via the `LinkedIn-Version: YYYYMM` header.
// Bump this as LinkedIn deprecates older versions (they give ~1 year notice).
// LinkedIn keeps ~12 months of versions active; bump as older ones retire.
// Override without a deploy via the LINKEDIN_API_VERSION env var.
export const LINKEDIN_API_VERSION = process.env.LINKEDIN_API_VERSION?.trim() || '202605';
export const LINKEDIN_REST_BASE = 'https://api.linkedin.com/rest';
export const LINKEDIN_OAUTH_BASE = 'https://www.linkedin.com/oauth/v2';

// Scopes requested during OAuth. Only request what the app is APPROVED for —
// LinkedIn rejects the whole authorization if any scope is unauthorized.
// Override via env as more products get approved, e.g.:
//   LINKEDIN_SCOPES="r_ads r_ads_reporting r_marketing_leadgen_automation"
// Default = Advertising API (Development Tier): spend + reporting only.
export const LINKEDIN_SCOPES =
    process.env.LINKEDIN_SCOPES?.trim() || 'r_ads r_ads_reporting';

export interface LinkedInConfig {
    id: string;
    organization_id: string;
    client_id: string | null;
    client_secret: string | null;
    access_token: string | null;
    refresh_token: string | null;
    token_expires_at: string | null;
    refresh_token_expires_at: string | null;
    ad_account_urn: string | null;
    organization_urn: string | null;
    default_assignee: string | null;
    default_lead_source: string | null;
    default_property: string | null;
    is_active: boolean;
    last_lead_sync_at: string | null;
}

export class LinkedInAuthError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'LinkedInAuthError';
    }
}

/** Standard headers for a REST (versioned) call. */
function restHeaders(accessToken: string): Record<string, string> {
    return {
        Authorization: `Bearer ${accessToken}`,
        'LinkedIn-Version': LINKEDIN_API_VERSION,
        'X-Restli-Protocol-Version': '2.0.0',
        'Content-Type': 'application/json',
    };
}

/**
 * Return a valid access token for the org, refreshing if it expires within
 * the next 10 minutes. Persists the refreshed token. Throws LinkedInAuthError
 * if no refresh path is available.
 */
export async function getValidAccessToken(cfg: LinkedInConfig): Promise<string> {
    const skewMs = 10 * 60 * 1000;
    const expMs = cfg.token_expires_at ? new Date(cfg.token_expires_at).getTime() : 0;
    if (cfg.access_token && expMs - Date.now() > skewMs) {
        return cfg.access_token;
    }

    // Need to refresh.
    if (!cfg.refresh_token || !cfg.client_id || !cfg.client_secret) {
        throw new LinkedInAuthError(
            'LinkedIn access token expired and no refresh token / client credentials available — reconnect required.'
        );
    }
    const refreshExpMs = cfg.refresh_token_expires_at
        ? new Date(cfg.refresh_token_expires_at).getTime()
        : Infinity;
    if (refreshExpMs <= Date.now()) {
        throw new LinkedInAuthError('LinkedIn refresh token expired — reconnect required.');
    }

    const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: cfg.refresh_token,
        client_id: cfg.client_id,
        client_secret: cfg.client_secret,
    });
    const res = await fetch(`${LINKEDIN_OAUTH_BASE}/accessToken`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
    });
    const json: any = await res.json();
    if (!res.ok || !json.access_token) {
        throw new LinkedInAuthError(json?.error_description || json?.error || `Refresh failed (${res.status})`);
    }

    const now = Date.now();
    const tokenExpiresAt = new Date(now + (json.expires_in ?? 0) * 1000).toISOString();
    const refreshTokenExpiresAt = json.refresh_token_expires_in
        ? new Date(now + json.refresh_token_expires_in * 1000).toISOString()
        : cfg.refresh_token_expires_at;

    await supabaseAdmin
        .from('crm_linkedin_config')
        .update({
            access_token: json.access_token,
            refresh_token: json.refresh_token ?? cfg.refresh_token,
            token_expires_at: tokenExpiresAt,
            refresh_token_expires_at: refreshTokenExpiresAt,
            updated_at: new Date().toISOString(),
        })
        .eq('id', cfg.id);

    // Mutate the in-memory copy so the caller's subsequent calls use the fresh token.
    cfg.access_token = json.access_token;
    cfg.token_expires_at = tokenExpiresAt;
    return json.access_token;
}

/** GET a REST endpoint and return parsed JSON. Throws on non-2xx. */
export async function linkedinGet(cfg: LinkedInConfig, path: string): Promise<any> {
    const token = await getValidAccessToken(cfg);
    const url = path.startsWith('http') ? path : `${LINKEDIN_REST_BASE}${path}`;
    const res = await fetch(url, { headers: restHeaders(token) });
    const json: any = await res.json().catch(() => ({}));
    if (res.status === 401) {
        throw new LinkedInAuthError(json?.message || 'LinkedIn 401 — token invalid/expired.');
    }
    if (!res.ok) {
        throw new Error(json?.message || `LinkedIn API ${res.status} on ${path}`);
    }
    return json;
}

/** Exchange an authorization code for tokens (used by the OAuth callback). */
export async function exchangeCodeForTokens(opts: {
    code: string;
    redirectUri: string;
    clientId: string;
    clientSecret: string;
}): Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    refresh_token_expires_in?: number;
}> {
    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code: opts.code,
        redirect_uri: opts.redirectUri,
        client_id: opts.clientId,
        client_secret: opts.clientSecret,
    });
    const res = await fetch(`${LINKEDIN_OAUTH_BASE}/accessToken`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
    });
    const json: any = await res.json();
    if (!res.ok || !json.access_token) {
        throw new LinkedInAuthError(json?.error_description || json?.error || `Token exchange failed (${res.status})`);
    }
    return json;
}

/** Extract the numeric id from a URN like 'urn:li:sponsoredAccount:123' → '123'. */
export function urnId(urn: string | null | undefined): string | null {
    if (!urn) return null;
    const parts = urn.split(':');
    return parts[parts.length - 1] || null;
}
