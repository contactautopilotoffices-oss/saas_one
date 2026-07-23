import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveCrmAccess, isCrmAccessError, readOrgId } from '@/backend/lib/crm/access';
import { isBdSuperAdmin } from '@/frontend/constants/bdSuperAdmins';
import { LinkedInConfig } from '@/backend/services/linkedinClient';
import { syncLinkedInLeadsForOrg } from '@/backend/services/linkedinLeadSync';
import { syncLinkedInInsightsForOrg } from '@/backend/services/linkedinInsightsSync';

/**
 * POST /api/crm/linkedin-sync
 *
 * Admin-triggered manual sync for the caller's org. Runs both the lead poll
 * and the insights pull immediately and returns the result. Mirrors the
 * "Pull now" button behaviour of the Meta integration.
 *
 * Body (optional): { mode: 'leads' | 'insights' | 'both' } (default 'both')
 */

const CONFIG_SELECT =
    'id, organization_id, client_id, client_secret, access_token, refresh_token, token_expires_at, refresh_token_expires_at, ad_account_urn, organization_urn, default_assignee, default_lead_source, default_property, is_active, last_lead_sync_at';

export async function POST(request: NextRequest) {
    const access = await resolveCrmAccess(request, readOrgId(request));
    if (isCrmAccessError(access)) return access;
    if (!isBdSuperAdmin(access.user.email) && !access.roles?.includes('bd_super_admin') && !access.isMasterAdmin) {
        return NextResponse.json({ error: 'BD super admin only' }, { status: 403 });
    }
    const body = await request.json().catch(() => ({}));
    const mode: string = body.mode || 'both';

    const { data: cfg } = await supabaseAdmin
        .from('crm_linkedin_config')
        .select(CONFIG_SELECT)
        .eq('organization_id', access.organizationId)
        .maybeSingle();

    if (!cfg || !cfg.is_active) {
        return NextResponse.json({ error: 'LinkedIn is not connected for this organization.' }, { status: 400 });
    }

    const out: any = { status: 'ok' };
    if (mode === 'leads' || mode === 'both') {
        out.leads = await syncLinkedInLeadsForOrg(cfg as LinkedInConfig);
    }
    if (mode === 'insights' || mode === 'both') {
        out.insights = await syncLinkedInInsightsForOrg(cfg as LinkedInConfig);
    }
    return NextResponse.json(out);
}
