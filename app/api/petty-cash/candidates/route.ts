import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolvePettyCashAccess, isPettyCashAccessError, readOrgId, isInternalPettyCashRole } from '@/backend/lib/pettyCash/access';
import { pcError, isUuid } from '@/backend/lib/pettyCash/api';
export async function GET(request: NextRequest) {
    const access = await resolvePettyCashAccess(request, readOrgId(request));
    if (isPettyCashAccessError(access)) return access;
    if (!access.canManageRouting) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const propertyId = request.nextUrl.searchParams.get('property_id');
    if (!isUuid(propertyId)) return NextResponse.json({ error: 'Property required' }, { status: 400 });
    const search = (request.nextUrl.searchParams.get('search') || '').trim();
    if (search.length > 100) return NextResponse.json({ error: 'Search must be at most 100 characters' }, { status: 400 });
    const { data: property } = await supabaseAdmin.from('properties').select('id').eq('id', propertyId).eq('organization_id', access.organizationId).is('deleted_at', null).eq('is_active', true).maybeSingle();
    if (!property) return NextResponse.json({ error: 'Forbidden property' }, { status: 403 });
    // Page memberships rather than truncating candidate eligibility at PostgREST's row limit.
    const members: { user_id: string; role: string | null; scope: string }[] = [];
    for (const table of ['property_memberships', 'organization_memberships']) {
        for (let from = 0; ; from += 500) {
            let query = supabaseAdmin.from(table).select('user_id,role').eq('organization_id', access.organizationId).eq('is_active', true);
            if (table === 'property_memberships') query = query.eq('property_id', propertyId);
            const { data, error } = await query.order('user_id').range(from, from + 499);
            if (error) return pcError(error);
            members.push(...(data || []).map(member => ({ ...member, scope: table === 'property_memberships' ? 'Assigned to this property' : 'Organization staff' }))); if ((data || []).length < 500) break;
        }
    }
    const ids = [...new Set(members.filter(m => isInternalPettyCashRole(m.role)).map(m => m.user_id))];
    const users: { id: string; full_name: string; email: string }[] = [];
    for (let from = 0; from < ids.length; from += 200) {
        const { data, error } = await supabaseAdmin.from('users').select('id,full_name,email').in('id', ids.slice(from, from + 200));
        if (error) return pcError(error); users.push(...(data || []));
    }
    return NextResponse.json({ users: users.filter(u => `${u.full_name} ${u.email}`.toLowerCase().includes(search.toLowerCase())).map(u => ({ ...u, roles: [...new Set(members.filter(m => m.user_id === u.id && isInternalPettyCashRole(m.role)).map(m => m.role))], property_association: members.some(m => m.user_id === u.id && m.scope === 'Assigned to this property') ? 'Assigned to this property' : 'Organization staff' })).sort((a, b) => (a.full_name || a.email || '').localeCompare(b.full_name || b.email || '')) });
}
