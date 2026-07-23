import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveCrmAccess, isCrmAccessError, readOrgId } from '@/backend/lib/crm/access';
import { isBdSuperAdmin } from '@/frontend/constants/bdSuperAdmins';
import { LINKEDIN_OAUTH_BASE, LINKEDIN_SCOPES } from '@/backend/services/linkedinClient';

/**
 * GET /api/crm/oauth/linkedin?organization_id=...
 *
 * Starts the 3-legged OAuth flow. Generates a CSRF state nonce, stores it on
 * the org's config row, and 302-redirects the admin to LinkedIn's consent
 * screen. LinkedIn redirects back to /api/crm/oauth/linkedin/callback.
 *
 * Requires the org to have client_id configured first (saved via Settings).
 */
export async function GET(request: NextRequest) {
    const access = await resolveCrmAccess(request, readOrgId(request));
    if (isCrmAccessError(access)) return access;
    if (!isBdSuperAdmin(access.user.email) && !access.roles?.includes('bd_super_admin') && !access.isMasterAdmin) {
        return NextResponse.json({ error: 'BD super admin only' }, { status: 403 });
    }

    const { data: cfg } = await supabaseAdmin
        .from('crm_linkedin_config')
        .select('id, client_id')
        .eq('organization_id', access.organizationId)
        .maybeSingle();

    if (!cfg?.client_id) {
        return NextResponse.json(
            { error: 'Save your LinkedIn Client ID + Secret in CRM Settings before connecting.' },
            { status: 400 }
        );
    }

    const state = crypto.randomBytes(16).toString('hex');
    await supabaseAdmin
        .from('crm_linkedin_config')
        .update({ oauth_state: state, updated_at: new Date().toISOString() })
        .eq('id', cfg.id);

    const redirectUri = `${appBaseUrl(request)}/api/crm/oauth/linkedin/callback`;
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: cfg.client_id,
        redirect_uri: redirectUri,
        state,
        scope: LINKEDIN_SCOPES,
    });
    return NextResponse.redirect(`${LINKEDIN_OAUTH_BASE}/authorization?${params.toString()}`);
}

/** Resolve the public base URL (no trailing slash) for building the redirect URI. */
function appBaseUrl(request: NextRequest): string {
    const fromEnv = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
    if (fromEnv) return fromEnv.replace(/\/+$/, '');
    const origin = new URL(request.url).origin;
    return origin.replace(/\/+$/, '');
}
