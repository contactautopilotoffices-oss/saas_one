import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveCrmAccess, isCrmAccessError, readOrgId } from '@/backend/lib/crm/access';

/** Returns the set of user ids that are active members of the org (either table). */
async function orgMemberIds(organizationId: string): Promise<Set<string>> {
    const [p, o] = await Promise.all([
        supabaseAdmin.from('property_memberships').select('user_id').eq('organization_id', organizationId).eq('is_active', true),
        supabaseAdmin.from('organization_memberships').select('user_id').eq('organization_id', organizationId).eq('is_active', true),
    ]);
    return new Set([...(p.data || []), ...(o.data || [])].map((m: any) => m.user_id));
}

// GET /api/crm/territories - admins see the whole team's markets; reps see their own
export async function GET(request: NextRequest) {
    const access = await resolveCrmAccess(request, readOrgId(request));
    if (isCrmAccessError(access)) return access;

    const userId = new URL(request.url).searchParams.get('user_id');

    let query = supabaseAdmin
        .from('crm_territories')
        .select('*, user_info:users(id, full_name, email)')
        .eq('is_active', true);

    if (access.isAdmin) {
        const memberIds = [...(await orgMemberIds(access.organizationId))];
        query = memberIds.length ? query.in('user_id', userId ? [userId] : memberIds) : query.eq('user_id', '00000000-0000-0000-0000-000000000000');
    } else {
        query = query.eq('user_id', access.user.id);
    }

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ territories: data });
}

// POST /api/crm/territories - assign a market (city) to a rep (admin only)
export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null);
    if (!body?.city?.trim()) return NextResponse.json({ error: 'city is required' }, { status: 400 });

    const access = await resolveCrmAccess(request, readOrgId(request, body));
    if (isCrmAccessError(access)) return access;
    if (!access.isAdmin) return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });

    const targetUserId = body.user_id || access.user.id;
    const members = await orgMemberIds(access.organizationId);
    if (!members.has(targetUserId)) {
        return NextResponse.json({ error: 'Target user is not a member of this organization' }, { status: 400 });
    }

    // Upsert (reactivate if a soft-deleted row exists for this user+city).
    const city = body.city.trim();
    const { data: existing } = await supabaseAdmin
        .from('crm_territories').select('id').eq('user_id', targetUserId).eq('city', city).maybeSingle();

    let result;
    if (existing) {
        result = await supabaseAdmin.from('crm_territories').update({ is_active: true }).eq('id', existing.id).select().single();
    } else {
        result = await supabaseAdmin.from('crm_territories').insert({ user_id: targetUserId, city, is_active: true }).select().single();
    }
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
    return NextResponse.json({ territory: result.data }, { status: 201 });
}

// DELETE /api/crm/territories?id=  (admin only)
export async function DELETE(request: NextRequest) {
    const territoryId = new URL(request.url).searchParams.get('id');
    if (!territoryId) return NextResponse.json({ error: 'Territory id is required' }, { status: 400 });

    const { data: terr } = await supabaseAdmin.from('crm_territories').select('id, user_id').eq('id', territoryId).maybeSingle();
    if (!terr) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const access = await resolveCrmAccess(request, readOrgId(request));
    if (isCrmAccessError(access)) return access;

    // Admins may remove anyone's market in their org; reps may remove their own.
    if (!access.isAdmin && terr.user_id !== access.user.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (access.isAdmin) {
        const members = await orgMemberIds(access.organizationId);
        if (!members.has(terr.user_id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { error } = await supabaseAdmin.from('crm_territories').update({ is_active: false }).eq('id', territoryId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
}
