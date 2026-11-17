/**
 * GET /api/po-approver/queue?org_id=&page=&search= — POs waiting for approval, oldest first, plus whether
 * THIS approver has linked their Zoho account. Org super admin only. Read-only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { requireApprover, isApproverError } from '@/backend/lib/accounts/poApproverAccess';
import { approverLink, approverEnvReady } from '@/backend/lib/accounts/poApprover';

export const dynamic = 'force-dynamic';
const PAGE = 25;

export async function GET(request: NextRequest) {
    const a = await requireApprover(request);
    if (isApproverError(a)) return a;
    const sp = new URL(request.url).searchParams;
    const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1);
    const search = (sp.get('search') || '').replace(/[,()%*\\]/g, ' ').trim().slice(0, 80);

    let q = supabaseAdmin.from('zoho_purchase_orders')
        .select('id, po_number, vendor_name, po_amount, project_name, po_date, zoho_po_id, detail', { count: 'exact' })
        .eq('organization_id', a.organizationId).eq('status', 'pending_approval');
    if (search) q = q.or(`po_number.ilike.%${search}%,vendor_name.ilike.%${search}%,project_name.ilike.%${search}%`);
    const { data, error, count } = await q.order('po_date', { ascending: true, nullsFirst: false }).range((page - 1) * PAGE, page * PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // The decision tables arrive with a migration: until then the queue still works and says so.
    let link = { connected: false, zoho_email: null as string | null, zoho_user_name: null as string | null, last_error: null as string | null, connected_at: null as string | null };
    let provisioned = true;
    try { link = await approverLink(a.organizationId, a.user.id); } catch { provisioned = false; }
    const probe = await supabaseAdmin.from('po_approval_decisions').select('id', { head: true, count: 'exact' }).limit(1);
    if (probe.error) provisioned = false;

    const now = Date.now();
    return NextResponse.json({
        provisioned, env_ready: approverEnvReady(), link,
        items: (data ?? []).map((p) => {
            const d = (p.detail ?? {}) as { submitted_by_name?: string; note_to_approver?: string; submitted_date?: string; approvers_list?: { approver_name?: string }[]; delivery_date?: string };
            const since = d.submitted_date || p.po_date;
            return {
                id: p.id, po_number: p.po_number, vendor_name: p.vendor_name, po_amount: p.po_amount == null ? null : Number(p.po_amount), project_name: p.project_name, po_date: p.po_date,
                raised_by: d.submitted_by_name || null, note_to_approver: d.note_to_approver || null, delivery_date: d.delivery_date || null,
                approvers: (d.approvers_list ?? []).map((x) => x.approver_name).filter(Boolean),
                waiting_days: since ? Math.max(0, Math.floor((now - new Date(since).getTime()) / 86_400_000)) : null,
            };
        }),
        pagination: { page, page_size: PAGE, total: count ?? 0, total_pages: Math.ceil((count ?? 0) / PAGE) },
    }, { headers: { 'Cache-Control': 'no-store' } });
}
