/**
 * REPORTING TO THE COUNCIL — what an agent escalates, and what it merely logs.
 * -----------------------------------------------------------------------------
 * oem_council_log is the board an org reviews. Writing every finding there would
 * make it as unreadable as the digest was before routing, so this is selective
 * and the selection rule is stated rather than tuned:
 *
 *   ESCALATION   a critical finding nobody has answered for AGE_DAYS.
 *                Not "it is big" — big is normal. The signal is that it was put
 *                in front of someone who can act and nothing happened.
 *
 *   NOTE         one line per run: what was found, closed, suppressed, reopened.
 *                This is the audit trail that lets someone reconstruct why the
 *                board looks the way it does.
 *
 * WHY REOPENED COUNTS DOUBLE. A finding closed as done that came back is worse
 * than one never actioned — someone reported work that did not hold. Those
 * escalate immediately, without waiting out AGE_DAYS.
 *
 * Never throws. The council board is a reporting surface; failing to write to it
 * must not fail the scan that produced the findings.
 */

import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import type { Finding } from './types';

/** How long a critical finding may sit unanswered before the board hears about it. */
export const ESCALATE_AFTER_DAYS = 3;

export interface CouncilReport {
    escalated: string[];
    noted: boolean;
    skipped: string[];
    error?: string;
}

interface AgedFinding {
    finding_key: string;
    title: string;
    amount: number | null;
    priority: string;
    first_seen_at: string;
    times_seen: number;
    reopened_count: number;
}

function daysSince(iso: string): number {
    return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

/**
 * Escalate what has gone unanswered, and log the run.
 *
 * `reopened` comes from applyPriorDispositions — those bypass the age rule.
 */
export async function reportToCouncil(
    orgId: string,
    agentKey: string,
    findings: ReadonlyArray<Finding>,
    memory: { suppressed: string[]; reopened: string[] },
): Promise<CouncilReport> {
    const out: CouncilReport = { escalated: [], noted: false, skipped: [] };

    // Which open findings are old enough — or have come back — to escalate.
    const { data: rows, error } = await supabaseAdmin
        .from('oem_agent_findings')
        .select('finding_key, title, amount, priority, first_seen_at, times_seen, reopened_count')
        .eq('organization_id', orgId)
        .eq('agent_key', agentKey)
        .is('disposition', null);

    if (error) { out.error = error.message; return out; }

    const aged = (rows ?? []) as unknown as AgedFinding[];
    const inThisScan = new Set(findings.map((f) => f.key));

    for (const f of aged) {
        if (!inThisScan.has(f.finding_key)) continue;

        const isReopened = memory.reopened.includes(f.finding_key) || (f.reopened_count ?? 0) > 0;
        const age = daysSince(f.first_seen_at);
        const critical = f.priority === 'critical';

        if (!isReopened && !(critical && age >= ESCALATE_AFTER_DAYS)) {
            out.skipped.push(`${f.finding_key} (day ${age}, ${f.priority})`);
            continue;
        }

        // One escalation per finding, ever. A board re-told the same thing daily
        // stops reading it — which is the failure this whole exercise is about.
        const { data: already } = await supabaseAdmin
            .from('oem_council_log')
            .select('id')
            .eq('organization_id', orgId)
            .eq('agent_key', agentKey)
            .eq('review_type', 'escalation')
            .contains('details', { finding_key: f.finding_key })
            .limit(1);
        if (already?.length) { out.skipped.push(`${f.finding_key} (already escalated)`); continue; }

        const money = f.amount ? ` — ₹${Math.round(Number(f.amount)).toLocaleString('en-IN')}` : '';
        const { error: insErr } = await supabaseAdmin.from('oem_council_log').insert({
            organization_id: orgId,
            agent_key: agentKey,
            review_type: 'escalation',
            decision: 'needs_human',
            decided_by: 'council',
            summary: isReopened
                ? `Reopened after being marked done: ${f.title}${money}`
                : `Unanswered for ${age} days: ${f.title}${money}`,
            details: {
                finding_key: f.finding_key,
                priority: f.priority,
                amount: f.amount,
                first_seen_at: f.first_seen_at,
                days_open: age,
                times_seen: f.times_seen,
                reopened: isReopened,
                // Why it reached the board, in the row itself, so nobody has to
                // reverse-engineer the rule later.
                reason: isReopened
                    ? 'Closed as done and seen again — the correction did not hold.'
                    : `Critical and unanswered for ${age} days (threshold ${ESCALATE_AFTER_DAYS}).`,
            },
        });
        if (insErr) { out.error = insErr.message; continue; }
        out.escalated.push(f.finding_key);
    }

    // --- the run note --------------------------------------------------------
    const crit = findings.filter((f) => f.priority === 'critical').length;
    const exposure = findings.reduce((s, f) => s + (f.amount ?? 0), 0);
    const { error: noteErr } = await supabaseAdmin.from('oem_council_log').insert({
        organization_id: orgId,
        agent_key: agentKey,
        review_type: 'note',
        decision: 'approved',
        decided_by: 'council',
        summary:
            `${findings.length} finding(s), ${crit} critical` +
            (exposure ? `, ₹${(exposure / 100000).toFixed(2)}L exposure` : '') +
            `. ${memory.suppressed.length} stayed closed, ${memory.reopened.length} reopened, ` +
            `${out.escalated.length} escalated.`,
        details: {
            findings: findings.length,
            critical: crit,
            exposure_inr: Math.round(exposure),
            suppressed: memory.suppressed,
            reopened: memory.reopened,
            escalated: out.escalated,
        },
    });
    out.noted = !noteErr;
    if (noteErr) out.error = noteErr.message;

    return out;
}
