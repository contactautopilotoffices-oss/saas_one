/* eslint-disable @typescript-eslint/no-explicit-any -- request bodies are untrusted JSON, checked field by field below */
/**
 * One fast-track request in full (GET), and the asker's own moves (PATCH {action: resubmit|cancel}).
 * Evidence files come back as 10-minute signed URLs, only to people who can see the request.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { requireInvoiceAccess, isInvoiceAccessError } from '@/backend/lib/invoices/access';
import { requesterAction, effectiveStatus } from '@/backend/lib/invoices/fasttrack';
import { isDocOverdue } from '@/backend/lib/invoices/docState';
import { signObject } from '@/backend/lib/invoices/storage';
import { dbError, isUuid, send } from '@/backend/lib/invoices/http';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const a = await requireInvoiceAccess(request);
    if (isInvoiceAccessError(a)) return a;
    if (!isUuid(id)) return NextResponse.json({ error: 'Request not found.' }, { status: 404 });

    const { data: r, error } = await supabaseAdmin.from('invoice_fast_track_requests').select(
        '*, po:zoho_purchase_orders(id, po_number, vendor_name, po_amount, project_name, status), requester:users!invoice_fast_track_requests_requested_by_fkey(id, full_name), payment:po_payments(id, status, utr_no, payment_date, paid_amount, requested_amount, tranche_no)',
    ).eq('id', id).eq('organization_id', a.orgId).maybeSingle();
    if (error) return dbError(error);
    if (!r) return NextResponse.json({ error: 'Request not found.' }, { status: 404 });

    const [decisions, events, siblings] = await Promise.all([
        supabaseAdmin.from('invoice_fast_track_decisions').select('id, decision, approved_amount, reason, decided_at, policy_version, approver:users!invoice_fast_track_decisions_approver_id_fkey(id, full_name)').eq('request_id', id).order('decided_at', { ascending: false }),
        supabaseAdmin.from('invoice_audit_events').select('id, event_type, actor_name, actor_role, details, created_at').eq('request_id', id).order('created_at', { ascending: false }).limit(100),
        // Other asks on the same PO: so an approver can see they are not authorising the same money twice.
        supabaseAdmin.from('invoice_fast_track_requests').select('id, status, requested_amount, approved_amount, created_at').eq('organization_id', a.orgId).eq('po_id', r.po_id).neq('id', id).order('created_at', { ascending: false }).limit(20),
    ]);

    const evidence = await Promise.all((Array.isArray(r.evidence) ? r.evidence : []).map(async (e: { storage_path: string; filename: string; purpose: string }) => ({
        filename: e.filename, purpose: e.purpose, signed_url: await signObject(e.storage_path),
    })));
    const pay = Array.isArray(r.payment) ? r.payment[0] : r.payment;

    return NextResponse.json({
        request: { ...r, evidence, requested_amount: Number(r.requested_amount), approved_amount: r.approved_amount == null ? null : Number(r.approved_amount),
            effective_status: effectiveStatus(r.status, pay), doc_overdue: isDocOverdue(r.documentation_state, r.doc_due_at), is_mine: r.requested_by === a.userId },
        decisions: decisions.data ?? [],
        events: events.data ?? [],
        related: siblings.data ?? [],
        policy: { approval_limit: a.settings.approval_limit, needs_escalation: Number(r.requested_amount) > a.settings.approval_limit },
    }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const body = await request.json().catch(() => null) as Record<string, any> | null;
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    const a = await requireInvoiceAccess(request, body);
    if (isInvoiceAccessError(a)) return a;
    if (!isUuid(id)) return NextResponse.json({ error: 'Request not found.' }, { status: 404 });
    return send(await requesterAction(a, id, body));
}
