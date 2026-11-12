import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveCrmAccess, isCrmAccessError, readOrgId } from '@/backend/lib/crm/access';
import { CampaignOutreachConfigService } from '@/backend/services/CampaignOutreachConfigService';

// GET /api/crm/outreach/campaigns — list all campaign outreach settings & eligible advisors
export async function GET(request: NextRequest) {
    const access = await resolveCrmAccess(request, readOrgId(request));
    if (isCrmAccessError(access)) return access;
    if (!access.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const orgId = access.organizationId;
    const [configs, nudgeSettings] = await Promise.all([
        CampaignOutreachConfigService.getAllCampaignConfigs(orgId),
        CampaignOutreachConfigService.getNudgeConfig(orgId),
    ]);

    // Fetch active advisors/team members for the dropdown
    const [pm, om] = await Promise.all([
        supabaseAdmin
            .from('property_memberships')
            .select('user_id, role')
            .eq('organization_id', orgId)
            .eq('is_active', true),
        supabaseAdmin
            .from('organization_memberships')
            .select('user_id, role')
            .eq('organization_id', orgId)
            .eq('is_active', true),
    ]);

    // Strictly filter to CRM & BD advisors (excluding FMS roles like property_admin, mst, staff, security, tenant)
    const CRM_ELIGIBLE_ROLES = new Set([
        'bd_rep',
        'bd_admin',
        'sales_rep',
        'sales_manager',
        'crm_admin',
        'org_super_admin',
        'org_admin',
        'ops_super_admin'
    ]);

    const userRoles = new Map<string, string>();
    for (const m of [...(pm.data || []), ...(om.data || [])]) {
        if (m.user_id && CRM_ELIGIBLE_ROLES.has(m.role) && !userRoles.has(m.user_id)) {
            userRoles.set(m.user_id, m.role);
        }
    }

    const userIds = Array.from(userRoles.keys());
    let members: Array<{ id: string; name: string; email?: string; phone?: string; role?: string }> = [];

    if (userIds.length > 0) {
        const { data: userRows } = await supabaseAdmin
            .from('users')
            .select('id, full_name, email, phone')
            .in('id', userIds)
            .order('full_name', { ascending: true });

        members = (userRows || []).map((u) => ({
            id: u.id,
            name: u.full_name || u.email || 'Unknown',
            email: u.email || undefined,
            phone: u.phone || undefined,
            role: userRoles.get(u.id),
        }));
    }

    return NextResponse.json({
        campaigns: configs,
        nudgeSettings,
        members,
        activePilotCity: 'Bangalore',
        pilotAdvisor: {
            name: 'Harshini Ranganathan',
            id: '0889c23c-0028-4b08-af18-b95d602fde28',
            phone: '9494608123',
        },
    });
}

// POST /api/crm/outreach/campaigns — update campaign outreach settings
export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

    const access = await resolveCrmAccess(request, readOrgId(request, body));
    if (isCrmAccessError(access)) return access;
    if (!access.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Handle organization-wide Nudge automation updates
    if (body.update_nudge_settings) {
        const { nudge_enabled, nudge_delay_hours, nudge_template_name } = body;
        const updatedNudge = await CampaignOutreachConfigService.updateNudgeConfig(
            access.organizationId,
            {
                nudge_enabled: nudge_enabled !== undefined ? Boolean(nudge_enabled) : undefined,
                nudge_delay_hours: nudge_delay_hours !== undefined ? Number(nudge_delay_hours) : undefined,
                nudge_template_name: nudge_template_name || undefined,
            }
        );
        return NextResponse.json({ success: true, nudgeSettings: updatedNudge });
    }

    const { campaign, outreach_enabled, property_photo_url, property_name, assigned_user_id, assigned_advisor_name } = body;
    if (!campaign) {
        return NextResponse.json({ error: 'campaign is required' }, { status: 400 });
    }

    const updated = await CampaignOutreachConfigService.updateCampaignConfig(
        access.organizationId,
        campaign,
        {
            outreach_enabled: outreach_enabled !== undefined ? Boolean(outreach_enabled) : undefined,
            property_photo_url: property_photo_url || undefined,
            property_name: property_name || undefined,
            assigned_user_id: assigned_user_id !== undefined ? assigned_user_id : undefined,
            assigned_advisor_name: assigned_advisor_name || undefined,
        },
        access.user.id
    );

    return NextResponse.json({ success: true, campaign: updated });
}
