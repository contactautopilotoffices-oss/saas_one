import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import type { PettyCashRequest } from '@/frontend/lib/pettyCash/roles';
import { PettyCashAccess } from './access';
export const PC_SELECT = `*, requester:users!petty_cash_requests_requester_id_fkey(id,full_name,email), property:properties(id,name,code), assigned_allocator:users!petty_cash_requests_assigned_allocator_id_fkey(id,full_name,email), assigned_approver:users!petty_cash_requests_assigned_approver_id_fkey(id,full_name,email)`;
export const isUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function pcError(error: { message: string; code?: string }) {
    const message = error.message;
    const status = /Forbidden|owned|self action/i.test(message) ? 403 : /stage|changed|balance|pending request|proof|reconcile/i.test(message) ? 409 : /does not exist|schema cache/i.test(message) ? 503 : 400;
    return NextResponse.json({ error: message }, { status });
}
export async function pcRequest(access: PettyCashAccess, id: string) {
    if (!isUuid(id)) return null;
    const { data, error } = await supabaseAdmin.rpc('pc_requests', { actor: access.user.id, org: access.organizationId }).select(PC_SELECT).eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return data as unknown as PettyCashRequest | null;
}
