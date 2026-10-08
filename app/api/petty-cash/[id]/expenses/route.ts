import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolvePettyCashAccess, isPettyCashAccessError, readOrgId } from '@/backend/lib/pettyCash/access';
import { pcRequest, pcError, isUuid } from '@/backend/lib/pettyCash/api';
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const body = await request.json().catch(() => null);
    const access = await resolvePettyCashAccess(request, readOrgId(request, body));
    if (isPettyCashAccessError(access)) return access;
    const { id } = await params;
    if (!isUuid(id) || !body) return NextResponse.json({ error: 'Invalid expense' }, { status: 400 });
    const req = await pcRequest(access, id);
    if (!req || req.requester_id !== access.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const { data, error } = await supabaseAdmin.rpc('pc_expense', { actor: access.user.id, rid: id, body });
    return error ? pcError(error) : NextResponse.json({ expense: data }, { status: 201 });
}
