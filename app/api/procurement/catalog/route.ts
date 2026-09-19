import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import { isValidUuid } from '@/backend/lib/utils';
import { canUserSeePrices } from '@/backend/lib/procurement';
import { isMissingSchemaError, MISSING_SCHEMA_MESSAGE } from '@/backend/lib/procurement/catalogAccess';

const CATALOG_LIFECYCLES = ['standard', 'legacy', 'retired'];

// ─── Role helper ──────────────────────────────────────────────────────────────
async function isProcurementUser(userId: string, organizationId: string): Promise<boolean> {
    if (!isValidUuid(organizationId)) return false;
    const adminSupabase = createAdminClient();
    const { data } = await adminSupabase
        .from('organization_memberships')
        .select('role')
        .eq('user_id', userId)
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .maybeSingle();
    return ['procurement', 'org_super_admin', 'master_admin'].includes(data?.role || '');
}

// ─── Org Resolver ────────────────────────────────────────────────────────────
async function resolveOrganizationId(userId: string, providedId: string | null): Promise<string | null> {
    if (providedId && isValidUuid(providedId)) return providedId;
    
    const adminSupabase = createAdminClient();
    const { data } = await adminSupabase
        .from('organization_memberships')
        .select('organization_id')
        .eq('user_id', userId)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();
        
    return data?.organization_id || null;
}

// ─── GET — list catalog items ─────────────────────────────────────────────────
// Price is returned as null for non-procurement users
export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { searchParams } = new URL(request.url);
        const providedOrgId = searchParams.get('organizationId');
        const providedPropId = searchParams.get('propertyId');
        
        const organizationId = await resolveOrganizationId(user.id, providedOrgId);
        

        if (!organizationId) {
            return NextResponse.json({ error: 'Valid Organization ID is required' }, { status: 400 });
        }

        const adminSupabase = createAdminClient();
        const canSeePrice = await canUserSeePrices(user.id, organizationId, providedPropId || undefined);

        // select('*') rather than a column list: item_code / brand / unit_price /
        // sort_order / lifecycle only exist once the standard-items migrations have
        // run, and naming a missing column here would 500 the whole catalog.
        const { data: catalog, error } = await adminSupabase
            .from('procurement_catalog')
            .select('*')
            .eq('organization_id', organizationId)
            .eq('is_active', true)
            .order('name');

        if (error) {
            console.error('[Catalog GET] Error:', error);
            return NextResponse.json({ error: 'Database error' }, { status: 500 });
        }

        // Mask price for non-procurement users
        const result = (catalog || []).map(item => ({
            id: item.id,
            name: item.name,
            description: item.description,
            photo_url: item.photo_url,
            category: item.category,
            unit: item.unit,
            estimated_price: canSeePrice ? item.estimated_price : null,
            // Template fields. Undefined before the migrations; normalised so the
            // manager UI can render and edit them either way.
            item_code: item.item_code ?? null,
            brand: item.brand ?? null,
            color_size_details: item.color_size_details ?? null,
            unit_price: canSeePrice ? (item.unit_price ?? item.estimated_price ?? 0) : null,
            sort_order: Number(item.sort_order) || 0,
            lifecycle: item.lifecycle || 'standard',
        }));

        // Sr. No. order, unnumbered items last. Sorted here rather than in the query
        // because sort_order may not exist yet.
        result.sort((a, b) => {
            const aOrder = a.sort_order > 0 ? a.sort_order : Number.MAX_SAFE_INTEGER;
            const bOrder = b.sort_order > 0 ? b.sort_order : Number.MAX_SAFE_INTEGER;
            if (aOrder !== bOrder) return aOrder - bOrder;
            return String(a.name).localeCompare(String(b.name));
        });

        return NextResponse.json(result);
    } catch (error) {
        console.error('[Catalog GET] API Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// ─── POST — add new catalog item (procurement role only) ──────────────────────
export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const body = await request.json();
        const {
            name, description, category, estimated_price, unit,
            brand, color_size_details, unit_price, sort_order,
            organization_id: providedOrgId, photo_base64, photo_url: existingPhotoUrl,
        } = body;

        const organization_id = await resolveOrganizationId(user.id, providedOrgId);

        if (!organization_id || !name) {
            return NextResponse.json({ error: 'Valid Organization ID and Name are required' }, { status: 400 });
        }

        const adminSupabase = createAdminClient();

        // ── Role gate ────────────────────────────────────────────────────────
        if (!(await isProcurementUser(user.id, organization_id))) {
            return NextResponse.json({ error: 'Forbidden: procurement role required' }, { status: 403 });
        }

        // ── Check for duplicates ──────────────────────────────────────────────
        const { data: existing } = await adminSupabase
            .from('procurement_catalog')
            .select('id')
            .eq('organization_id', organization_id)
            .ilike('name', name)
            .eq('is_active', true)
            .maybeSingle();

        if (existing) {
            return NextResponse.json({ error: `An item named "${name}" already exists in the catalog.` }, { status: 409 });
        }

        let finalPhotoUrl = existingPhotoUrl;

        if (photo_base64 && photo_base64.startsWith('data:image')) {
            try {
                const bucketName = 'procurement-items';
                const fileName = `${organization_id}/${Date.now()}-${name.replace(/\s+/g, '-').toLowerCase()}.webp`;
                const base64Data = photo_base64.split(',')[1];
                const buffer = Buffer.from(base64Data, 'base64');

                const { error: uploadError } = await adminSupabase.storage
                    .from(bucketName)
                    .upload(fileName, buffer, { contentType: 'image/webp', upsert: true });

                if (!uploadError) {
                    const { data: { publicUrl } } = adminSupabase.storage.from(bucketName).getPublicUrl(fileName);
                    finalPhotoUrl = publicUrl;
                } else {
                    console.error('[Catalog POST] Storage upload error:', uploadError);
                }
            } catch (uploadErr) {
                console.error('[Catalog POST] Upload error:', uploadErr);
            }
        }

        // Price: unit_price is what the template writes, estimated_price is what
        // older screens still read. Keep them in step.
        const price = parseFloat(String(unit_price ?? estimated_price ?? '')) || 0;
        const parsedSort = parseInt(String(sort_order ?? ''), 10);

        // An item added by hand must be indistinguishable from one that arrived on
        // the template — same fields, and on the standard list from the start.
        const insert: Record<string, unknown> = {
            organization_id,
            name,
            description: description || null,
            category: category || null,
            unit: unit || 'pcs',
            estimated_price: price,
            unit_price: price,
            brand: brand || null,
            color_size_details: color_size_details || null,
            sort_order: Number.isFinite(parsedSort) ? parsedSort : 0,
            lifecycle: 'standard',
            photo_url: finalPhotoUrl,
            is_active: true,
        };

        const { data, error } = await adminSupabase
            .from('procurement_catalog')
            .insert(insert)
            .select()
            .single();

        if (error) {
            console.error('[Catalog POST] DB error:', error);
            if (isMissingSchemaError(error)) {
                return NextResponse.json({ error: MISSING_SCHEMA_MESSAGE }, { status: 503 });
            }
            return NextResponse.json({ error: 'Database error', details: error.message }, { status: 500 });
        }

        return NextResponse.json(data);
    } catch (error) {
        console.error('[Catalog POST] API Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// ─── PATCH — edit existing catalog item (procurement role only) ───────────────
export async function PATCH(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const body = await request.json();
        const { id, name, organization_id: providedOrgId, photo_base64, photo_url: existingPhotoUrl } = body;

        const organization_id = await resolveOrganizationId(user.id, providedOrgId);

        if (!id || !organization_id) {
            return NextResponse.json({ error: 'Item ID and Valid Organization ID are required' }, { status: 400 });
        }

        const adminSupabase = createAdminClient();

        if (!(await isProcurementUser(user.id, organization_id))) {
            return NextResponse.json({ error: 'Forbidden: procurement role required' }, { status: 403 });
        }

        // ── Duplicate check, only when the name is actually being changed.
        //    Inline edits send a single field, so an absent name must not be
        //    treated as a rename to "undefined".
        if (typeof name === 'string' && name.trim()) {
            const { data: existing } = await adminSupabase
                .from('procurement_catalog')
                .select('id')
                .eq('organization_id', organization_id)
                .ilike('name', name.trim())
                .eq('is_active', true)
                .neq('id', id)
                .maybeSingle();

            if (existing) {
                return NextResponse.json({ error: `Another item named "${name.trim()}" already exists.` }, { status: 409 });
            }
        }

        let finalPhotoUrl = existingPhotoUrl;

        if (photo_base64 && photo_base64.startsWith('data:image')) {
            const bucketName = 'procurement-items';
            const fileName = `${organization_id}/${Date.now()}-${(name || 'item').replace(/\s+/g, '-').toLowerCase()}.webp`;
            const base64Data = photo_base64.split(',')[1];
            const buffer = Buffer.from(base64Data, 'base64');

            const { error: uploadError } = await adminSupabase.storage
                .from(bucketName)
                .upload(fileName, buffer, { contentType: 'image/webp', upsert: true });

            if (!uploadError) {
                const { data: { publicUrl } } = adminSupabase.storage.from(bucketName).getPublicUrl(fileName);
                finalPhotoUrl = publicUrl;
            }
        }

        // ── Partial update: only the fields actually sent are written, so a
        //    single-cell edit cannot blank out everything else on the row.
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

        if (typeof name === 'string' && name.trim()) patch.name = name.trim();
        if ('description' in body) patch.description = body.description || null;
        if ('category' in body) patch.category = body.category || null;
        if ('unit' in body) patch.unit = body.unit || 'pcs';
        if ('brand' in body) patch.brand = body.brand || null;
        if ('color_size_details' in body) patch.color_size_details = body.color_size_details || null;
        if ('lifecycle' in body && CATALOG_LIFECYCLES.includes(body.lifecycle)) patch.lifecycle = body.lifecycle;

        if ('sort_order' in body) {
            const parsed = parseInt(String(body.sort_order ?? ''), 10);
            patch.sort_order = Number.isFinite(parsed) ? parsed : 0;
        }

        // The two price columns are kept in step: unit_price is what the template
        // writes, estimated_price is what older screens still read.
        const rawPrice = 'unit_price' in body ? body.unit_price
            : ('estimated_price' in body ? body.estimated_price : undefined);
        if (rawPrice !== undefined) {
            const parsed = parseFloat(String(rawPrice ?? ''));
            const price = Number.isFinite(parsed) ? parsed : 0;
            patch.unit_price = price;
            patch.estimated_price = price;
        }

        if (finalPhotoUrl !== undefined) patch.photo_url = finalPhotoUrl;

        const { data, error } = await adminSupabase
            .from('procurement_catalog')
            .update(patch)
            .eq('id', id)
            .eq('organization_id', organization_id)
            .select()
            .single();

        if (error) {
            console.error('[Catalog PATCH] DB error:', error);
            if (isMissingSchemaError(error)) {
                return NextResponse.json({ error: MISSING_SCHEMA_MESSAGE }, { status: 503 });
            }
            return NextResponse.json({ error: 'Database error', details: error.message }, { status: 500 });
        }

        return NextResponse.json(data);
    } catch (error) {
        console.error('[Catalog PATCH] API Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// ─── DELETE — soft-delete catalog item (procurement role only) ────────────────
export async function DELETE(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const body = await request.json();
        const { id, organization_id: providedOrgId } = body;

        const organization_id = await resolveOrganizationId(user.id, providedOrgId);

        if (!id || !organization_id) {
            return NextResponse.json({ error: 'Item ID and Valid Organization ID are required' }, { status: 400 });
        }

        const adminSupabase = createAdminClient();

        if (!(await isProcurementUser(user.id, organization_id))) {
            return NextResponse.json({ error: 'Forbidden: procurement role required' }, { status: 403 });
        }

        const { error } = await adminSupabase
            .from('procurement_catalog')
            .update({ is_active: false, updated_at: new Date().toISOString() })
            .eq('id', id)
            .eq('organization_id', organization_id);

        if (error) {
            console.error('[Catalog DELETE] DB error:', error);
            return NextResponse.json({ error: 'Database error' }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[Catalog DELETE] API Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
