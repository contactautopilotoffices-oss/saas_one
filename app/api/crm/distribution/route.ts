import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveCrmAccess, isCrmAccessError, readOrgId } from '@/backend/lib/crm/access';

// GET /api/crm/distribution — list distribution rules for the org
export async function GET(request: NextRequest) {
    const access = await resolveCrmAccess(request, readOrgId(request));
    if (isCrmAccessError(access)) return access;
    if (!access.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { data: rules, error } = await supabaseAdmin
        .from('crm_lead_distribution_rules')
        .select('*, members:crm_lead_distribution_members(*, user_info:users(id, full_name, email))')
        .eq('organization_id', access.organizationId)
        .eq('is_active', true)
        .order('campaign');

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Also return org members so the UI can populate the rep selector
    const [pm, om] = await Promise.all([
        supabaseAdmin
            .from('property_memberships')
            .select('user_id, role, user_info:users(id, full_name, email)')
            .eq('organization_id', access.organizationId)
            .eq('is_active', true),
        supabaseAdmin
            .from('organization_memberships')
            .select('user_id, role, user_info:users(id, full_name, email)')
            .eq('organization_id', access.organizationId)
            .eq('is_active', true),
    ]);
    const seenIds = new Set<string>();
    const orgMembers = [...(pm.data || []), ...(om.data || [])]
        .filter((m: any) => {
            if (seenIds.has(m.user_id)) return false;
            seenIds.add(m.user_id);
            return true;
        })
        .map((m: any) => ({
            user_id: m.user_id,
            full_name: m.user_info?.full_name || m.user_info?.email || 'Unknown',
            email: m.user_info?.email,
            role: m.role,
        }));

    // Get distinct campaign values from leads
    const { data: campaignRows } = await supabaseAdmin
        .from('crm_leads')
        .select('campaign')
        .eq('organization_id', access.organizationId)
        .not('campaign', 'is', null)
        .limit(500);
    const campaigns = [...new Set((campaignRows || []).map((r: any) => r.campaign).filter(Boolean))].sort();

    return NextResponse.json({ rules: rules || [], members: orgMembers, campaigns });
}

// POST /api/crm/distribution — create or update a distribution rule
export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

    const access = await resolveCrmAccess(request, readOrgId(request, body));
    if (isCrmAccessError(access)) return access;
    if (!access.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { campaign, mode, user_ids } = body as {
        campaign?: string;
        mode?: 'exclusive' | 'round_robin';
        user_ids?: string[];
    };

    if (!campaign?.trim()) return NextResponse.json({ error: 'campaign is required' }, { status: 400 });
    if (!mode || !['exclusive', 'round_robin'].includes(mode)) {
        return NextResponse.json({ error: 'mode must be exclusive or round_robin' }, { status: 400 });
    }
    if (!user_ids?.length) return NextResponse.json({ error: 'At least one user_id is required' }, { status: 400 });
    if (mode === 'exclusive' && user_ids.length > 1) {
        return NextResponse.json({ error: 'Exclusive mode requires exactly one user' }, { status: 400 });
    }

    const org = access.organizationId;

    // Upsert the rule
    const { data: existing } = await supabaseAdmin
        .from('crm_lead_distribution_rules')
        .select('id')
        .eq('organization_id', org)
        .eq('campaign', campaign.trim())
        .maybeSingle();

    let ruleId: string;
    if (existing) {
        await supabaseAdmin
            .from('crm_lead_distribution_rules')
            .update({ mode, is_active: true, updated_at: new Date().toISOString() })
            .eq('id', existing.id);
        ruleId = existing.id;
    } else {
        const { data: newRule, error: ruleErr } = await supabaseAdmin
            .from('crm_lead_distribution_rules')
            .insert({ organization_id: org, campaign: campaign.trim(), mode })
            .select('id')
            .single();
        if (ruleErr) return NextResponse.json({ error: ruleErr.message }, { status: 500 });
        ruleId = newRule.id;
    }

    // Deactivate all existing members, then upsert the new set
    await supabaseAdmin
        .from('crm_lead_distribution_members')
        .update({ is_active: false })
        .eq('rule_id', ruleId);

    for (const uid of user_ids) {
        const { data: existingMember } = await supabaseAdmin
            .from('crm_lead_distribution_members')
            .select('id')
            .eq('rule_id', ruleId)
            .eq('user_id', uid)
            .maybeSingle();

        if (existingMember) {
            await supabaseAdmin
                .from('crm_lead_distribution_members')
                .update({ is_active: true })
                .eq('id', existingMember.id);
        } else {
            await supabaseAdmin
                .from('crm_lead_distribution_members')
                .insert({ rule_id: ruleId, user_id: uid });
        }
    }

    // Fetch the final state
    const { data: rule } = await supabaseAdmin
        .from('crm_lead_distribution_rules')
        .select('*, members:crm_lead_distribution_members(*, user_info:users(id, full_name, email))')
        .eq('id', ruleId)
        .single();

    return NextResponse.json({ rule }, { status: 201 });
}

// DELETE /api/crm/distribution?id= — deactivate a rule
export async function DELETE(request: NextRequest) {
    const ruleId = new URL(request.url).searchParams.get('id');
    if (!ruleId) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const access = await resolveCrmAccess(request, readOrgId(request));
    if (isCrmAccessError(access)) return access;
    if (!access.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { data: rule } = await supabaseAdmin
        .from('crm_lead_distribution_rules')
        .select('id, organization_id')
        .eq('id', ruleId)
        .maybeSingle();

    if (!rule || rule.organization_id !== access.organizationId) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    await supabaseAdmin
        .from('crm_lead_distribution_rules')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', ruleId);

    return NextResponse.json({ success: true });
}
