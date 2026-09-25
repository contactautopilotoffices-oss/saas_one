import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveAssetAccess, isAssetAccessError, readOrgId } from '@/backend/lib/assets/access';

/** GET /api/assets/categories — org-specific rows plus the global defaults, merged so an org override wins. */
export async function GET(request: NextRequest) {
    const access = await resolveAssetAccess(request, readOrgId(request));
    if (isAssetAccessError(access)) return access;

    const { data, error } = await supabaseAdmin
        .from('asset_categories')
        .select('id, organization_id, name, code, color, default_lifecycle_years, amc_required_by_default, sort_order, is_active')
        .or(`organization_id.eq.${access.organizationId},organization_id.is.null`)
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const byCode = new Map<string, any>();
    for (const row of (data || []).sort((a, b) => (a.organization_id ? 1 : 0) - (b.organization_id ? 1 : 0))) {
        byCode.set(row.code.toUpperCase(), row); // org rows processed last so they overwrite the global default
    }

    return NextResponse.json({ categories: [...byCode.values()].sort((a, b) => a.sort_order - b.sort_order) });
}

/** POST /api/assets/categories — add an org-specific category. Manager-only. */
export async function POST(request: NextRequest) {
    const body = await request.json();
    const access = await resolveAssetAccess(request, readOrgId(request, body));
    if (isAssetAccessError(access)) return access;
    if (!access.canManage) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { name, code, color, default_lifecycle_years, amc_required_by_default, sort_order } = body;
    if (!name || !code) return NextResponse.json({ error: 'name and code are required' }, { status: 400 });

    const { data, error } = await supabaseAdmin
        .from('asset_categories')
        .insert({
            organization_id: access.organizationId,
            name,
            code: String(code).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'CAT',
            color: color || '#708F96',
            default_lifecycle_years: default_lifecycle_years || 5,
            amc_required_by_default: !!amc_required_by_default,
            sort_order: sort_order ?? 100,
        })
        .select()
        .single();

    if (error) {
        if (error.code === '23505') return NextResponse.json({ error: 'A category with this code already exists' }, { status: 409 });
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ category: data }, { status: 201 });
}

/** PATCH /api/assets/categories?id= — edit an org-owned category (global defaults cannot be edited, only shadowed by a new one). */
export async function PATCH(request: NextRequest) {
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    const body = await request.json();
    const access = await resolveAssetAccess(request, readOrgId(request, body));
    if (isAssetAccessError(access)) return access;
    if (!access.canManage) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { data: existing } = await supabaseAdmin.from('asset_categories').select('organization_id').eq('id', id).maybeSingle();
    if (!existing) return NextResponse.json({ error: 'Category not found' }, { status: 404 });
    if (existing.organization_id !== access.organizationId) {
        return NextResponse.json({ error: 'This is a platform default category and cannot be edited directly — add an organization category with the same code to override it.' }, { status: 403 });
    }

    const EDITABLE = ['name', 'color', 'default_lifecycle_years', 'amc_required_by_default', 'sort_order', 'is_active'] as const;
    const updates: Record<string, unknown> = {};
    for (const key of EDITABLE) if (key in body) updates[key] = body[key];

    const { data, error } = await supabaseAdmin.from('asset_categories').update(updates).eq('id', id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ category: data });
}

/** DELETE /api/assets/categories?id= — deactivate an org-owned category. */
export async function DELETE(request: NextRequest) {
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    const access = await resolveAssetAccess(request, readOrgId(request));
    if (isAssetAccessError(access)) return access;
    if (!access.canManage) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { data: existing } = await supabaseAdmin.from('asset_categories').select('organization_id').eq('id', id).maybeSingle();
    if (!existing) return NextResponse.json({ error: 'Category not found' }, { status: 404 });
    if (existing.organization_id !== access.organizationId) {
        return NextResponse.json({ error: 'This is a platform default category and cannot be removed' }, { status: 403 });
    }

    const { error } = await supabaseAdmin.from('asset_categories').update({ is_active: false }).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
}
