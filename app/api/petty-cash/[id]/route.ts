import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolvePettyCashAccess, isPettyCashAccessError, readOrgId } from '@/backend/lib/pettyCash/access';
import { notifyPettyCash } from '@/backend/lib/pettyCash/notify';
import { planPettyCashTransition, actorFromAccess } from '@/backend/lib/pettyCash/transitions';

const SELECT = `
    *,
    requester:users!petty_cash_requests_requester_id_fkey(id, full_name, email),
    approver:users!petty_cash_requests_approver_id_fkey(id, full_name),
    payer:users!petty_cash_requests_paid_by_fkey(id, full_name),
    property:properties(id, name, code)
`;

// GET /api/petty-cash/[id] — full detail + documents + activity timeline
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const access = await resolvePettyCashAccess(request, readOrgId(request));
    if (isPettyCashAccessError(access)) return access;

    const { data: req, error } = await supabaseAdmin
        .from('petty_cash_requests').select(SELECT).eq('id', id)
        .eq('organization_id', access.organizationId).maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!req) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const [docsRes, actRes, reconRes] = await Promise.all([
        supabaseAdmin.from('petty_cash_documents').select('*').eq('request_id', id).order('created_at', { ascending: false }),
        supabaseAdmin.from('petty_cash_activity')
            .select('*, actor:users!petty_cash_activity_actor_id_fkey(id, full_name)')
            .eq('request_id', id).order('created_at', { ascending: true }),
        // Disbursed vs bills vs cash returned — the numbers finance closes against.
        supabaseAdmin.from('petty_cash_settlement_status').select('*').eq('request_id', id).maybeSingle(),
    ]);

    return NextResponse.json({
        request: req,
        documents: docsRes.data || [],
        activity: actRes.data || [],
        reconciliation: reconRes.data || null,
    });
}

// PATCH /api/petty-cash/[id] — action-dispatched lifecycle transitions
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!body?.action) return NextResponse.json({ error: 'action is required' }, { status: 400 });

    const access = await resolvePettyCashAccess(request, readOrgId(request, body));
    if (isPettyCashAccessError(access)) return access;

    const { data: req } = await supabaseAdmin
        .from('petty_cash_requests').select('*, requester:users!petty_cash_requests_requester_id_fkey(full_name)')
        .eq('id', id).eq('organization_id', access.organizationId).maybeSingle();
    if (!req) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const action = body.action as string;
    const now = new Date().toISOString();
    const remark = (body.remark ?? body.remarks ?? '').toString().trim() || null;

    // Shared with the one-click email actions — see backend/lib/pettyCash/transitions.ts.
    const plan = planPettyCashTransition({ req, actor: actorFromAccess(access), action, body, now });
    if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: plan.status });
    const { patch, notifyKind } = plan;

    const { data: updated, error } = await supabaseAdmin
        .from('petty_cash_requests').update(patch).eq('id', id).select(SELECT).single();
    if (error) {
        console.error('Petty cash PATCH error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Settlement documents. A settlement bill now carries its own value/date/vendor —
    // that is what turns the attachment pile into a ledger the disbursed amount can
    // actually be reconciled against (see petty_cash_settlement_status).
    if (action === 'settle' && Array.isArray(body.documents) && body.documents.length) {
        // `url` accepted alongside `file_url`: the upload route returns the former, so
        // every settlement bill was silently failing the NOT NULL on file_url.
        const rows = body.documents
            .map((d: { file_url?: string; url?: string; file_name?: string; file_type?: string; amount?: number | string | null; bill_date?: string | null; vendor?: string | null }) => ({
                request_id: id, organization_id: access.organizationId, stage: 'settlement',
                file_url: d.file_url || d.url, file_name: d.file_name ?? null, file_type: d.file_type ?? null, uploaded_by: access.user.id,
                amount: d.amount == null || d.amount === '' ? null : Number(d.amount),
                bill_date: d.bill_date || null,
                vendor: d.vendor?.trim() || null,
            }))
            .filter((r: { file_url?: string }) => !!r.file_url);

        if (rows.length) {
            const { error: docErr } = await supabaseAdmin.from('petty_cash_documents').insert(rows);
            if (docErr) console.error('Petty cash settlement document attach error:', docErr);
        }
    }

    await supabaseAdmin.from('petty_cash_activity').insert({
        request_id: id, organization_id: access.organizationId, actor_id: access.user.id,
        action, from_status: req.status, to_status: (patch as any).status, remark,
    });

    if (notifyKind) {
        notifyPettyCash(notifyKind, { ...updated, requester_name: (updated.requester as any)?.full_name }, remark || undefined).catch(() => {});
    }

    return NextResponse.json({ request: updated });
}

