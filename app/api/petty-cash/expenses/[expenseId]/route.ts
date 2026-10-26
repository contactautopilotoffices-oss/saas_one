import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolvePettyCashAccess, isPettyCashAccessError, readOrgId } from '@/backend/lib/pettyCash/access';
import { pcRequest, pcError, isUuid } from '@/backend/lib/pettyCash/api';
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ expenseId: string }> }) {
    const body = await request.json().catch(() => null);
    const access = await resolvePettyCashAccess(request, readOrgId(request, body));
    if (isPettyCashAccessError(access)) return access;
    const { expenseId } = await params;
    if (!isUuid(expenseId) || !body) return NextResponse.json({ error: 'Invalid expense' }, { status: 400 });
    const { data: expense } = await supabaseAdmin.from('petty_cash_expenses').select('request_id').eq('id', expenseId).eq('organization_id', access.organizationId).maybeSingle();
    const req = expense && await pcRequest(access, expense.request_id);
    if (!req) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const result = body.action === 'correct'
        ? await supabaseAdmin.rpc('pc_correct_expense', { actor: access.user.id, eid: expenseId, body })
        : await supabaseAdmin.rpc('pc_review_expense', { actor: access.user.id, eid: expenseId, result: body.review_status, remark: body.remark || '' });
    if (result.error) return pcError(result.error);
    return NextResponse.json({ expense: result.data });
}
