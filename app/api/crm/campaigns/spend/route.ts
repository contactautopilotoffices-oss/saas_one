import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveCrmAccess, isCrmAccessError, readOrgId } from '@/backend/lib/crm/access';

const CreateSpendSchema = z.object({
    campaign_id: z.string().uuid(),
    spend_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    amount: z.number().nonnegative().max(100_000_000),
    source: z.enum(['manual', 'meta_api', 'google_api', 'import']).default('manual'),
    notes: z.string().max(500).optional().nullable(),
});

/**
 * GET /api/crm/campaigns/spend?campaign_id=...&from=YYYY-MM-DD&to=YYYY-MM-DD
 * Returns spend rows for the org, optionally filtered to one campaign and a date range.
 */
export async function GET(request: NextRequest) {
    const access = await resolveCrmAccess(request, readOrgId(request));
    if (isCrmAccessError(access)) return access;

    const url = new URL(request.url);
    const campaignId = url.searchParams.get('campaign_id');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');

    let query = supabaseAdmin
        .from('crm_campaign_spend')
        .select('id, campaign_id, spend_date, amount, source, notes, created_at')
        .eq('organization_id', access.organizationId)
        .order('spend_date', { ascending: false })
        .limit(500);

    if (campaignId) query = query.eq('campaign_id', campaignId);
    if (from) query = query.gte('spend_date', from);
    if (to) query = query.lte('spend_date', to);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ rows: data || [] });
}

/**
 * POST /api/crm/campaigns/spend
 * Admin only — log a spend entry for a campaign.
 */
export async function POST(request: NextRequest) {
    const access = await resolveCrmAccess(request, readOrgId(request));
    if (isCrmAccessError(access)) return access;
    if (!access.isAdmin && !access.isMasterAdmin) {
        return NextResponse.json({ error: 'Only admins can log spend' }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    const parsed = CreateSpendSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json(
            { error: parsed.error.issues[0]?.message ?? 'Invalid body' },
            { status: 400 }
        );
    }

    // Verify campaign belongs to this org
    const { data: campaign, error: campErr } = await supabaseAdmin
        .from('crm_campaigns')
        .select('id, organization_id')
        .eq('id', parsed.data.campaign_id)
        .maybeSingle();
    if (campErr) return NextResponse.json({ error: campErr.message }, { status: 500 });
    if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    if (campaign.organization_id !== access.organizationId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data, error } = await supabaseAdmin
        .from('crm_campaign_spend')
        .insert({
            organization_id: access.organizationId,
            campaign_id: parsed.data.campaign_id,
            spend_date: parsed.data.spend_date,
            amount: parsed.data.amount,
            source: parsed.data.source,
            notes: parsed.data.notes ?? null,
            created_by: access.user.id,
        })
        .select('id, campaign_id, spend_date, amount, source, notes, created_at')
        .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ row: data }, { status: 201 });
}
