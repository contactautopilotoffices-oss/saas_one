/**
 * HOW AN ANSWER CHANGES THE NEXT SCAN.
 * -----------------------------------------------------------------------------
 * "Their feedback becomes training" is easy to claim and easy to fake. There are
 * exactly TWO mechanisms here, they work on different timescales, and both are
 * inspectable.
 *
 *   1. SUPPRESSION — takes effect on the VERY NEXT SCAN, no model involved.
 *      A finding closed as 'done' or 'not_an_issue' is not raised again. This is
 *      a database read the detector performs before it emits anything. It is
 *      deterministic, immediate, and cannot be undone by a model changing its
 *      mind. This is what stops Vidya seeing the same duplicate invoice daily.
 *
 *   2. PROMPT EVOLUTION — takes effect on the NEXT PROMPT VERSION, via a human.
 *      The note typed alongside the disposition lands in oem_agent_feedback as
 *      `guidance` with applied_to_prompt_version NULL. foldGuidance() drains that
 *      queue into a proposed prompt v(n+1); a person reviews the diff and commits
 *      it with save_prompt. This is what stops the agent raising the CLASS of
 *      finding, not just the instance.
 *
 * The split matters. Suppression must not wait on anyone reviewing a prompt diff,
 * and a prompt change must not happen because someone clicked a button on a phone.
 *
 * ── THE RE-RAISE RULE ───────────────────────────────────────────────────────
 * Suppression is not deletion. If a finding closed as 'done' reappears in a later
 * scan, the work did not hold — and that is more important than the original
 * finding. It comes back, escalated, carrying who closed it and when.
 * `not_an_issue` does NOT re-raise: a human judged the class wrong, and
 * overriding that would teach people their answers are ignored.
 */

import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import type { Finding } from './types';
import { closesLine, type Disposition } from './disposition';

export interface PriorDisposition {
    finding_key: string;
    disposition: Disposition;
    disposition_note: string | null;
    dispositioned_at: string | null;
    dispositioned_by_name: string | null;
    reopened_count: number;
}

export interface AppliedMemory {
    /** What survives to be emailed. */
    findings: Finding[];
    /** Closed and stayed closed. Not emailed — counted. */
    suppressed: string[];
    /** Closed as done, but the problem is back. Escalated. */
    reopened: string[];
    /** True when the findings store is not provisioned; nothing was suppressed. */
    degraded: boolean;
}

/**
 * Apply what people already answered to a fresh set of findings.
 *
 * Never throws. If the findings table is absent this returns every finding
 * unchanged with `degraded: true` — a scan that cannot read memory must still
 * report, it just must not pretend it remembered anything.
 */
export async function applyPriorDispositions(
    orgId: string,
    agentKey: string,
    findings: ReadonlyArray<Finding>,
): Promise<AppliedMemory> {
    const keys = findings.map((f) => f.key);
    if (!keys.length) return { findings: [], suppressed: [], reopened: [], degraded: false };

    const { data, error } = await supabaseAdmin
        .from('oem_agent_findings')
        .select('finding_key, disposition, disposition_note, dispositioned_at, reopened_count')
        .eq('organization_id', orgId)
        .eq('agent_key', agentKey)
        .in('finding_key', keys);

    if (error || !data) {
        return { findings: [...findings], suppressed: [], reopened: [], degraded: true };
    }

    const prior = new Map(data.map((r) => [String(r.finding_key), r as unknown as PriorDisposition]));
    const out: Finding[] = [];
    const suppressed: string[] = [];
    const reopened: string[] = [];

    for (const finding of findings) {
        const p = prior.get(finding.key);
        if (!p?.disposition || !closesLine(p.disposition)) {
            out.push(finding);
            continue;
        }

        if (p.disposition === 'not_an_issue') {
            // A human judged this class wrong. It stays gone.
            suppressed.push(finding.key);
            continue;
        }

        // 'done', but here it is again. The fix did not hold — that is the story now.
        reopened.push(finding.key);
        const when = p.dispositioned_at ? new Date(p.dispositioned_at).toLocaleDateString('en-IN') : 'earlier';
        out.push({
            ...finding,
            priority: 'critical',
            title: `${finding.title} — REOPENED`,
            problem:
                `${finding.problem}\n\nThis was marked done on ${when}` +
                (p.disposition_note ? ` ("${p.disposition_note}")` : '') +
                `, and it is back. The correction did not hold.`,
        });
    }

    return { findings: out, suppressed, reopened, degraded: false };
}

/**
 * Record this scan's findings so they can be answered, and so the NEXT scan can
 * tell a new problem from a returning one.
 *
 * Upserts on (organization_id, agent_key, finding_key) — the same problem next
 * week is the same row, which is the whole basis of closure. Never throws.
 */
/**
 * CLOSE WHAT IS NO LONGER TRUE.
 *
 * A finding is raised, somebody fixes the underlying problem, and the next scan
 * simply stops detecting it — but the row stays open for ever, because nothing
 * ever told it the cause was gone. It then keeps appearing in status lists and
 * gets quoted back as current.
 *
 * That is not hypothetical. "Purchase-order sync has not run for 24 days" was
 * raised on 5 September, the sync was run an hour later, and the finding was
 * still being repeated as fact two days on. I quoted it to the operator myself.
 *
 * So: an open finding that this scan did NOT re-detect is closed as
 * `not_an_issue` with a note saying the scan stopped seeing it and when. It is
 * marked as resolved by the agent, not by a person, so nobody gets credit for
 * work they did not report.
 *
 * DELIBERATELY NARROW. Only findings the scan could have re-detected are
 * eligible — the caller passes the keys this scan actually evaluated. A finding
 * that was not looked for is not evidence of anything, and closing it would be
 * a lie about coverage.
 */
export async function resolveVanishedFindings(
    orgId: string,
    agentKey: string,
    evaluatedKeys: ReadonlyArray<string>,
    stillPresentKeys: ReadonlyArray<string>,
): Promise<{ resolved: string[]; error?: string }> {
    const gone = evaluatedKeys.filter((k) => !stillPresentKeys.includes(k));
    if (!gone.length) return { resolved: [] };

    const { data, error } = await supabaseAdmin
        .from('oem_agent_findings')
        .update({
            disposition: 'not_an_issue',
            disposition_note: `Closed automatically: the scan on ${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })} no longer detects this. Nobody reported it fixed — the condition simply stopped being true.`,
            dispositioned_at: new Date().toISOString(),
            // dispositioned_by stays NULL: the agent closed this, not a person.
        })
        .eq('organization_id', orgId)
        .eq('agent_key', agentKey)
        .in('finding_key', gone)
        .is('disposition', null)
        .select('finding_key');

    if (error) return { resolved: [], error: error.message };
    return { resolved: (data ?? []).map((r) => String(r.finding_key)) };
}

export async function rememberFindings(
    orgId: string,
    agentKey: string,
    runId: string | null,
    findings: ReadonlyArray<Finding>,
): Promise<{ ok: boolean; error?: string }> {
    if (!findings.length) return { ok: true };
    const now = new Date().toISOString();

    const rows = findings.map((f) => ({
        organization_id: orgId,
        agent_key: agentKey,
        finding_key: f.key,
        priority: f.priority,
        title: f.title,
        vendor: f.vendor,
        property: f.property,
        amount: f.amount,
        problem: f.problem,
        // The records the finding points at, kept WITH the finding. Without
        // these a reply naming a PO number cannot be filed against anything,
        // and an answer to "which PO?" has nothing to cite.
        refs: f.refs ?? [],
        stats: f.stats ?? [],
        last_seen_at: now,
        last_run_id: runId,
    }));

    let { error } = await supabaseAdmin
        .from('oem_agent_findings')
        .upsert(rows, { onConflict: 'organization_id,agent_key,finding_key', ignoreDuplicates: false });

    // Degrade rather than lose the scan: a deployment without migration
    // 20260907000002 still records the finding, just without its evidence.
    if (error && /refs|stats/.test(error.message)) {
        const bare = rows.map(({ refs: _r, stats: _s, ...rest }) => rest);
        ({ error } = await supabaseAdmin
            .from('oem_agent_findings')
            .upsert(bare, { onConflict: 'organization_id,agent_key,finding_key', ignoreDuplicates: false }));
    }

    return error ? { ok: false, error: error.message } : { ok: true };
}


/**
 * What the team has already answered, for recipients who READ status rather than
 * set it. This is the executive half of the loop: Saniel sees "Done by Vidya —
 * credit note CN/2026/118" without touching anything.
 *
 * Resolves the responder's name so the email can say who, not a uuid. Never
 * throws; an unprovisioned or unreachable store yields an empty map and the
 * emails simply show every line as still open.
 */
export async function loadDispositionStatuses(
    orgId: string,
    agentKey: string,
    findingKeys: ReadonlyArray<string>,
): Promise<Record<string, {
    disposition: Disposition | null; by: string | null; at: string | null; note: string | null;
}>> {
    if (!findingKeys.length) return {};

    const { data, error } = await supabaseAdmin
        .from('oem_agent_findings')
        .select('finding_key, disposition, disposition_note, dispositioned_at, dispositioned_by')
        .eq('organization_id', orgId)
        .eq('agent_key', agentKey)
        .in('finding_key', findingKeys.slice(0, 200))
        .not('disposition', 'is', null);

    if (error || !data?.length) return {};

    // One lookup for every responder, rather than one per finding.
    const userIds = [...new Set(data.map((r) => r.dispositioned_by).filter(Boolean))] as string[];
    const names = new Map<string, string>();
    if (userIds.length) {
        const { data: users } = await supabaseAdmin
            .from('users').select('id, full_name').in('id', userIds);
        for (const u of users ?? []) names.set(String(u.id), String(u.full_name ?? '').split(' ')[0] || 'someone');
    }

    const out: Record<string, { disposition: Disposition | null; by: string | null; at: string | null; note: string | null }> = {};
    for (const r of data) {
        out[String(r.finding_key)] = {
            disposition: (r.disposition as Disposition) ?? null,
            by: r.dispositioned_by ? names.get(String(r.dispositioned_by)) ?? null : null,
            at: r.dispositioned_at
                ? new Date(String(r.dispositioned_at)).toLocaleDateString('en-IN', {
                      timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short',
                  })
                : null,
            note: (r.disposition_note as string) ?? null,
        };
    }
    return out;
}
