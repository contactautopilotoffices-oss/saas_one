import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolvePettyCashAccess, isPettyCashAccessError, readOrgId } from '@/backend/lib/pettyCash/access';
import { notifyPettyCash } from '@/backend/lib/pettyCash/notify';

const SELECT = `
    *,
    requester:users!petty_cash_requests_requester_id_fkey(id, full_name, email),
    approver:users!petty_cash_requests_approver_id_fkey(id, full_name),
    payer:users!petty_cash_requests_paid_by_fkey(id, full_name),
    property:properties(id, name, code)
`;

// GET /api/petty-cash — list requests for a tab (mine | approvals | disbursements | all)
export async function GET(request: NextRequest) {
    const access = await resolvePettyCashAccess(request, readOrgId(request));
    if (isPettyCashAccessError(access)) return access;

    const sp = new URL(request.url).searchParams;
    // Allowlist the tab: any unrecognized value must fall back to the most
    // restrictive ('mine') scope, never through the branch chain unscoped.
    const TABS = ['mine', 'approvals', 'disbursements', 'all'] as const;
    const rawTab = sp.get('tab') || 'mine';
    const tab: (typeof TABS)[number] = (TABS as readonly string[]).includes(rawTab) ? (rawTab as (typeof TABS)[number]) : 'mine';
    const page = Math.max(1, parseInt(sp.get('page') || '1'));
    const pageSize = Math.min(100, Math.max(1, parseInt(sp.get('page_size') || '20')));
    const propertyId = sp.get('property_id');
    const status = sp.getAll('status');
    const category = sp.get('category');
    const dateFrom = sp.get('date_from');
    const dateTo = sp.get('date_to');
    const search = (sp.get('search') || '').trim();

    let query = supabaseAdmin
        .from('petty_cash_requests')
        .select(SELECT, { count: 'exact' })
        .eq('organization_id', access.organizationId);

    // Tab scoping
    if (tab === 'mine') {
        query = query.eq('requester_id', access.user.id);
    } else if (tab === 'approvals') {
        if (!access.canApprove) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        query = query.eq('status', 'submitted');
        if (!access.isAdmin) query = query.in('property_id', access.propertyIds.length ? access.propertyIds : ['00000000-0000-0000-0000-000000000000']);
    } else if (tab === 'disbursements') {
        if (!access.canDisburse) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        query = query.in('status', ['approved', 'settlement_submitted']);
    } else if (tab === 'all') {
        // Admins/finance see the whole org; others fall back to their own + their properties.
        if (!access.isAdmin && !access.canDisburse) {
            const scope = [`requester_id.eq.${access.user.id}`];
            if (access.propertyIds.length) scope.push(`property_id.in.(${access.propertyIds.join(',')})`);
            query = query.or(scope.join(','));
        }
    }

    if (propertyId) query = query.eq('property_id', propertyId);
    if (status.length) query = query.in('status', status);
    if (category) query = query.eq('category', category);
    if (dateFrom) query = query.gte('created_at', dateFrom);
    if (dateTo) query = query.lte('created_at', `${dateTo}T23:59:59.999Z`);
    if (search) query = query.or(`request_no.ilike.%${search}%,purpose.ilike.%${search}%,vendor_name.ilike.%${search}%`);

    query = query.order('created_at', { ascending: false });
    const from = (page - 1) * pageSize;
    query = query.range(from, from + pageSize - 1);

    const { data, error, count } = await query;
    if (error) {
        console.error('Petty cash GET error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({
        requests: data,
        pagination: { page, page_size: pageSize, total: count || 0, total_pages: Math.ceil((count || 0) / pageSize) },
    });
}

// POST /api/petty-cash — create a request (status: submitted, or draft)
export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

    const access = await resolvePettyCashAccess(request, readOrgId(request, body));
    if (isPettyCashAccessError(access)) return access;

    if (!body.property_id) return NextResponse.json({ error: 'property_id is required' }, { status: 400 });
    // A requester may only file against a property they belong to (admins: any in org).
    if (!access.isAdmin && !access.propertyIds.includes(body.property_id)) {
        return NextResponse.json({ error: 'You are not a member of that property' }, { status: 403 });
    }
    const amount = Number(body.amount_requested);
    if (!amount || amount <= 0) return NextResponse.json({ error: 'amount_requested must be greater than 0' }, { status: 400 });
    if (!body.purpose?.trim()) return NextResponse.json({ error: 'purpose is required' }, { status: 400 });

    const asDraft = body.status === 'draft';
    const { data: created, error } = await supabaseAdmin
        .from('petty_cash_requests')
        .insert({
            organization_id: access.organizationId,
            property_id: body.property_id,
            requester_id: access.user.id,
            request_type: body.request_type === 'reimbursement' ? 'reimbursement' : 'advance',
            department: body.department ?? null,
            category: body.category ?? null,
            amount_requested: amount,
            purpose: String(body.purpose).trim(),
            payment_mode: body.payment_mode ?? null,
            expected_date: body.expected_date || null,
            vendor_name: body.vendor_name ?? null,
            status: asDraft ? 'draft' : 'submitted',
            remarks: body.remarks ?? null,
        })
        .select(SELECT)
        .single();

    if (error) {
        console.error('Petty cash CREATE error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Attach any documents uploaded during creation.
    if (Array.isArray(body.documents) && body.documents.length) {
        await supabaseAdmin.from('petty_cash_documents').insert(
            body.documents.map((d: { file_url: string; file_name?: string; file_type?: string }) => ({
                request_id: created.id,
                organization_id: access.organizationId,
                stage: 'request',
                file_url: d.file_url,
                file_name: d.file_name ?? null,
                file_type: d.file_type ?? null,
                uploaded_by: access.user.id,
            })),
        );
    }

    await supabaseAdmin.from('petty_cash_activity').insert({
        request_id: created.id,
        organization_id: access.organizationId,
        actor_id: access.user.id,
        action: asDraft ? 'draft_saved' : 'submitted',
        to_status: created.status,
    });

    if (!asDraft) {
        notifyPettyCash('submitted', {
            ...created,
            requester_name: (created.requester as any)?.full_name,
        }).catch(() => {});
    }

    return NextResponse.json({ request: created }, { status: 201 });
}
