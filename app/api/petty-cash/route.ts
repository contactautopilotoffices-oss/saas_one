import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolvePettyCashAccess, isPettyCashAccessError, readOrgId } from '@/backend/lib/pettyCash/access';
import { PC_SELECT, pcError, isUuid } from '@/backend/lib/pettyCash/api';
export async function GET(request: NextRequest) {
    const access = await resolvePettyCashAccess(request, readOrgId(request));
    if (isPettyCashAccessError(access)) return access;
    const q = request.nextUrl.searchParams;
    const page = Math.max(1, Number(q.get('page')) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(q.get('page_size')) || 50));
    let query = supabaseAdmin.rpc('pc_requests', { actor: access.user.id, org: access.organizationId }, { count: 'exact' }).select(PC_SELECT);
    switch (q.get('tab')) {
        case 'allocations': query = query.eq('assigned_allocator_id', access.user.id).eq('status', 'submitted'); break;
        case 'approvals': query = query.eq('assigned_approver_id', access.user.id).eq('workflow_version', 2).eq('status', 'pending_approval'); break;
        case 'disbursements':
            if (!access.canDisburse) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            query = query.eq('status', 'approved'); break;
        case 'reconciliation':
            if (!access.canDisburse) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            query = query.in('status', ['paid', 'settlement_submitted']); break;
        case 'assigned': query = query.or(`assigned_allocator_id.eq.${access.user.id},assigned_approver_id.eq.${access.user.id}`); break;
        case 'all': break; // pc_requests already enforces record-level scope.
        default: query = query.eq('requester_id', access.user.id);
    }
    const property = q.get('property_id');
    if (property) { if (!isUuid(property)) return NextResponse.json({ error: 'Invalid property' }, { status: 400 }); query = query.eq('property_id', property); }
    if (q.get('status')) query = query.eq('status', q.get('status')!);
    const search = (q.get('search') || '').replace(/[^a-zA-Z0-9 @._-]/g, '').slice(0, 100);
    if (search) query = query.ilike('purpose', `%${search}%`);
    const { data, error, count } = await query.order('created_at', { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
    if (error) return pcError(error);
    return NextResponse.json({ requests: data, pagination: { page, page_size: pageSize, total: count || 0, total_pages: Math.ceil((count || 0) / pageSize) } });
}
export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null);
    if (!body || Array.isArray(body) || typeof body !== 'object') return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    const access = await resolvePettyCashAccess(request, readOrgId(request, body));
    if (isPettyCashAccessError(access)) return access;
    const { data, error } = await supabaseAdmin.rpc('pc_create_request', { actor: access.user.id, org: access.organizationId, body });
    if (error) return pcError(error);
    return NextResponse.json({ request: data }, { status: 201 });
}
