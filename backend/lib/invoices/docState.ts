import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import type { DocumentationState } from './types';

/**
 * The documentation exception, kept apart from the payment status on purpose.
 *
 *   pending -> link_sent -> invoice_received -> matched -> reconciled -> closed
 *   side exits: disputed (a mismatch nobody has resolved), waived_by_policy
 *
 * `overdue` is NOT stored. It is "past doc_due_at and not yet reconciled, closed or
 * waived", worked out on read (see isDocOverdue), so a clock cannot leave a row stuck.
 *
 * This only moves a request FORWARD from what the invoices and links say. It never
 * touches `status` (the payment exception) and never reopens a closed or waived request.
 */

const SETTLED: DocumentationState[] = ['closed', 'waived_by_policy'];

export function isDocOverdue(state: string, dueAt: string | null | undefined, now = Date.now()): boolean {
    if (!dueAt) return false;
    if (state === 'reconciled' || SETTLED.includes(state as DocumentationState)) return false;
    return new Date(dueAt).getTime() < now;
}

export async function syncDocumentationState(orgId: string, poId: string): Promise<void> {
    try {
        const { data: requests } = await supabaseAdmin.from('invoice_fast_track_requests')
            .select('id, documentation_state, invoice_id, invoice_pending')
            .eq('organization_id', orgId).eq('po_id', poId)
            .not('status', 'in', '(rejected,cancelled)');
        const open = (requests ?? []).filter((r) => !SETTLED.includes(r.documentation_state));
        if (!open.length) return;

        const { data: invoices } = await supabaseAdmin.from('invoices')
            .select('id, match_status, review_status, submitted_at')
            .eq('organization_id', orgId).eq('po_id', poId)
            .not('review_status', 'in', '(rejected,resubmission_required)')
            .order('submitted_at', { ascending: false });
        const accepted = (invoices ?? []).find((i) => i.review_status === 'accepted');
        const latest = accepted ?? (invoices ?? [])[0];

        let next: DocumentationState;
        if (accepted) next = 'reconciled';
        else if (latest) next = latest.match_status === 'matched' ? 'matched'
            : latest.match_status === 'mismatched' || latest.match_status === 'duplicate_suspected' ? 'disputed'
            : 'invoice_received';
        else {
            const { count } = await supabaseAdmin.from('invoice_intake_links').select('id', { count: 'exact', head: true })
                .eq('organization_id', orgId).eq('po_id', poId).eq('status', 'active').gt('expires_at', new Date().toISOString());
            next = (count ?? 0) > 0 ? 'link_sent' : 'pending';
        }

        for (const r of open) {
            if (r.documentation_state === next && (r.invoice_id ?? null) === (latest?.id ?? null)) continue;
            await supabaseAdmin.from('invoice_fast_track_requests').update({
                documentation_state: next,
                invoice_id: latest?.id ?? null,
                // Only an accepted invoice ends the pending flag; an approval or an alignment never does.
                invoice_pending: next !== 'reconciled',
                updated_at: new Date().toISOString(),
            }).eq('id', r.id);
        }
    } catch (e) {
        // Bookkeeping must never fail the action that triggered it.
        console.error('[invoices] documentation sync failed:', e);
    }
}
