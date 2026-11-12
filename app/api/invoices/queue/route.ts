/**
 * Invoice queues.
 *
 * GET ?org_id=&view=review|ready|all|accepted&page=&page_size=&search=
 *   review    mismatched, needs review or suspected duplicate, still open   (Purchase)
 *   ready     matched and waiting for Accounts to accept                     (Accounts)
 *   accepted  reconciled
 *   all       everything
 * Scope is applied here, on the server. Hiding rows in the UI is not a control.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { requireInvoiceAccess, isInvoiceAccessError } from '@/backend/lib/invoices/access';
import { dbError, pageParams } from '@/backend/lib/invoices/http';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const a = await requireInvoiceAccess(request);
    if (isInvoiceAccessError(a)) return a;
    const sp = new URL(request.url).searchParams;
    const { page, size, from, to } = pageParams(sp);
    const view = sp.get('view') || 'review';
    const search = (sp.get('search') || '').replace(/[,()%*\\]/g, ' ').trim().slice(0, 80);

    let q = supabaseAdmin.from('invoices').select(
        'id, po_id, invoice_number, invoice_date, invoice_total, match_status, review_status, extraction_status, extraction_error, submitted_via, submitted_at, po:zoho_purchase_orders(po_number, vendor_name, po_amount)',
        { count: 'exact' },
    ).eq('organization_id', a.orgId);

    if (view === 'review') q = q.in('match_status', ['mismatched', 'needs_review', 'duplicate_suspected']).not('review_status', 'in', '(accepted,rejected,resubmission_required)');
    else if (view === 'ready') q = q.eq('match_status', 'matched').in('review_status', ['pending', 'in_review']);
    else if (view === 'accepted') q = q.eq('review_status', 'accepted');
    if (sp.get('po_id')) q = q.eq('po_id', sp.get('po_id')!);
    if (search) q = q.ilike('invoice_number', `%${search}%`);

    const { data, error, count } = await q.order('submitted_at', { ascending: false }).range(from, to);
    if (error) return dbError(error);

    const ids = (data ?? []).map((i) => i.id);
    const issues = new Map<string, number>();
    if (ids.length) {
        const { data: rules } = await supabaseAdmin.from('invoice_validation_results').select('invoice_id')
            .in('invoice_id', ids).eq('is_current', true).eq('severity', 'blocking').neq('outcome', 'pass').is('resolved_at', null);
        for (const r of rules ?? []) issues.set(r.invoice_id, (issues.get(r.invoice_id) ?? 0) + 1);
    }

    return NextResponse.json({
        items: (data ?? []).map((i) => ({ ...i, invoice_total: i.invoice_total == null ? null : Number(i.invoice_total), blocking_issues: issues.get(i.id) ?? 0 })),
        pagination: { page, page_size: size, total: count ?? 0, total_pages: Math.ceil((count ?? 0) / size) },
    }, { headers: { 'Cache-Control': 'no-store' } });
}
