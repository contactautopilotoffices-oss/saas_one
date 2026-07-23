import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveCrmAccess, isCrmAccessError, readOrgId, scopeLeadsQuery } from '@/backend/lib/crm/access';

// GET /api/crm/reports?type=monthly|quarterly|user|property|source|status|revenue
export async function GET(request: NextRequest) {
    const access = await resolveCrmAccess(request, readOrgId(request));
    if (isCrmAccessError(access)) return access;
    const org = access.organizationId;

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'monthly';
    const dateFrom = searchParams.get('from');
    const dateTo = searchParams.get('to');
    const userId = searchParams.get('user_id');
    const propertyId = searchParams.get('property_id');
    const channel = searchParams.get('channel'); // meta_ads | linkedin_ads | google_ads | null(all)

    // Resolve which lead-source ids belong to the requested channel (indexed).
    let channelSourceIds: string[] | null = null;
    if (channel && channel !== 'all') {
        const { data: srcs } = await supabaseAdmin
            .from('crm_lead_sources').select('id')
            .eq('channel', channel)
            .or(`organization_id.eq.${org},organization_id.is.null`);
        channelSourceIds = (srcs || []).map((s) => s.id);
        if (channelSourceIds.length === 0) channelSourceIds = ['00000000-0000-0000-0000-000000000000'];
    }

    // Status semantics for this org.
    const { data: statuses } = await supabaseAdmin
        .from('crm_lead_statuses')
        .select('id, is_won, is_lost')
        .or(`organization_id.eq.${org},organization_id.is.null`);
    const wonIds = new Set((statuses || []).filter((s) => s.is_won).map((s) => s.id));
    const lostIds = new Set((statuses || []).filter((s) => s.is_lost).map((s) => s.id));

    let query = supabaseAdmin
        .from('crm_leads')
        .select(`
            id, status, deal_value, created_at, closed_at, assigned_to, city,
            status_info:crm_lead_statuses(id, name, color, is_won, is_lost),
            source_info:crm_lead_sources(id, name),
            assigned_user:users!crm_leads_assigned_to_fkey(id, full_name),
            property_info:properties(id, name)
        `);
    // Reps see only their visible slice; admins see the whole org.
    query = scopeLeadsQuery(query, access);
    if (dateFrom) query = query.gte('created_at', dateFrom);
    if (dateTo) query = query.lte('created_at', dateTo);
    if (userId && access.isAdmin) query = query.eq('assigned_to', userId);
    if (propertyId) query = query.eq('property_interest', propertyId);
    if (channelSourceIds) query = query.in('lead_source', channelSourceIds);

    const { data: leads, error } = await query;
    if (error) {
        console.error('CRM Reports error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const rows = (leads || []) as any[];
    const isWon = (l: any) => wonIds.has(l.status);
    const isLost = (l: any) => lostIds.has(l.status);
    const reports: Record<string, any> = {};

    if (type === 'monthly' || type === 'quarterly') {
        const funnel: Record<string, { count: number; value: number }> = {};
        const monthly: Record<string, { leads: number; value: number }> = {};
        for (const l of rows) {
            const status = l.status_info?.name || 'Unknown';
            (funnel[status] ??= { count: 0, value: 0 });
            funnel[status].count++;
            funnel[status].value += Number(l.deal_value || 0);
            const month = new Date(l.created_at).toLocaleString('en-US', { month: 'short', year: 'numeric' });
            (monthly[month] ??= { leads: 0, value: 0 });
            monthly[month].leads++;
            monthly[month].value += Number(l.deal_value || 0);
        }
        reports.funnel = funnel;
        reports.monthly_trend = Object.entries(monthly)
            .map(([month, d]) => ({ month, ...d }))
            .sort((a, b) => new Date(a.month).getTime() - new Date(b.month).getTime());
    }

    if (type === 'user') {
        const byUser: Record<string, any> = {};
        for (const l of rows) {
            const name = l.assigned_user?.full_name || 'Unassigned';
            (byUser[name] ??= { name, total_leads: 0, won_leads: 0, lost_leads: 0, pipeline_value: 0, revenue_closed: 0 });
            byUser[name].total_leads++;
            byUser[name].pipeline_value += Number(l.deal_value || 0);
            if (isWon(l)) { byUser[name].won_leads++; byUser[name].revenue_closed += Number(l.deal_value || 0); }
            else if (isLost(l)) byUser[name].lost_leads++;
        }
        reports.user_performance = Object.values(byUser);
    }

    if (type === 'property') {
        const byProp: Record<string, any> = {};
        for (const l of rows) {
            const name = l.property_info?.name || 'Unassigned';
            (byProp[name] ??= { name, total_leads: 0, won_leads: 0, pipeline_value: 0, revenue_closed: 0 });
            byProp[name].total_leads++;
            byProp[name].pipeline_value += Number(l.deal_value || 0);
            if (isWon(l)) { byProp[name].won_leads++; byProp[name].revenue_closed += Number(l.deal_value || 0); }
        }
        reports.property_performance = Object.values(byProp);
    }

    if (type === 'source') {
        const bySource: Record<string, any> = {};
        for (const l of rows) {
            const name = l.source_info?.name || 'Unknown';
            (bySource[name] ??= { name, count: 0, value: 0, conversions: 0 });
            bySource[name].count++;
            bySource[name].value += Number(l.deal_value || 0);
            if (isWon(l)) bySource[name].conversions++;
        }
        reports.source_analytics = Object.values(bySource);
    }

    if (type === 'status') {
        const byStatus: Record<string, any> = {};
        for (const l of rows) {
            const name = l.status_info?.name || 'Unknown';
            (byStatus[name] ??= { name, color: l.status_info?.color || '#6B7280', count: 0, value: 0 });
            byStatus[name].count++;
            byStatus[name].value += Number(l.deal_value || 0);
        }
        reports.status_distribution = Object.values(byStatus);
    }

    if (type === 'revenue') {
        const won = rows.filter(isWon);
        reports.total_revenue = won.reduce((s, l) => s + Number(l.deal_value || 0), 0);
        reports.deals_won = won.length;
        reports.average_deal_size = won.length ? reports.total_revenue / won.length : 0;
    }

    return NextResponse.json({
        type,
        generated_at: new Date().toISOString(),
        total_leads: rows.length,
        total_value: rows.reduce((s, l) => s + Number(l.deal_value || 0), 0),
        ...reports,
    });
}
