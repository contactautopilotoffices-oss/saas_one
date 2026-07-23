import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveCrmAccess, isCrmAccessError, readOrgId } from '@/backend/lib/crm/access';

/**
 * GET /api/crm/accounts  — real account-based (ABM) aggregation.
 * Groups the org's leads by company and returns the top accounts with REAL
 * signals: people engaged, pipeline (sum of deal_value), hot-lead count,
 * activity count, dominant city, and the most-advanced status. No placeholders.
 */
export async function GET(request: NextRequest) {
    const access = await resolveCrmAccess(request, readOrgId(request));
    if (isCrmAccessError(access)) return access;
    const org = access.organizationId;

    const { searchParams } = new URL(request.url);
    const limit = Math.min(25, Math.max(1, parseInt(searchParams.get('limit') || '8')));

    // Status semantics (hot / terminal / won / sort order) for this org.
    const { data: statuses } = await supabaseAdmin
        .from('crm_lead_statuses')
        .select('id, name, sort_order, is_won, is_lost, is_terminal')
        .or(`organization_id.eq.${org},organization_id.is.null`);
    const statusById = new Map((statuses || []).map((s) => [s.id, s]));
    const isHot = (sid: string) => /hot/i.test(statusById.get(sid)?.name || '');
    const isWarm = (sid: string) => /warm|mql/i.test(statusById.get(sid)?.name || '');

    // Org leads.
    let leadsQ = supabaseAdmin
        .from('crm_leads')
        .select('id, company_name, contact_person, deal_value, status, city, location, last_contacted, updated_at, created_at')
        .eq('organization_id', org)
        .eq('is_archived', false);
    // Reps only see their own; admins (the CEO portal) see the whole org.
    if (!access.isAdmin) leadsQ = leadsQ.eq('assigned_to', access.user.id);
    const { data: leads } = await leadsQ;

    // Aggregate by company.
    const acc = new Map<string, any>();
    for (const l of (leads || []) as any[]) {
        const name = (l.company_name || '').trim();
        if (!name) continue;
        const key = name.toLowerCase();
        let a = acc.get(key);
        if (!a) { a = { account: name, leadIds: [], people: 0, pipeline: 0, hot: 0, warm: 0, cities: {}, lastActivity: null, bestStatus: null, bestSort: -1 }; acc.set(key, a); }
        a.people++;
        a.leadIds.push(l.id);
        a.pipeline += Number(l.deal_value || 0);
        if (isHot(l.status)) a.hot++;
        if (isWarm(l.status)) a.warm++;
        const c = (l.city || l.location || '').trim();
        if (c) a.cities[c] = (a.cities[c] || 0) + 1;
        const ts = l.last_contacted || l.updated_at || l.created_at;
        if (ts && (!a.lastActivity || ts > a.lastActivity)) a.lastActivity = ts;
        // most-advanced (highest sort_order, non-lost) status seen
        const st = statusById.get(l.status);
        if (st && !st.is_lost && (st.sort_order ?? 0) > a.bestSort) { a.bestSort = st.sort_order ?? 0; a.bestStatus = st.name; }
    }

    // Rank: hottest first, then most people, then pipeline.
    const ranked = Array.from(acc.values())
        .sort((a, b) => (b.hot - a.hot) || (b.people - a.people) || (b.pipeline - a.pipeline))
        .slice(0, limit);

    // Real activity counts for the top accounts only (bounded query).
    const topLeadIds = ranked.flatMap((a) => a.leadIds);
    const activityByLead: Record<string, number> = {};
    if (topLeadIds.length) {
        const { data: acts } = await supabaseAdmin
            .from('crm_activity_log')
            .select('lead_id')
            .in('lead_id', topLeadIds.slice(0, 1000));
        for (const r of (acts || []) as any[]) activityByLead[r.lead_id] = (activityByLead[r.lead_id] || 0) + 1;
    }

    const accounts = ranked.map((a) => {
        const activities = a.leadIds.reduce((s: number, id: string) => s + (activityByLead[id] || 0), 0);
        const city = Object.entries(a.cities).sort((x: any, y: any) => y[1] - x[1])[0]?.[0] || null;
        // Engagement 0-100 from real signals: people, activities, hot share, recency.
        const recencyDays = a.lastActivity ? (Date.now() - new Date(a.lastActivity).getTime()) / 86400000 : 999;
        const recencyScore = Math.max(0, 1 - recencyDays / 60);           // fresh ≤60d
        const raw = a.people * 6 + activities * 8 + a.hot * 15 + recencyScore * 25;
        const engagement = Math.min(100, Math.round(raw));
        const tier = (a.hot > 0 || a.pipeline > 0 || a.people >= 3) ? 1 : 2;
        return {
            account: a.account,
            tier,
            engagement,
            people: a.people,
            activities,
            pipeline: a.pipeline,
            hot: a.hot,
            city,
            top_status: a.bestStatus,
            last_activity: a.lastActivity,
        };
    });

    return NextResponse.json({ accounts });
}
