import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveCrmAccess, isCrmAccessError, readOrgId } from '@/backend/lib/crm/access';
import { fetchTerritories, territoryCoversLead } from '@/backend/lib/crm/distribution';

/**
 * POST /api/crm/distribution/reassign  (admin only)
 *
 * Bulk-fixes cross-territory mis-assignments: finds open leads whose currently-
 * assigned rep has a territory that clearly does NOT cover the lead's market, and
 * moves them to a rep whose territory does (round-robin) — or leaves them
 * unassigned if no in-territory rep exists.
 *
 * Preview by default (no writes). Pass { apply: true } to perform the moves.
 * Leads on reps with NO territory configured are left untouched (we can't say
 * they're wrong), and leads with no city/campaign are skipped (market unknown).
 */
export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => ({} as any));
    const apply = body?.apply === true;

    const access = await resolveCrmAccess(request, readOrgId(request, body));
    if (isCrmAccessError(access)) return access;
    if (!access.isAdmin) return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });
    const org = access.organizationId;

    // Terminal statuses to exclude — don't churn closed/won/lost leads.
    const { data: statuses } = await supabaseAdmin
        .from('crm_lead_statuses').select('id, is_terminal')
        .or(`organization_id.eq.${org},organization_id.is.null`);
    const terminalIds = new Set((statuses || []).filter((s) => s.is_terminal).map((s) => s.id));

    // Candidate reassignment targets = active org BD members (+ display names).
    const [pm, om] = await Promise.all([
        supabaseAdmin.from('property_memberships')
            .select('user_id, user_info:users(id, full_name, email)')
            .eq('organization_id', org).eq('is_active', true),
        supabaseAdmin.from('organization_memberships')
            .select('user_id, user_info:users(id, full_name, email)')
            .eq('organization_id', org).eq('is_active', true),
    ]);
    const nameById = new Map<string, string>();
    const memberIds: string[] = [];
    for (const m of [...(pm.data || []), ...(om.data || [])] as any[]) {
        if (!m.user_id || nameById.has(m.user_id)) continue;
        nameById.set(m.user_id, m.user_info?.full_name || m.user_info?.email || 'Unknown');
        memberIds.push(m.user_id);
    }

    // Open, assigned, non-archived leads.
    const { data: leads } = await supabaseAdmin
        .from('crm_leads')
        .select('id, company_name, contact_person, city, location, campaign, assigned_to, status')
        .eq('organization_id', org)
        .eq('is_archived', false)
        .not('assigned_to', 'is', null);
    const candidateLeads = (leads || []).filter((l) => !terminalIds.has(l.status));

    const assignedIds = candidateLeads.map((l) => l.assigned_to).filter(Boolean) as string[];
    const terrMap = await fetchTerritories([...assignedIds, ...memberIds]);

    // Resolve names for current assignees who aren't in the member list.
    const missingNames = [...new Set(assignedIds.filter((id) => !nameById.has(id)))];
    if (missingNames.length) {
        const { data: us } = await supabaseAdmin.from('users').select('id, full_name, email').in('id', missingNames);
        for (const u of us || []) nameById.set(u.id, u.full_name || u.email || 'Unknown');
    }

    // Round-robin load counter so reassignments spread evenly across eligible reps.
    const load = new Map<string, number>();
    const pickTarget = (campaign: string | null, city: string | null): string | null => {
        const eligible = memberIds.filter((uid) =>
            territoryCoversLead(terrMap.get(uid), campaign, city, true /* requireExplicit */));
        if (eligible.length === 0) return null;
        eligible.sort((a, b) => (load.get(a) || 0) - (load.get(b) || 0));
        const chosen = eligible[0];
        load.set(chosen, (load.get(chosen) || 0) + 1);
        return chosen;
    };

    const reassignments: Array<{
        lead_id: string; name: string; city: string | null;
        from_id: string; from_name: string; to_id: string | null; to_name: string | null;
    }> = [];

    for (const l of candidateLeads) {
        const cityVal = l.city || l.location || null;
        if (!cityVal && !l.campaign) continue; // market unknown → leave alone

        const cur = terrMap.get(l.assigned_to);
        const curEmpty = !cur || (cur.cities.length === 0 && cur.campaigns.length === 0);
        if (curEmpty) continue; // no-territory rep → can't say it's wrong
        if (territoryCoversLead(cur, l.campaign, cityVal)) continue; // correctly assigned

        const to = pickTarget(l.campaign, cityVal);
        reassignments.push({
            lead_id: l.id,
            name: l.company_name || l.contact_person || 'Lead',
            city: cityVal,
            from_id: l.assigned_to,
            from_name: nameById.get(l.assigned_to) || 'Unknown',
            to_id: to,
            to_name: to ? (nameById.get(to) || 'Unknown') : null,
        });
    }

    if (apply && reassignments.length) {
        // Group by destination for fewer UPDATEs.
        const byTarget = new Map<string | null, string[]>();
        for (const r of reassignments) {
            const arr = byTarget.get(r.to_id) || [];
            arr.push(r.lead_id);
            byTarget.set(r.to_id, arr);
        }
        for (const [to, ids] of byTarget) {
            await supabaseAdmin.from('crm_leads').update({ assigned_to: to }).in('id', ids);
        }
    }

    return NextResponse.json({
        applied: apply,
        checked: candidateLeads.length,
        misassigned: reassignments.length,
        moved: reassignments.filter((r) => r.to_id).length,
        unassigned: reassignments.filter((r) => !r.to_id).length,
        reassignments,
    });
}
