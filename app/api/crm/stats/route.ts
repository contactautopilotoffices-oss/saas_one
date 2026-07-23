import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveCrmAccess, isCrmAccessError, readOrgId } from '@/backend/lib/crm/access';
import { cityFilterOr } from '@/backend/lib/crm/cityGroups';

// GET /api/crm/stats?type=rep|admin
export async function GET(request: NextRequest) {
    const access = await resolveCrmAccess(request, readOrgId(request));
    if (isCrmAccessError(access)) return access;

    const { searchParams } = new URL(request.url);
    const requestedType = searchParams.get('type') || 'rep';
    const propertyId = searchParams.get('property_id');
    const userId = searchParams.get('user_id');
    const city = searchParams.get('city');
    const period = (searchParams.get('period') || 'all') as 'today' | 'week' | 'month' | 'all';
    const org = access.organizationId;

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const today = now.toISOString().split('T')[0];

    // Period window used by the 3-tile dashboards (New Leads / Followups Needed).
    const periodWindow = (() => {
        if (period === 'today') {
            const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
            const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).toISOString();
            return { from, to };
        }
        if (period === 'week') {
            const day = now.getDay();
            const mondayOffset = day === 0 ? 6 : day - 1;
            const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset);
            const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6, 23, 59, 59, 999);
            return { from: monday.toISOString(), to: sunday.toISOString() };
        }
        if (period === 'month') {
            const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).toISOString();
            return { from: startOfMonth, to };
        }
        return { from: '1970-01-01T00:00:00.000Z', to: '2999-12-31T23:59:59.999Z' };
    })();

    // New Leads = campaign leads created within the window (leads received from
    // active campaigns, not manually-created ones without a campaign tag).
    // Followups Needed = non-terminal with a follow-up due within the window.
    const computePeriodCounts = (leads: any[]) => {
        const inWindow = leads.filter(
            (l) => l.created_at && l.created_at >= periodWindow.from && l.created_at <= periodWindow.to
        );
        // "New leads" = leads freshly received in the period. For the Today view we
        // use a rolling 24h window (matching the "<24h NEW" badge on the Latest Leads
        // card) instead of strict calendar-midnight. We count ALL new leads — not only
        // campaign-tagged ones — because many leads (manual, import, untagged Meta)
        // have no campaign yet still showed up as NEW, which made this read 0.
        const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
        const newLeadPool = period === 'today'
            ? leads.filter((l) => l.created_at && l.created_at >= dayAgo)
            : inWindow;
        const campaignLeads = newLeadPool.filter((l) => l.campaign);

        // Per-campaign breakdown (only leads that actually carry a campaign tag).
        const campaignNewLeads: Record<string, number> = {};
        for (const l of campaignLeads) {
            campaignNewLeads[l.campaign] = (campaignNewLeads[l.campaign] || 0) + 1;
        }

        return {
            period,
            new_leads: newLeadPool.length,
            new_leads_by_campaign: Object.entries(campaignNewLeads).map(
                ([campaign, count]) => ({ campaign, count })
            ),
            followups_needed: leads.filter(
                (l) => !terminalIds.has(l.status) && l.next_followup_date &&
                    l.next_followup_date >= periodWindow.from && l.next_followup_date <= periodWindow.to
            ).length,
        };
    };

    // Load this org's status semantics ONCE (org rows + global defaults).
    const { data: statuses } = await supabaseAdmin
        .from('crm_lead_statuses')
        .select('id, name, color, sort_order, organization_id, is_won, is_lost, is_terminal')
        .or(`organization_id.eq.${org},organization_id.is.null`);
    const wonIds = new Set((statuses || []).filter((s) => s.is_won).map((s) => s.id));
    const lostIds = new Set((statuses || []).filter((s) => s.is_lost).map((s) => s.id));
    const terminalIds = new Set((statuses || []).filter((s) => s.is_terminal).map((s) => s.id));
    const statusNameById = new Map((statuses || []).map((s) => [s.id, s.name]));
    const hotStatusIds = new Set((statuses || []).filter((s) => /hot/i.test(s.name)).map((s) => s.id));
    const warmStatusIds = new Set((statuses || []).filter((s) => /warm|mql/i.test(s.name)).map((s) => s.id));
    const holdStatusIds = new Set((statuses || []).filter((s) => /future|hold/i.test(s.name)).map((s) => s.id));

    // Helper: compute the flat status-based dashboard counts from a lead array.
    const computeDashboardCounts = (leads: any[]) => ({
        total_leads: leads.length,
        hot_leads: leads.filter((l) => hotStatusIds.has(l.status)).length,
        warm_leads: leads.filter((l) => warmStatusIds.has(l.status)).length,
        lost_leads: leads.filter((l) => lostIds.has(l.status)).length,
        deals_open: leads.filter((l) => !terminalIds.has(l.status)).length,
        deals_in_progress: leads.filter(
            (l) => !terminalIds.has(l.status) && !wonIds.has(l.status) && l.next_followup_date
        ).length,
        deals_closed: leads.filter((l) => terminalIds.has(l.status)).length,
        overdue_followups: leads.filter(
            (l) => !terminalIds.has(l.status) && l.next_followup_date && new Date(l.next_followup_date) < now
        ).length,
        action_required: leads.filter(
            (l) => holdStatusIds.has(l.status) || (!l.status && !terminalIds.has(l.status))
        ).length,
    });

    // ---- Rep dashboard ---------------------------------------------------
    if (requestedType === 'rep' || !access.isAdmin) {
        const targetUserId = access.isAdmin && userId ? userId : access.user.id;
        // An admin viewing the rep dashboard with no specific user sees the WHOLE org
        // (otherwise they'd see 0 — admins typically have no leads assigned to them).
        const adminAllOrg = access.isAdmin && !userId;

        let leadsQ = supabaseAdmin
            .from('crm_leads')
            .select('id, status, deal_value, priority, company_name, contact_person, location, city, requirement, created_at, updated_at, next_followup_date, last_contacted, closed_at, is_archived, followup_notes, source_info:crm_lead_sources(id, name)')
            .eq('organization_id', org)
            .eq('is_archived', false);
        if (!adminAllOrg) leadsQ = leadsQ.eq('assigned_to', targetUserId);
        if (city) leadsQ = leadsQ.or(cityFilterOr([city]));
        const { data: leads } = await leadsQ;

        const all = (leads || []) as any[];
        const counts = computeDashboardCounts(all);

        // Top hot + warm leads for Priority Target list (sorted by created_at DESC)
        const priorityLeads = all
            .filter((l) => hotStatusIds.has(l.status) || warmStatusIds.has(l.status))
            .sort((a, b) => {
                // Hot before warm
                const aHot = hotStatusIds.has(a.status) ? 1 : 0;
                const bHot = hotStatusIds.has(b.status) ? 1 : 0;
                if (aHot !== bHot) return bHot - aHot;
                // Then most recent
                return (b.last_contacted || b.next_followup_date || '').localeCompare(
                    a.last_contacted || a.next_followup_date || ''
                );
            })
            .slice(0, 25)
            .map((l) => ({
                id: l.id,
                full_name: l.contact_person || l.company_name,
                company_name: l.company_name,
                location: l.location || l.city || null,
                status_name: statusNameById.get(l.status) || 'Unknown',
                last_update: l.last_contacted || null,
                next_followup_date: l.next_followup_date || null,
            }));

        // Action Required: Hold + NULL status
        const actionLeads = all
            .filter((l) => holdStatusIds.has(l.status) || (!l.status && !terminalIds.has(l.status)))
            .sort((a, b) =>
                (b.last_contacted || '').localeCompare(a.last_contacted || '')
            )
            .slice(0, 30)
            .map((l) => ({
                id: l.id,
                full_name: l.contact_person || l.company_name,
                company_name: l.company_name,
                location: l.location || l.city || null,
                status_name: statusNameById.get(l.status) || (l.status ? 'Unknown' : 'No Status'),
                last_update: l.last_contacted || null,
                next_followup_date: l.next_followup_date || null,
            }));

        let meetingsQ = supabaseAdmin
            .from('crm_events')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', org)
            .eq('event_type', 'meeting')
            .eq('status', 'scheduled')
            .gte('start_datetime', `${today}T00:00:00`)
            .lte('start_datetime', `${today}T23:59:59`);
        if (!adminAllOrg) meetingsQ = meetingsQ.eq('user_id', targetUserId);
        const { count: meetingsToday } = await meetingsQ;

        const todaysFollowups = all
            .filter((l) => l.next_followup_date && l.next_followup_date.startsWith(today) && !terminalIds.has(l.status))
            .sort((a, b) => (a.next_followup_date || '').localeCompare(b.next_followup_date || ''))
            .slice(0, 20)
            .map((l) => ({
                id: l.id,
                full_name: l.contact_person || l.company_name,
                company_name: l.company_name,
                next_followup_date: l.next_followup_date,
                followup_notes: l.followup_notes || null,
            }));

        // Most recent leads (newest first) for the "Latest Leads" card.
        const latestLeads = [...all]
            .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
            .slice(0, 6)
            .map((l) => ({
                id: l.id,
                full_name: l.contact_person || l.company_name || 'Unnamed Lead',
                company_name: l.company_name || null,
                requirement: l.requirement || null,
                location: l.location || l.city || null,
                status_name: statusNameById.get(l.status) || (l.status ? 'Unknown' : 'New'),
                created_at: l.created_at,
                last_contacted: l.last_contacted || null,
            }));

        // Stale leads: non-terminal and not touched (status/record un-updated) for
        // STALE_DAYS — "gone quiet, needs a nudge". updated_at is the proxy since
        // there's no dedicated status-change timestamp.
        const STALE_DAYS = 7;
        const staleCutoff = new Date(now.getTime() - STALE_DAYS * 86400000).toISOString();
        const staleLeads = all
            .filter((l) => !terminalIds.has(l.status) && (l.updated_at || l.created_at || '') < staleCutoff)
            .sort((a, b) => (a.updated_at || a.created_at || '').localeCompare(b.updated_at || b.created_at || ''))
            .slice(0, 10)
            .map((l) => ({
                id: l.id,
                full_name: l.contact_person || l.company_name || 'Unnamed Lead',
                company_name: l.company_name || null,
                status_name: statusNameById.get(l.status) || (l.status ? 'Unknown' : 'No Status'),
                last_activity: l.updated_at || l.created_at || null,
                next_followup_date: l.next_followup_date || null,
            }));

        return NextResponse.json({
            ...counts,
            ...computePeriodCounts(all),
            meetings_today: meetingsToday || 0,
            priority_leads: priorityLeads,
            action_leads: actionLeads,
            todays_followups: todaysFollowups,
            latest_leads: latestLeads,
            stale_leads: staleLeads,
            pipeline_value: 0,
            target_achievement_percent: 0,
            revenue_closed: 0,
        });
    }

    // ---- Admin dashboard (single pass, no N+1) ---------------------------
    let leadQ = supabaseAdmin
        .from('crm_leads')
        .select('id, status, deal_value, assigned_to, priority, company_name, contact_person, location, requirement, created_at, next_followup_date, last_contacted, property_interest, city, closed_at, campaign, cohort, property_info:properties(id, name), source_info:crm_lead_sources(id, name)')
        .eq('organization_id', org)
        .eq('is_archived', false);
    if (propertyId) leadQ = leadQ.eq('property_interest', propertyId);
    if (city) leadQ = leadQ.or(cityFilterOr([city]));
    const { data: allLeads } = await leadQ;
    const leads = (allLeads || []) as any[];

    const counts = computeDashboardCounts(leads);

    const propertyWise: Record<string, number> = {};
    const sourceWise: Record<string, number> = {};
    const cityWise: Record<string, number> = {};
    const campaignWise: Record<string, number> = {};
    const perUser: Record<string, { leads: number; hot: number; warm: number; lost: number; closures: number }> = {};

    for (const l of leads) {
        const propName = l.property_info?.name || 'Unassigned';
        propertyWise[propName] = (propertyWise[propName] || 0) + 1;

        if (l.source_info?.name) sourceWise[l.source_info.name] = (sourceWise[l.source_info.name] || 0) + 1;

        const city = l.location || l.city || 'Unspecified';
        cityWise[city] = (cityWise[city] || 0) + 1;

        if (l.campaign) {
            campaignWise[l.campaign] = (campaignWise[l.campaign] || 0) + 1;
        }

        if (l.assigned_to) {
            (perUser[l.assigned_to] ??= { leads: 0, hot: 0, warm: 0, lost: 0, closures: 0 });
            perUser[l.assigned_to].leads++;
            if (hotStatusIds.has(l.status)) perUser[l.assigned_to].hot++;
            if (warmStatusIds.has(l.status)) perUser[l.assigned_to].warm++;
            if (lostIds.has(l.status)) perUser[l.assigned_to].lost++;
            if (wonIds.has(l.status)) perUser[l.assigned_to].closures++;
        }
    }

    // One query for completed meetings, counted per user in JS.
    // Use the same period window as the rest of the stats so metrics align.
    const { data: meetings } = await supabaseAdmin
        .from('crm_events')
        .select('user_id')
        .eq('organization_id', org)
        .eq('event_type', 'meeting')
        .eq('status', 'completed')
        .gte('start_datetime', periodWindow.from)
        .lte('start_datetime', periodWindow.to);
    const meetingsByUser: Record<string, number> = {};
    for (const m of meetings || []) meetingsByUser[(m as any).user_id] = (meetingsByUser[(m as any).user_id] || 0) + 1;

    // Resolve user names in one query.
    const userIds = Object.keys(perUser);
    const { data: users } = userIds.length
        ? await supabaseAdmin.from('users').select('id, full_name').in('id', userIds)
        : { data: [] as any[] };
    const nameById = new Map((users || []).map((u: any) => [u.id, u.full_name]));

    // Top hot + warm leads across the org.
    const priorityLeads = leads
        .filter((l) => hotStatusIds.has(l.status) || warmStatusIds.has(l.status))
        .sort((a, b) => {
            const aHot = hotStatusIds.has(a.status) ? 1 : 0;
            const bHot = hotStatusIds.has(b.status) ? 1 : 0;
            if (aHot !== bHot) return bHot - aHot;
            return (b.last_contacted || b.next_followup_date || '').localeCompare(
                a.last_contacted || a.next_followup_date || ''
            );
        })
        .slice(0, 25)
        .map((l) => ({
            id: l.id,
            full_name: l.contact_person || l.company_name,
            company_name: l.company_name,
            campaign: l.campaign || null,
            location: l.location || l.city || null,
            status_name: statusNameById.get(l.status) || 'Unknown',
            poc: l.assigned_to ? nameById.get(l.assigned_to) || 'Unknown' : null,
            last_update: l.last_contacted || null,
            next_followup_date: l.next_followup_date || null,
        }));

    // Per-status breakdown for the overview card (sorted by sort_order)
    const statusCountMap: Record<string, number> = {};
    for (const l of leads) {
        if (l.status) statusCountMap[l.status] = (statusCountMap[l.status] || 0) + 1;
    }
    const statusBreakdown = (statuses || [])
        .filter((s) => s.organization_id === org || s.organization_id === null)
        .sort((a: any, b: any) => (a.sort_order ?? 999) - (b.sort_order ?? 999))
        .filter((s) => statusCountMap[s.id])
        .map((s: any) => ({
            status_id: s.id,
            status_name: s.name,
            color: s.color || '#64748B',
            count: statusCountMap[s.id] || 0,
        }));

    return NextResponse.json({
        ...counts,
        ...computePeriodCounts(leads),
        priority_leads: priorityLeads,
        status_breakdown: statusBreakdown,
        property_wise_leads: Object.entries(propertyWise).map(([name, count]) => ({ property_name: name, count })),
        lead_source_analytics: Object.entries(sourceWise).map(([name, count]) => ({ source_name: name, count })),
        territory_performance: Object.entries(cityWise).map(([city, count]) => ({ city, leads: count })),
        campaign_performance: Object.entries(campaignWise).map(([campaign, count]) => ({ campaign, leads: count })),
        user_performance: Object.entries(perUser).map(([uid, v]) => ({
            user_id: uid,
            user_name: nameById.get(uid) || 'Unknown',
            leads: v.leads,
            hot: v.hot,
            warm: v.warm,
            lost: v.lost,
            meetings: meetingsByUser[uid] || 0,
            closures: v.closures,
        })),
    });
}
