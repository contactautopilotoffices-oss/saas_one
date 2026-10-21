/**
 * One invoice, everything a reviewer needs side by side: the original file (signed,
 * 10 minutes), what was read, the PO and its lines, every rule outcome (current and
 * retired), and the audit trail.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { requireInvoiceAccess, isInvoiceAccessError } from '@/backend/lib/invoices/access';
import { signObject } from '@/backend/lib/invoices/storage';
import { dbError, isUuid } from '@/backend/lib/invoices/http';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const a = await requireInvoiceAccess(request);
    if (isInvoiceAccessError(a)) return a;
    if (!isUuid(id)) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });

    const { data: inv, error } = await supabaseAdmin.from('invoices').select('*').eq('id', id).eq('organization_id', a.orgId).maybeSingle();
    if (error) return dbError(error);
    if (!inv) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });

    const [docs, lines, po, poLines, rules, events, requests] = await Promise.all([
        supabaseAdmin.from('invoice_documents').select('id, storage_path, original_filename, content_type, file_size_bytes, sha256_hash, source_channel, uploaded_at').eq('invoice_id', id).order('uploaded_at', { ascending: false }),
        supabaseAdmin.from('invoice_line_items').select('*').eq('invoice_id', id).order('line_no'),
        supabaseAdmin.from('zoho_purchase_orders').select('id, po_number, vendor_name, po_amount, status, project_name, po_date, currency').eq('id', inv.po_id).maybeSingle(),
        supabaseAdmin.from('zoho_po_line_items').select('id, name, description, hsn_or_sac, unit, quantity, rate, tax_percentage, item_total').eq('po_id', inv.po_id).order('item_order').limit(500),
        supabaseAdmin.from('invoice_validation_results').select('*').eq('invoice_id', id).order('created_at', { ascending: false }).limit(400),
        supabaseAdmin.from('invoice_audit_events').select('id, event_type, actor_type, actor_name, actor_role, details, created_at').eq('invoice_id', id).order('created_at', { ascending: false }).limit(100),
        supabaseAdmin.from('invoice_fast_track_requests').select('id, status, requested_amount, approved_amount, documentation_state').eq('organization_id', a.orgId).eq('po_id', inv.po_id).not('status', 'in', '(rejected,cancelled)'),
    ]);

    const documents = await Promise.all((docs.data ?? []).map(async (d) => ({
        id: d.id, original_filename: d.original_filename, content_type: d.content_type, file_size_bytes: Number(d.file_size_bytes),
        source_channel: d.source_channel, uploaded_at: d.uploaded_at, sha256_hash: d.sha256_hash, signed_url: await signObject(d.storage_path),
    })));

    const all = rules.data ?? [];
    return NextResponse.json({
        invoice: inv,
        documents,
        lines: lines.data ?? [],
        po: po.data ? { ...po.data, po_amount: po.data.po_amount == null ? null : Number(po.data.po_amount) } : null,
        po_lines: poLines.data ?? [],
        rules: all.filter((r) => r.is_current),
        // Earlier runs: kept so the first mismatch is never lost to a re-check.
        history: all.filter((r) => !r.is_current && r.outcome !== 'pass'),
        events: events.data ?? [],
        fast_track: requests.data ?? [],
        caps: { can_resolve_soft: a.canResolveSoft, can_resolve_blocking: a.canResolveBlocking, can_accept: a.canAccept },
    }, { headers: { 'Cache-Control': 'no-store' } });
}
