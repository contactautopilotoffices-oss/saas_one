import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolvePettyCashAccess, isPettyCashAccessError, readOrgId } from '@/backend/lib/pettyCash/access';
import { pcError } from '@/backend/lib/pettyCash/api';

// Expenses waiting on this user's decision: the ones routed to them as the property's
// expense approver, plus — for accounts — the ones no expense approver is configured for.
// The database decides eligibility (pc_expenses_to_review); this route only pages it.
export async function GET(request: NextRequest) {
    const access = await resolvePettyCashAccess(request, readOrgId(request));
    if (isPettyCashAccessError(access)) return access;
    const page = Math.max(1, Number(request.nextUrl.searchParams.get('page')) || 1);
    const spendMode = request.nextUrl.searchParams.get('spend_mode');
    let query = supabaseAdmin
        .rpc('pc_expenses_to_review', { actor: access.user.id, org: access.organizationId }, { count: 'exact' })
        .select('*,request:petty_cash_requests!request_id(id,request_no),property:properties!property_id(id,name),requester:users!requester_id(id,full_name,email),documents:petty_cash_documents!expense_id(id,file_name,file_type,superseded_by)');
    if (spendMode && ['Operation', 'Client'].includes(spendMode)) query = query.eq('spend_mode', spendMode);
    const { data, error, count } = await query
        .order('expense_date', { ascending: true })
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range((page - 1) * 50, page * 50 - 1);
    return error ? pcError(error) : NextResponse.json({ expenses: data, total_pages: Math.max(1, Math.ceil((count || 0) / 50)) });
}
