import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { DEFAULT_INVOICE_SETTINGS, type InvoiceSettings } from './types';

/** Postgres "relation does not exist" / PostgREST "table not in schema cache". */
export function isMissingTable(error: { code?: string; message?: string } | null | undefined): boolean {
    if (!error) return false;
    return error.code === '42P01' || error.code === 'PGRST205' || /does not exist|schema cache/i.test(error.message ?? '');
}

export const INVOICE_NOT_PROVISIONED =
    'Invoice Control is not set up on this database yet. Apply supabase/migrations/20261020000001_invoice_control.sql once.';

/** The org's policy, with defaults filled in. Never throws: a missing row or table means defaults. */
export async function loadInvoiceSettings(orgId: string): Promise<InvoiceSettings> {
    const { data, error } = await supabaseAdmin
        .from('invoice_control_settings').select('*').eq('organization_id', orgId).maybeSingle();
    if (error || !data) return { ...DEFAULT_INVOICE_SETTINGS };
    return {
        link_expiry_hours: Number(data.link_expiry_hours),
        max_file_mb: Number(data.max_file_mb),
        amount_tolerance: Number(data.amount_tolerance),
        rate_tolerance_pct: Number(data.rate_tolerance_pct),
        qty_tolerance_pct: Number(data.qty_tolerance_pct),
        min_confidence: Number(data.min_confidence),
        approver_roles: data.approver_roles ?? DEFAULT_INVOICE_SETTINGS.approver_roles,
        approval_limit: Number(data.approval_limit),
        escalation_roles: data.escalation_roles ?? DEFAULT_INVOICE_SETTINGS.escalation_roles,
        evidence_required: !!data.evidence_required,
        doc_deadline_days: Number(data.doc_deadline_days),
        policy_version: Number(data.policy_version),
    };
}
