import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

/**
 * GET /api/admin/bd-stats
 *
 * Cross-organization Business-Development (BD) pipeline metrics for the
 * Master Admin console. NOT scoped to a single org — this is a platform-wide
 * view of the coworking-space lead pipeline.
 *
 * Master-admin only.
 *
 * Lead temperature mapping (counts only — the business does not track deal money):
 *   - Hot  : priority High/Urgent and status not terminal
 *   - Warm : priority Medium and status not terminal
 *   - Won  : status.is_won
 *   - Lost : status.is_terminal and not is_won
 */
export async function GET(_request: NextRequest) {
    try {
        // 1. Authenticate + verify master admin (mirrors app/api/admin/dashboard-stats).
        const supabase = await createClient();
        const { data: { user: currentUser }, error: authError } = await supabase.auth.getUser();

        if (authError || !currentUser) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { data: masterAdminCheck, error: checkError } = await supabaseAdmin
            .from('users')
            .select('is_master_admin')
            .eq('id', currentUser.id)
            .single();

        if (checkError || !masterAdminCheck?.is_master_admin) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const now = new Date();

        // 2. Status semantics across ALL orgs (incl. global defaults).
        const { data: statuses } = await supabaseAdmin
            .from('crm_lead_statuses')
            .select('id, name, is_won, is_terminal');
        const wonIds = new Set((statuses || []).filter((s) => s.is_won).map((s) => s.id));
        const terminalIds = new Set((statuses || []).filter((s) => s.is_terminal).map((s) => s.id));
        const statusNameById = new Map((statuses || []).map((s) => [s.id, s.name]));

        const priorityRank: Record<string, number> = { Urgent: 4, High: 3, Medium: 2, Low: 1 };
        const isHotPriority = (p?: string | null) => p === 'High' || p === 'Urgent';

        // 3. All non-archived leads across every org (single query, source joined).
        const { data: allLeads } = await supabaseAdmin
            .from('crm_leads')
            .select('id, status, assigned_to, priority, company_name, contact_person, location, city, requirement, next_followup_date, last_contacted, closed_at, organization_id, source_info:crm_lead_sources(id, name)')
            .eq('is_archived', false);

        const leads = (allLeads || []) as any[];

        // 4. Breakdown accumulators.
        const locationWise: Record<string, number> = {};
        const sourceWise: Record<string, number> = {};
        const perUser: Record<string, { leads: number; hot: number; won: number; followupsDue: number }> = {};

        let hotCount = 0;
        let warmCount = 0;
        let wonCount = 0;
        let lostCount = 0;
        let followupsDue = 0;

        const isFollowupDue = (l: any) =>
            !!l.next_followup_date && new Date(l.next_followup_date) <= now && !terminalIds.has(l.status);

        for (const l of leads) {
            const isTerminal = terminalIds.has(l.status);
            const isWon = wonIds.has(l.status);
            const hot = isHotPriority(l.priority) && !isTerminal;
            const warm = l.priority === 'Medium' && !isTerminal;
            const due = isFollowupDue(l);

            if (hot) hotCount++;
            if (warm) warmCount++;
            if (isWon) wonCount++;
            if (isTerminal && !isWon) lostCount++;
            if (due) followupsDue++;

            const loc = l.location || l.city || 'Unspecified';
            locationWise[loc] = (locationWise[loc] || 0) + 1;

            const srcName = l.source_info?.name || 'Unknown';
            sourceWise[srcName] = (sourceWise[srcName] || 0) + 1;

            if (l.assigned_to) {
                (perUser[l.assigned_to] ??= { leads: 0, hot: 0, won: 0, followupsDue: 0 });
                perUser[l.assigned_to].leads++;
                if (hot) perUser[l.assigned_to].hot++;
                if (isWon) perUser[l.assigned_to].won++;
                if (due) perUser[l.assigned_to].followupsDue++;
            }
        }

        // 5. Resolve POC (assigned_to) names in ONE query (no N+1).
        const userIds = Object.keys(perUser);
        const { data: users } = userIds.length
            ? await supabaseAdmin.from('users').select('id, full_name').in('id', userIds)
            : { data: [] as any[] };
        const nameById = new Map((users || []).map((u: any) => [u.id, u.full_name]));

        // 6. Resolve org names/codes for linking (one query).
        const orgIds = Array.from(new Set(leads.map((l) => l.organization_id).filter(Boolean)));
        const { data: orgs } = orgIds.length
            ? await supabaseAdmin.from('organizations').select('id, name, code').in('id', orgIds)
            : { data: [] as any[] };
        const orgById = new Map((orgs || []).map((o: any) => [o.id, o]));

        // 7. Hot / priority leads table (most-recent, highest-priority first).
        const hotLeads = leads
            .filter((l) => isHotPriority(l.priority) && !terminalIds.has(l.status))
            .sort((a, b) => {
                const pr = (priorityRank[b.priority] || 0) - (priorityRank[a.priority] || 0);
                if (pr !== 0) return pr;
                const at = a.last_contacted || a.next_followup_date || '';
                const bt = b.last_contacted || b.next_followup_date || '';
                return String(bt).localeCompare(String(at));
            })
            .slice(0, 15)
            .map((l) => {
                const org = orgById.get(l.organization_id);
                return {
                    id: l.id,
                    company_name: l.company_name || null,
                    contact_person: l.contact_person || null,
                    location: l.location || l.city || null,
                    source_name: l.source_info?.name || null,
                    poc: l.assigned_to ? nameById.get(l.assigned_to) || 'Unknown' : null,
                    status_name: statusNameById.get(l.status) || 'Unknown',
                    priority: l.priority || null,
                    next_followup_date: l.next_followup_date || null,
                    organization_id: l.organization_id || null,
                    organization_code: org?.code || null,
                };
            });

        // 8. Rep performance, sorted by lead volume desc.
        const repPerformance = Object.entries(perUser)
            .map(([uid, v]) => ({
                user_id: uid,
                user_name: nameById.get(uid) || 'Unknown',
                total_leads: v.leads,
                hot: v.hot,
                won: v.won,
                followups_due: v.followupsDue,
            }))
            .sort((a, b) => b.total_leads - a.total_leads);

        const byLocation = Object.entries(locationWise)
            .map(([location, count]) => ({ location, count }))
            .sort((a, b) => b.count - a.count);

        const bySource = Object.entries(sourceWise)
            .map(([source_name, count]) => ({ source_name, count }))
            .sort((a, b) => b.count - a.count);

        return NextResponse.json({
            kpis: {
                total_leads: leads.length,
                hot_leads: hotCount,
                warm_leads: warmCount,
                lost_leads: lostCount,
                won_leads: wonCount,
                followups_due: followupsDue,
            },
            by_location: byLocation,
            by_source: bySource,
            rep_performance: repPerformance,
            hot_leads: hotLeads,
        });
    } catch (error) {
        console.error('BD stats API error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
