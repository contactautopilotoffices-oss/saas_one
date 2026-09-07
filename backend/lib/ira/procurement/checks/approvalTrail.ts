/**
 * CHECK — is approved spend backed by a record of who approved it?
 * -----------------------------------------------------------------------------
 * Structural. An order marked approved in Zoho with no row in po_workflow_state
 * has its approval in a status field and nowhere auditable: no approver, no
 * time, nothing to show anyone who asks later.
 *
 * ── AGENT SPEC BLOCK (doctrine §3) ───────────────────────────────────────────
 *   Task boundary   one question: how much approved spend has no approval row  [BAA p.104]
 *   Tools           none — a count on po_workflow_state                        [BAA p.94]
 *   Failure mode    a failed count returns skipped, not a finding claiming zero
 *                   trail for everything                                       [BAA p.94]
 *   Memory          none — re-derived every run                                [BAA p.103]
 *   Evaluation      both sides of the comparison are counts, not estimates     [BAA p.95]
 *   Known deviation the comparison is COUNT vs COUNT across two tables, not a
 *                   join, so it detects the size of the gap and not which
 *                   specific orders are missing a trail. Naming them needs the
 *                   join; until then the finding says the number and not the
 *                   list.                                                      [BAA p.96]
 */

import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import type { Check, CheckContext, CheckOutcome } from './contract';
import { num } from './contract';
import type { Finding } from '../types';

export const approvalTrail: Check = {
    id: 'approved-without-workflow-state',
    question: 'Is there approved spend with no recorded approval trail?',
    nature: 'structural',
    needs: ['pos', 'workflow'],

    async run(ctx: CheckContext): Promise<CheckOutcome> {
        if (ctx.window && ctx.window.cadence === 'daily') {
            return { findings: [], skipped: 'structural — reported on weekly and slower cadences, not daily' };
        }

        const approved = ctx.live.filter((r) => String(r.status) === 'approved');
        if (!approved.length) {
            return { findings: [], cleared: { looked: 0, unit: 'approved orders', note: 'nothing is in an approved state' } };
        }

        const { count, error } = await supabaseAdmin
            .from('po_workflow_state')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', ctx.orgId);

        // Without the count there is no comparison. Saying nothing is right;
        // claiming every approval is untracked would be a fabrication.
        if (error) return { findings: [], skipped: `approval-trail table unavailable: ${error.message}` };

        const tracked = count ?? 0;
        const untracked = approved.length - tracked;
        if (untracked <= 0) {
            return {
                findings: [],
                cleared: { looked: approved.length, unit: 'approved orders', note: `all ${approved.length} carry an approval row` },
            };
        }

        const value = approved.reduce((s, r) => s + num(r.po_amount), 0);

        const finding: Finding = {
            key: 'approved-without-workflow-state',
            priority: 'critical',
            title: `${untracked.toLocaleString('en-IN')} approved POs have no recorded approval trail`,
            vendor: null,
            property: null,
            amount: value,
            exposure: 'none',
            problem:
                `${approved.length.toLocaleString('en-IN')} POs are marked approved, but only ${tracked} have a row in po_workflow_state. ` +
                `For the rest there is no record of who approved them or when — the approval exists in Zoho's status field and nowhere auditable.`,
            refs: [],
            reconcile: [{
                what: 'Approved orders vs approval records',
                expected: approved.length.toLocaleString('en-IN'),
                actual: tracked.toLocaleString('en-IN'),
                gap: `${untracked.toLocaleString('en-IN')} with no trail`,
            }],
            counter: 'The fair counter is that the trail legitimately starts from the day this app took over approvals, and everything before it was approved in Zoho by design. That is a decision, not a defect — but it has to be stated once.',
            ask: 'Decide whether historic approvals need back-filling or whether the trail starts from a stated date — say which date.',
            stats: [
                { label: 'Approved POs', value: approved.length.toLocaleString('en-IN') },
                { label: 'With a trail', value: String(tracked) },
                { label: 'Value', value: `₹${(value / 10000000).toFixed(2)}Cr` },
            ],
            actions: [
                { recipient: 'ceo', action: 'Decide whether historic POs need a back-filled approval record, or whether the trail starts from today.', deadline: 'This week' },
                { recipient: 'technical', action: 'Write po_workflow_state on every approval path, including the Zoho sync, so the trail cannot be skipped.', deadline: 'This sprint' },
            ],
        };

        return { findings: [finding], cleared: null };
    },
};
