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
        .select('id, po_number, vendor_name, po_amount, project_name, po_date, status, zoho_po_id', { count: 'exact' })
        .eq('organization_id', a.orgId).not('status', 'in', '(draft,cancelled,void,rejected)');
    if (ids) q = q.in('id', ids.slice(0, 1000));
    if (search) q = q.or(`po_number.ilike.%${search}%,vendor_name.ilike.%${search}%`);
    const { data: pos, error, count } = await q.order('po_date', { ascending: false, nullsFirst: false }).range(from, to);
    if (error) return dbError(error);

    const poIds = (pos ?? []).map((p) => p.id);
    // The simulation tables arrive with a later migration: a missing table just means "none yet".
    const zohoIds = (pos ?? []).map((p) => p.zoho_po_id).filter(Boolean) as string[];
    const [simRes, noteRes, noteZohoRes, watchRes] = poIds.length ? await Promise.all([
        supabaseAdmin.from('po_simulated_approvals').select('po_id, simulated_at, invoice_due_at').in('po_id', poIds),
        supabaseAdmin.from('po_vendor_notifications').select('po_id, zoho_po_id, status, sent_at, error, sent_to_last4, mode, trigger').in('po_id', poIds).order('sent_at', { ascending: false }),
        zohoIds.length ? supabaseAdmin.from('po_vendor_notifications').select('po_id, zoho_po_id, status, sent_at, error, sent_to_last4, mode, trigger').in('zoho_po_id', zohoIds).order('sent_at', { ascending: false }) : Promise.resolve({ data: [] }),
        zohoIds.length ? supabaseAdmin.from('po_approval_watch').select('zoho_po_id, state, approved_detected_at, invoice_due_at, note').in('zoho_po_id', zohoIds) : Promise.resolve({ data: [] }),
    ]) : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }];
    const simBy = new Map(((simRes.data ?? []) as { po_id: string }[]).map((r) => [r.po_id, r]));
    // Newest attempt per PO, whether it was recorded against our PO id or only Zoho's.
    const zohoToPo = new Map((pos ?? []).map((p) => [p.zoho_po_id, p.id]));
    const noteBy = new Map<string, { sent_at: string }>();
    for (const n of [...((noteRes.data ?? []) as { po_id: string | null; zoho_po_id: string | null; sent_at: string }[]), ...((noteZohoRes.data ?? []) as { po_id: string | null; zoho_po_id: string | null; sent_at: string }[])]) {
        const key = n.po_id ?? zohoToPo.get(n.zoho_po_id ?? '');
        if (!key) continue;
        const have = noteBy.get(key);
        if (!have || have.sent_at < n.sent_at) noteBy.set(key, n);
    }
    const watchBy = new Map(((watchRes.data ?? []) as { zoho_po_id: string }[]).map((w) => [w.zoho_po_id, w]));

    // The case: every alignment made without a clean invoice (with the reason), and every note a
    // person wrote on this PO's invoices. So an admin can read what Purchase said without opening
    // Accounts' screens.
    const [overrides, notes] = poIds.length ? await Promise.all([
        supabaseAdmin.from('po_payments').select('po_id, tranche_no, requested_amount, percent_of_po, status, aligned_at, invoice_match_at_align, invoice_override_reason, aligner:users!po_payments_aligned_by_fkey(full_name)').in('po_id', poIds).not('invoice_override_reason', 'is', null).neq('status', 'cancelled').order('aligned_at', { ascending: false }),
        supabaseAdmin.from('invoice_audit_events').select('po_id, event_type, actor_name, actor_role, details, created_at').in('po_id', poIds).in('event_type', ['issue_resolved', 'invoice_corrected', 'invoice_rejected', 'resubmission_requested', 'invoice_accepted', 'invoice_withdrawn', 'fast_track_requested', 'fast_track_approved', 'fast_track_rejected', 'fast_track_needs_information', 'documentation_waived']).order('created_at', { ascending: false }).limit(400),
    ]) : [{ data: [] }, { data: [] }];
    const caseBy = new Map<string, { overrides: unknown[]; notes: unknown[] }>();
    for (const o of (overrides.data ?? []) as { po_id: string; aligner: { full_name?: string } | { full_name?: string }[] | null }[]) {
        const c = caseBy.get(o.po_id) ?? { overrides: [], notes: [] };
        const who = Array.isArray(o.aligner) ? o.aligner[0] : o.aligner;
        c.overrides.push({ ...o, aligner: undefined, aligned_by_name: who?.full_name ?? null });
        caseBy.set(o.po_id, c);
    }
    for (const n of (notes.data ?? []) as { po_id: string; details: Record<string, unknown> | null }[]) {
        const d = n.details ?? {};
        const text = [d.note, d.reason, d.resolution_note].find((x) => typeof x === 'string' && x.trim()) as string | undefined;
        const c = caseBy.get(n.po_id) ?? { overrides: [], notes: [] };
        if (c.notes.length < 12) c.notes.push({ ...n, details: undefined, text: text ?? null, rule_code: d.rule_code ?? null });
        caseBy.set(n.po_id, c);
    }

    const [inv, links, ft] = poIds.length ? await Promise.all([
        supabaseAdmin.from('invoices').select('id, po_id, invoice_number, invoice_total, match_status, review_status, extraction_status, submitted_at').in('po_id', poIds).order('submitted_at', { ascending: false }),
        supabaseAdmin.from('invoice_intake_links').select('id, po_id, expires_at').in('po_id', poIds).eq('status', 'active').gt('expires_at', new Date().toISOString()),
        supabaseAdmin.from('invoice_fast_track_requests').select('id, po_id, status, requested_amount, approved_amount, documentation_state, doc_due_at, invoice_pending').in('po_id', poIds).not('status', 'in', '(rejected,cancelled)').order('created_at', { ascending: false }),
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
            simulated_approval: simBy.get(p.id) ?? null,
            last_notification: noteBy.get(p.id) ?? null,
            approval_watch: (p.zoho_po_id && watchBy.get(p.zoho_po_id)) || null,
            case: caseBy.get(p.id) ?? { overrides: [], notes: [] },
            fast_track: ((ftBy.get(p.id) ?? []) as unknown as { documentation_state: string; doc_due_at: string }[]).map((r) => ({ ...r, doc_overdue: isDocOverdue(r.documentation_state, r.doc_due_at) })),
        })),
        pagination: { page, page_size: size, total: count ?? 0, total_pages: Math.ceil((count ?? 0) / size) },
    }, { headers: { 'Cache-Control': 'no-store' } });
}
