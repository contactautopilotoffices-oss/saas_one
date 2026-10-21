/**
 * "PO Invoice Status" — POs with whatever invoice activity each has.
 *
 * GET ?org_id=&page=&page_size=&search=&filter=all|has_invoice|attention|fast_track|awaiting_invoice
 *
 * Reads the existing PO table; nothing is copied. Links are returned WITHOUT tokens (the
 * token is not stored, only its hash).
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { requireInvoiceAccess, isInvoiceAccessError } from '@/backend/lib/invoices/access';
import { isDocOverdue } from '@/backend/lib/invoices/docState';
import { dbError, pageParams } from '@/backend/lib/invoices/http';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const a = await requireInvoiceAccess(request);
    if (isInvoiceAccessError(a)) return a;
    const sp = new URL(request.url).searchParams;
    const { page, size, from, to } = pageParams(sp);
    const filter = sp.get('filter') || 'all';
    const search = (sp.get('search') || '').replace(/[,()%*\\]/g, ' ').trim().slice(0, 80);

    let ids: string[] | null = null;
    const distinct = (rows: { po_id: string }[] | null) => [...new Set((rows ?? []).map((r) => r.po_id))];
    if (filter === 'has_invoice') {
        const { data, error } = await supabaseAdmin.from('invoices').select('po_id').eq('organization_id', a.orgId).limit(5000);
        if (error) return dbError(error);
        ids = distinct(data);
    } else if (filter === 'attention') {
        const { data, error } = await supabaseAdmin.from('invoices').select('po_id').eq('organization_id', a.orgId)
            .in('match_status', ['mismatched', 'needs_review', 'duplicate_suspected']).not('review_status', 'in', '(accepted,rejected,resubmission_required)').limit(5000);
        if (error) return dbError(error);
        ids = distinct(data);
    } else if (filter === 'fast_track' || filter === 'awaiting_invoice') {
        let q = supabaseAdmin.from('invoice_fast_track_requests').select('po_id').eq('organization_id', a.orgId).not('status', 'in', '(rejected,cancelled)');
        if (filter === 'awaiting_invoice') q = q.not('documentation_state', 'in', '(reconciled,closed,waived_by_policy)');
        const { data, error } = await q.limit(5000);
        if (error) return dbError(error);
        ids = distinct(data);
    }
    if (ids && !ids.length) return NextResponse.json({ pos: [], pagination: { page, page_size: size, total: 0, total_pages: 0 } });

    let q = supabaseAdmin.from('zoho_purchase_orders')
        .select('id, po_number, vendor_name, po_amount, project_name, po_date, status', { count: 'exact' })
        .eq('organization_id', a.orgId).not('status', 'in', '(draft,cancelled,void,rejected)');
    if (ids) q = q.in('id', ids.slice(0, 1000));
    if (search) q = q.or(`po_number.ilike.%${search}%,vendor_name.ilike.%${search}%`);
    const { data: pos, error, count } = await q.order('po_date', { ascending: false, nullsFirst: false }).range(from, to);
    if (error) return dbError(error);

    const poIds = (pos ?? []).map((p) => p.id);
    const [inv, links, ft] = poIds.length ? await Promise.all([
        supabaseAdmin.from('invoices').select('id, po_id, invoice_number, invoice_total, match_status, review_status, extraction_status, submitted_at').in('po_id', poIds).order('submitted_at', { ascending: false }),
        supabaseAdmin.from('invoice_intake_links').select('id, po_id, expires_at').in('po_id', poIds).eq('status', 'active').gt('expires_at', new Date().toISOString()),
        supabaseAdmin.from('invoice_fast_track_requests').select('id, po_id, status, requested_amount, approved_amount, documentation_state, doc_due_at, invoice_pending').in('po_id', poIds).not('status', 'in', '(rejected,cancelled)'),
    ]) : [{ data: [] }, { data: [] }, { data: [] }];

    const by = <T extends { po_id: string }>(rows: T[] | null) => {
        const m = new Map<string, T[]>();
        for (const r of rows ?? []) m.set(r.po_id, [...(m.get(r.po_id) ?? []), r]);
        return m;
    };
    const invBy = by(inv.data as { po_id: string }[]), linkBy = by(links.data as { po_id: string }[]), ftBy = by(ft.data as { po_id: string }[]);

    return NextResponse.json({
        pos: (pos ?? []).map((p) => ({
            ...p,
            po_amount: p.po_amount == null ? null : Number(p.po_amount),
            invoices: invBy.get(p.id) ?? [],
            active_link: (linkBy.get(p.id) ?? [])[0] ?? null,
            fast_track: ((ftBy.get(p.id) ?? []) as unknown as { documentation_state: string; doc_due_at: string }[]).map((r) => ({ ...r, doc_overdue: isDocOverdue(r.documentation_state, r.doc_due_at) })),
        })),
        pagination: { page, page_size: size, total: count ?? 0, total_pages: Math.ceil((count ?? 0) / size) },
    }, { headers: { 'Cache-Control': 'no-store' } });
}
