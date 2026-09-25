import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveAssetAccess, isAssetAccessError, readOrgId, scopedPropertyIds, canAccessProperty } from '@/backend/lib/assets/access';
import { ASSET_SELECT, enrichAssets } from '@/backend/lib/assets/enrich';

/**
 * GET /api/assets — list/search the asset register.
 * Query: organization_id (required unless single-org), property_id, category_id,
 *        floor, status, grade (P1|P2|P3), search, page, page_size.
 */
export async function GET(request: NextRequest) {
    const access = await resolveAssetAccess(request, readOrgId(request));
    if (isAssetAccessError(access)) return access;

    const sp = new URL(request.url).searchParams;
    const propertyId = sp.get('property_id');
    const categoryId = sp.get('category_id');
    const floor = sp.get('floor');
    const status = sp.get('status');
    const grade = sp.get('grade');
    const search = (sp.get('search') || '').trim();
    const page = Math.max(1, parseInt(sp.get('page') || '1'));
    const pageSize = Math.min(200, Math.max(1, parseInt(sp.get('page_size') || '50')));

    const propIds = scopedPropertyIds(access, propertyId);
    if (propIds !== null && propIds.length === 0) {
        return NextResponse.json({ error: 'Forbidden: no access to this property' }, { status: 403 });
    }

    let query = supabaseAdmin
        .from('assets')
        .select(ASSET_SELECT, { count: 'exact' })
        .eq('organization_id', access.organizationId)
        .is('deleted_at', null);

    if (propIds !== null) query = query.in('property_id', propIds);
    if (categoryId) query = query.eq('category_id', categoryId);
    if (floor) query = query.eq('floor', floor);
    if (status) query = query.eq('status', status);
    if (search) query = query.or(`name.ilike.%${search}%,asset_code.ilike.%${search}%,serial_number.ilike.%${search}%,model.ilike.%${search}%`);

    query = query.order('created_at', { ascending: false });

    // Grade is computed, not stored — page before filtering by it so counts stay honest,
    // then re-page after. Fine at this scale (assets per property rarely exceed a few thousand).
    const { data, error, count } = grade
        ? await query
        : await query.range((page - 1) * pageSize, page * pageSize - 1);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    let enriched = await enrichAssets((data || []) as any);
    let total = count || 0;

    if (grade) {
        enriched = enriched.filter((a) => a.health.grade === grade);
        total = enriched.length;
        enriched = enriched.slice((page - 1) * pageSize, page * pageSize);
    }

    return NextResponse.json({
        assets: enriched,
        pagination: { page, page_size: pageSize, total, total_pages: Math.max(1, Math.ceil(total / pageSize)) },
    });
}

/**
 * POST /api/assets — register one asset. Auto-generates asset_code when omitted.
 */
export async function POST(request: NextRequest) {
    const body = await request.json();
    const access = await resolveAssetAccess(request, readOrgId(request, body));
    if (isAssetAccessError(access)) return access;
    if (!access.canManage) return NextResponse.json({ error: 'Forbidden: you cannot add assets' }, { status: 403 });

    const {
        property_id, category_id, name, asset_code, asset_type, make, model, serial_number,
        floor, location, installation_date, purchase_cost, vendor_name, lifecycle_years,
        warranty_start, warranty_end, amc_required, amc_contract_id, notes, custom_fields,
    } = body;

    if (!property_id || !name) {
        return NextResponse.json({ error: 'property_id and name are required' }, { status: 400 });
    }
    if (!canAccessProperty(access, property_id)) {
        return NextResponse.json({ error: 'Forbidden: no access to this property' }, { status: 403 });
    }

    let code = (asset_code || '').trim();
    if (!code) {
        let categoryCode = 'GEN';
        if (category_id) {
            const { data: cat } = await supabaseAdmin.from('asset_categories').select('code').eq('id', category_id).maybeSingle();
            if (cat?.code) categoryCode = cat.code;
        }
        const { data: generated, error: genErr } = await supabaseAdmin.rpc('generate_asset_code', {
            p_org_id: access.organizationId,
            p_property_id: property_id,
            p_category_code: categoryCode,
        });
        if (genErr) return NextResponse.json({ error: `Could not generate asset code: ${genErr.message}` }, { status: 500 });
        code = generated as string;
    }

    const { data, error } = await supabaseAdmin
        .from('assets')
        .insert({
            organization_id: access.organizationId,
            property_id,
            category_id: category_id || null,
            asset_code: code,
            name,
            asset_type: asset_type || null,
            make: make || null,
            model: model || null,
            serial_number: serial_number || null,
            floor: floor || null,
            location: location || null,
            installation_date: installation_date || null,
            purchase_cost: purchase_cost ?? null,
            vendor_name: vendor_name || null,
            lifecycle_years: lifecycle_years ?? null,
            warranty_start: warranty_start || null,
            warranty_end: warranty_end || null,
            amc_required: !!amc_required,
            amc_contract_id: amc_contract_id || null,
            notes: notes || null,
            custom_fields: custom_fields || {},
            created_by: access.user.id,
        })
        .select('id, asset_code, qr_token')
        .single();

    if (error) {
        if (error.code === '23505') return NextResponse.json({ error: `Asset code "${code}" already exists in this organization` }, { status: 409 });
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await supabaseAdmin.from('asset_events').insert({
        asset_id: data.id,
        organization_id: access.organizationId,
        property_id,
        event_type: 'created',
        title: 'Asset registered',
        created_by: access.user.id,
    });

    return NextResponse.json({ asset: data }, { status: 201 });
}
