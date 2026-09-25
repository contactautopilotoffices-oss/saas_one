import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveAssetAccess, isAssetAccessError, readOrgId, canAccessProperty } from '@/backend/lib/assets/access';
import { ASSET_SELECT, enrichAssets } from '@/backend/lib/assets/enrich';

/** GET /api/assets/[id] — full detail: asset, computed health, AMC, and its event timeline. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const access = await resolveAssetAccess(request, readOrgId(request));
    if (isAssetAccessError(access)) return access;

    const { data: asset, error } = await supabaseAdmin
        .from('assets')
        .select(ASSET_SELECT)
        .eq('id', id)
        .eq('organization_id', access.organizationId)
        .is('deleted_at', null)
        .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!asset) return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    if (!canAccessProperty(access, (asset as any).property_id)) {
        return NextResponse.json({ error: 'Forbidden: no access to this property' }, { status: 403 });
    }

    const [enriched] = await enrichAssets([asset as any]);

    const { data: events } = await supabaseAdmin
        .from('asset_events')
        .select(`
            id, event_type, title, description, amount, cost_head, budget_synced, budget_sync_error,
            photo_urls, occurred_at, created_at, metadata,
            ticket:tickets(id, ticket_number, title, status),
            created_by_user:users!asset_events_created_by_fkey(id, full_name)
        `)
        .eq('asset_id', id)
        .order('occurred_at', { ascending: false })
        .limit(200);

    return NextResponse.json({ asset: enriched, events: events || [] });
}

/** PATCH /api/assets/[id] — edit asset details. Manager-only. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const body = await request.json();
    const access = await resolveAssetAccess(request, readOrgId(request, body));
    if (isAssetAccessError(access)) return access;

    const { data: current } = await supabaseAdmin.from('assets').select('*').eq('id', id).eq('organization_id', access.organizationId).maybeSingle();
    if (!current) return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    if (!access.canManage) return NextResponse.json({ error: 'Forbidden: you cannot edit assets' }, { status: 403 });

    const EDITABLE = [
        'category_id', 'name', 'asset_type', 'make', 'model', 'serial_number', 'floor', 'location',
        'installation_date', 'purchase_cost', 'vendor_name', 'lifecycle_years', 'warranty_start',
        'warranty_end', 'amc_required', 'amc_contract_id', 'status', 'notes', 'custom_fields',
    ] as const;

    const updates: Record<string, unknown> = {};
    for (const key of EDITABLE) if (key in body) updates[key] = body[key] === '' ? null : body[key];
    if (Object.keys(updates).length === 0) return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 });

    const { data, error } = await supabaseAdmin.from('assets').update(updates).eq('id', id).select(ASSET_SELECT).single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const changeSummary = Object.entries(updates)
        .filter(([k]) => k !== 'custom_fields')
        .map(([k, v]) => `${k.replace(/_/g, ' ')} → ${v ?? '—'}`)
        .join('; ');

    await supabaseAdmin.from('asset_events').insert({
        asset_id: id,
        organization_id: access.organizationId,
        property_id: current.property_id,
        event_type: updates.status && updates.status !== current.status ? 'status_change' : 'updated',
        title: updates.status && updates.status !== current.status ? `Status changed to ${updates.status}` : 'Asset details updated',
        description: changeSummary || null,
        created_by: access.user.id,
    });

    return NextResponse.json({ asset: data });
}

/** DELETE /api/assets/[id] — soft delete. Manager-only. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const access = await resolveAssetAccess(request, readOrgId(request));
    if (isAssetAccessError(access)) return access;
    if (!access.canManage) return NextResponse.json({ error: 'Forbidden: you cannot remove assets' }, { status: 403 });

    const { data: current } = await supabaseAdmin.from('assets').select('property_id, organization_id').eq('id', id).eq('organization_id', access.organizationId).maybeSingle();
    if (!current) return NextResponse.json({ error: 'Asset not found' }, { status: 404 });

    const { error } = await supabaseAdmin.from('assets').update({ deleted_at: new Date().toISOString() }).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await supabaseAdmin.from('asset_events').insert({
        asset_id: id,
        organization_id: current.organization_id,
        property_id: current.property_id,
        event_type: 'status_change',
        title: 'Asset removed from register',
        created_by: access.user.id,
    });

    return NextResponse.json({ success: true });
}
