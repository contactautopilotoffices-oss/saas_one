import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveAccountsAccess, isAccountsAccessError, readOrgId } from '@/backend/lib/accounts/access';
import { planPaymentTransition, paymentActorFromAccess } from '@/backend/lib/accounts/transitions';
import { notifyPaymentAligned, notifyPaymentRequested } from '@/backend/lib/accounts/notify';
import { logPoActivity } from '@/backend/lib/accounts/activity';

const SELECT = `
    *,
    po:zoho_purchase_orders(id, po_number, vendor_name, po_amount, department, project_name, category),
    aligner:users!po_payments_aligned_by_fkey(id, full_name),
    completer:users!po_payments_completed_by_fkey(id, full_name),
    creator:users!po_payments_created_by_fkey(id, full_name)
`;

// GET /api/accounts/payments — list payments by status (aligned | completed | all)
export async function GET(request: NextRequest) {
    const access = await resolveAccountsAccess(request, readOrgId(request));
    if (isAccountsAccessError(access)) return access;

    const sp = new URL(request.url).searchParams;
    const status = sp.get('status'); // 'aligned' | 'completed' | null(all non-cancelled)
    const page = Math.max(1, parseInt(sp.get('page') || '1'));
    const pageSize = Math.min(100, Math.max(1, parseInt(sp.get('page_size') || '25')));
    const search = (sp.get('search') || '').trim();
    const dateFrom = sp.get('date_from');
    const dateTo = sp.get('date_to');

    let q = supabaseAdmin.from('po_payments').select(SELECT, { count: 'exact' }).eq('organization_id', access.organizationId);
    if (status) q = q.eq('status', status);
    else q = q.neq('status', 'cancelled');
    if (search) q = q.or(`po_number.ilike.%${search}%,vendor_name.ilike.%${search}%,utr_no.ilike.%${search}%`);
    // Completed payments filter by payment_date; the aligned queue by aligned_at.
    if (dateFrom) q = q.gte(status === 'completed' ? 'payment_date' : 'created_at', dateFrom);
    if (dateTo) q = q.lte(status === 'completed' ? 'payment_date' : 'created_at', dateTo);

    q = q.order(status === 'completed' ? 'completed_at' : 'aligned_at', { ascending: false, nullsFirst: false });
    const from = (page - 1) * pageSize;
    q = q.range(from, from + pageSize - 1);

    const { data, error, count } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({
        payments: data,
        pagination: { page, page_size: pageSize, total: count || 0, total_pages: Math.ceil((count || 0) / pageSize) },
    });
}

// POST /api/accounts/payments — raise a tranche against a PO.
//
//   action: 'align'   (default, unchanged) — raise and align in one step.
//   action: 'request'            — raise it as "yet to be aligned"; accounts are mailed and
//                                  a later PATCH { action: 'align' } promotes it.
export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    const access = await resolveAccountsAccess(request, readOrgId(request, body));
    if (isAccountsAccessError(access)) return access;

    const action = body.action === 'request' ? 'request' : 'align';
    const now = new Date().toISOString();

    // The PO is fetched BEFORE planning: percent_of_po can only be validated against the
    // PO's value, and a percentage that disagrees with its own amount must never reach
    // the table. po_id is still validated by the state machine for the missing case.
    if (!body.po_id) return NextResponse.json({ error: 'po_id is required' }, { status: 400 });
    const { data: po } = await supabaseAdmin
        .from('zoho_purchase_orders').select('id, po_number, vendor_name, po_amount')
        .eq('id', body.po_id).eq('organization_id', access.organizationId).maybeSingle();
    if (!po) return NextResponse.json({ error: 'PO not found' }, { status: 404 });

    // Permission + field guards live in the state machine, shared with the one-click
    // email actions — see backend/lib/accounts/transitions.ts.
    const plan = planPaymentTransition({
        pay: null, actor: paymentActorFromAccess(access), action, body, now, poAmount: po.po_amount,
    });
    if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: plan.status });

    // Next tranche number for this PO (ignoring cancelled).
    const { data: existing } = await supabaseAdmin
        .from('po_payments').select('tranche_no').eq('po_id', po.id).neq('status', 'cancelled')
        .order('tranche_no', { ascending: false }).limit(1).maybeSingle();
    const trancheNo = (existing?.tranche_no ?? 0) + 1;

    const { data: created, error } = await supabaseAdmin
        .from('po_payments')
        .insert({
            organization_id: access.organizationId,
            po_id: po.id,
            po_number: po.po_number,
            vendor_name: po.vendor_name,
            tranche_no: trancheNo,
            ...plan.patch,
        })
        .select(SELECT)
        .single();

    if (error) {
        console.error('Payment align error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // The timeline entry is written after the row lands and can never fail the request —
    // see backend/lib/accounts/activity.ts.
    await logPoActivity({
        organizationId: access.organizationId,
        poId: po.id,
        paymentId: created.id,
        action: plan.notifyKind === 'requested' ? 'payment_requested' : 'aligned',
        toStatus: created.status,
        actorId: access.user.id,
        note: plan.notifyKind === 'requested'
            ? `Requested tranche #${created.tranche_no}`
            : `Aligned tranche #${created.tranche_no}`,
        detail: {
            requested_amount: Number(created.requested_amount),
            percent_of_po: created.percent_of_po ?? null,
            po_amount: Number(po.po_amount),
            payment_term: created.payment_term ?? null,
        },
    });

    if (plan.notifyKind === 'aligned') {
        notifyPaymentAligned({
            id: created.id,
            organization_id: access.organizationId,
            po_number: created.po_number,
            vendor_name: created.vendor_name,
            tranche_no: created.tranche_no,
            requested_amount: created.requested_amount,
            payment_term: created.payment_term,
            aligned_by_name: (created.aligner as any)?.full_name ?? null,
        }).catch(() => {});
    } else if (plan.notifyKind === 'requested') {
        notifyPaymentRequested({
            id: created.id,
            organization_id: access.organizationId,
            po_number: created.po_number,
            vendor_name: created.vendor_name,
            tranche_no: created.tranche_no,
            requested_amount: created.requested_amount,
            percent_of_po: created.percent_of_po ?? null,
            po_amount: Number(po.po_amount),
            payment_term: created.payment_term,
            requested_by_name: (created.creator as any)?.full_name ?? null,
        }).catch(() => {});
    }

    return NextResponse.json({ payment: created }, { status: 201 });
}
