/**
 * DETECTOR — findings from the PO database.
 * -----------------------------------------------------------------------------
 * WIRING STATUS, stated plainly: the findings below are the ones from Ira's real
 * 04-Sep-2026 procurement run, encoded as a fixture so the routing, rendering and
 * dispatch layers can be exercised end to end today. They are REAL findings; they
 * are not, right now, RE-DERIVED from live SQL on each call.
 *
 * That distinction is why `grounded` is false on the run report — the same honesty
 * rule dailyDigest.ts follows while getDailyTasks() still returns seeds.
 *
 * TO GO LIVE: replace fixtureFindings() with queries over zoho_purchase_orders,
 * po_workflow_state and material_request_comparatives, and resolve refs[].id from
 * those rows so the deep links light up. The contract does not change — everything
 * downstream already consumes `Finding[]`.
 */

import type { Finding } from './types';

/**
 * Ira's findings from the 04-Sep-2026 run.
 *
 * Note how ONE finding carries DIFFERENT actions for different people — the
 * duplicate-invoice case asks the CEO for a payment decision and procurement for
 * a credit note. That asymmetry is the whole point of the routing layer.
 */
export function fixtureFindings(): Finding[] {
    return [
        {
            key: 'one-solution-duplicate-invoice',
            priority: 'critical',
            title: 'One Solution — possible duplicate payment',
            vendor: 'One Solution',
            property: 'Mafatlal WS B-Wing',
            amount: 74436.35,
            problem:
                'The same invoice reference (OSS/055/05/2627) appears on two separately approved POs. Both are in an approved state, so a second payment may already have gone out.',
            refs: [
                { kind: 'po', label: 'PO-26/27-0323', id: null },
                { kind: 'po', label: 'PO-26/27-0363', id: null },
                { kind: 'invoice', label: 'OSS/055/05/2627', id: null },
            ],
            stats: [
                { label: 'PO-0323', value: '₹74,436.19' },
                { label: 'PO-0363', value: '₹74,436.35' },
                { label: 'Status', value: 'Both approved' },
            ],
            actions: [
                {
                    recipient: 'ceo',
                    action: 'Confirm whether this was paid twice. If yes, approve raising a debit note for ₹74,436.35.',
                    deadline: 'Today',
                },
                {
                    recipient: 'procurement',
                    action: 'Obtain a credit note from One Solution and block the duplicate from the next payment run.',
                    deadline: 'Today',
                },
            ],
        },
        {
            key: 'one-solution-person-day-excess',
            priority: 'critical',
            title: 'One Solution — person-day excess across 25 POs',
            vendor: 'One Solution',
            property: null,
            amount: 91996,
            problem:
                'Billed person-days exceed the stated headcount multiplied by days in the month. The pattern repeats across 25 POs, so it is a submission rule problem rather than a one-off error.',
            refs: [{ kind: 'requisition', label: '25 affected POs', id: null }],
            stats: [
                { label: 'POs affected', value: '25' },
                { label: 'Excess', value: '₹91,996' },
            ],
            actions: [
                {
                    recipient: 'ceo',
                    action: 'Approve recovery through credit notes, and approve introducing a person-day submission cap.',
                    deadline: 'This week',
                },
                {
                    recipient: 'procurement',
                    action: 'Obtain credit notes for the excess and correct the person-day basis on future submissions.',
                    deadline: 'This week',
                },
            ],
        },
        {
            key: 'ss-water-supply-no-competing-quote',
            priority: 'action',
            title: 'S S Water Supply — ₹22.71L over 11 months, single-sourced',
            vendor: 'S S Water Supply',
            property: 'SS Plaza',
            amount: 2271000,
            problem:
                'No competing quotation is on file and no tanker register is attached, so the rate cannot be validated against consumption.',
            refs: [{ kind: 'po', label: 'BLR-PO-26/27-0265', id: null }],
            stats: [
                { label: 'Period', value: '11 months' },
                { label: 'Competing quote', value: 'None on file' },
            ],
            actions: [
                {
                    recipient: 'ceo',
                    action: 'Require a tanker register and at least one competing quotation before the next approval.',
                    deadline: 'Before next approval',
                },
                {
                    recipient: 'procurement',
                    action: 'Collect the tanker register from site and float an RFQ to at least two alternate suppliers.',
                    deadline: 'This week',
                },
            ],
        },
        {
            key: 'unassigned-approver-backlog',
            priority: 'action',
            title: '57 POs worth ₹49.81L have no approver assigned',
            vendor: null,
            property: null,
            amount: 4981000,
            problem:
                'These POs are not stuck in anyone’s queue — they are not in a queue at all. This is an approval-routing gap, not an individual backlog.',
            refs: [{ kind: 'requisition', label: '57 unassigned POs', id: null }],
            stats: [
                { label: 'POs', value: '57' },
                { label: 'Value', value: '₹49.81L' },
            ],
            actions: [
                {
                    recipient: 'procurement',
                    action: 'Assign an approver to each of the 57 POs, or escalate the ones with no obvious owner.',
                    deadline: 'This week',
                },
                {
                    recipient: 'technical',
                    action: 'Fix approver auto-assignment so a PO cannot be created without a routing rule matching it.',
                    deadline: 'This sprint',
                },
            ],
        },
        {
            key: 'closed-corrections',
            priority: 'closed',
            title: 'Two corrections verified and closed',
            vendor: null,
            property: null,
            amount: null,
            problem:
                'PO-26/27-0043 (₹16,837) correction verified. PO-26/27-0422 (₹17,936) approved. No action needed — listed so the count reconciles.',
            refs: [
                { kind: 'po', label: 'PO-26/27-0043', id: null },
                { kind: 'po', label: 'PO-26/27-0422', id: null },
            ],
            actions: [
                { recipient: 'ceo', action: 'No action — informational.', deadline: null },
            ],
        },
    ];
}
