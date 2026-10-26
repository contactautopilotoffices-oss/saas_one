import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolvePettyCashAccess, isPettyCashAccessError, readOrgId } from '@/backend/lib/pettyCash/access';
import { pcError } from '@/backend/lib/pettyCash/api';
export async function GET(request: NextRequest) {
    const access = await resolvePettyCashAccess(request, readOrgId(request));
    if (isPettyCashAccessError(access)) return access;
    const page = Math.max(1, Number(request.nextUrl.searchParams.get('page')) || 1);
    const { data, error, count } = await supabaseAdmin.rpc('pc_my_expenses', { actor: access.user.id, org: access.organizationId }, { count: 'exact' }).select('*,request:petty_cash_requests!request_id(id,request_no),property:properties!property_id(id,name),documents:petty_cash_documents!expense_id(id,file_name,file_type,superseded_by)').order('expense_date', { ascending: false }).order('created_at', { ascending: false }).order('id', { ascending: false }).range((page - 1) * 50, page * 50 - 1);
    return error ? pcError(error) : NextResponse.json({ expenses: data, total_pages: Math.max(1, Math.ceil((count || 0) / 50)) });
}
