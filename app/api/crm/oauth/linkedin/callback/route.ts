import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { exchangeCodeForTokens } from '@/backend/services/linkedinClient';
/** Resolve the public base URL (no trailing slash) for building the redirect URI. */
function appBaseUrl(request: NextRequest): string {
    const fromEnv = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
    if (fromEnv) return fromEnv.replace(/\/+$/, '');
    const origin = new URL(request.url).origin;
    return origin.replace(/\/+$/, '');
}

/**
 * GET /api/crm/oauth/linkedin/callback?code=...&state=...
 *
 * LinkedIn redirects here after consent. We resolve the org by matching the
 * `state` nonce against crm_linkedin_config, exchange the code for tokens,
 * persist them, and bounce back to the CRM settings page.
 */
export async function GET(request: NextRequest) {
    const sp = new URL(request.url).searchParams;
    const code = sp.get('code');
    const state = sp.get('state');
    const errorParam = sp.get('error');
    const base = appBaseUrl(request);

    // Helper to land the admin back on settings with a status flag.
    const back = (status: string, orgId?: string) => {
        const path = orgId ? `/${orgId}/crm/settings` : '/';
        return NextResponse.redirect(`${base}${path}?linkedin=${status}`);
    };

    if (errorParam) {
        return back('denied');
    }
    if (!code || !state) {
        return back('error');
    }

    const { data: cfg } = await supabaseAdmin
        .from('crm_linkedin_config')
        .select('id, organization_id, client_id, client_secret, oauth_state')
        .eq('oauth_state', state)
        .maybeSingle();

    if (!cfg || !cfg.client_id || !cfg.client_secret) {
        return back('error');
    }

    try {
        const redirectUri = `${base}/api/crm/oauth/linkedin/callback`;
        const tokens = await exchangeCodeForTokens({
            code,
            redirectUri,
            clientId: cfg.client_id,
            clientSecret: cfg.client_secret,
        });

        const now = Date.now();
        await supabaseAdmin
            .from('crm_linkedin_config')
            .update({
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token ?? null,
                token_expires_at: new Date(now + (tokens.expires_in ?? 0) * 1000).toISOString(),
                refresh_token_expires_at: tokens.refresh_token_expires_in
                    ? new Date(now + tokens.refresh_token_expires_in * 1000).toISOString()
                    : null,
                oauth_state: null,
                is_active: true,
                updated_at: new Date().toISOString(),
            })
            .eq('id', cfg.id);

        return back('connected', cfg.organization_id);
    } catch (err: any) {
        console.error('[LinkedIn OAuth callback] exchange failed:', err);
        return back('error', cfg.organization_id);
    }
}
