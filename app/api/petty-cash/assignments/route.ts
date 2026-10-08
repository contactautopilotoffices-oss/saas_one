import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolvePettyCashAccess, isPettyCashAccessError, readOrgId } from '@/backend/lib/pettyCash/access';
import { pcError, isUuid } from '@/backend/lib/pettyCash/api';
export async function GET(request: NextRequest) {
    const access = await resolvePettyCashAccess(request, readOrgId(request));
    if (isPettyCashAccessError(access)) return access;
    if (!access.canManageRouting) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const { data, error } = await supabaseAdmin.from('petty_cash_property_assignments').select('*,user:users!user_id(id,full_name,email),property:properties(name)').eq('organization_id', access.organizationId).eq('is_active', true).order('updated_at');
    return error ? pcError(error) : NextResponse.json({ assignments: data });
}
export async function PUT(request: NextRequest) {
    const body = await request.json().catch(() => null);
    const access = await resolvePettyCashAccess(request, readOrgId(request, body));
    if (isPettyCashAccessError(access)) return access;
    if (!access.canManageRouting || !body || ![body.property_id, body.allocator_id, body.approver_id].every(isUuid)) return NextResponse.json({ error: 'Forbidden or invalid routing' }, { status: 403 });
    const { data: property } = await supabaseAdmin.from('properties').select('id').eq('id', body.property_id).eq('organization_id', access.organizationId).maybeSingle();
    if (!property) return NextResponse.json({ error: 'Forbidden property' }, { status: 403 });
    const allocatorBackups = body.allocator_backups ?? [];
    const approverBackups = body.approver_backups ?? [];
    if (![allocatorBackups, approverBackups].every(ids => Array.isArray(ids) && ids.length <= 25 && ids.every(isUuid) && new Set(ids).size === ids.length)) {
        return NextResponse.json({ error: 'Select up to 25 distinct eligible backups per stage' }, { status: 400 });
    }
    const { data, error } = await supabaseAdmin.rpc('pc_set_routing', { actor: access.user.id, prop: body.property_id, allocator: body.allocator_id, approver: body.approver_id, allocator_backups: allocatorBackups, approver_backups: approverBackups });
    return error ? pcError(error) : NextResponse.json({ routing: data });
}
