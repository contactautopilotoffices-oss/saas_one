import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import { isMissingSchemaError, isProcurementUser } from '@/backend/lib/procurement/catalogAccess';
import { addMissingRequisitionItems } from '@/backend/lib/stock/propertyStock';
import { AUTO_SYNC_CODE_PREFIX, itemSourceOf, toItemSource } from '@/frontend/lib/stock/itemSource';

const MISSING_STOCK_SCHEMA =
    'The stock switch has not been applied to this database yet. Run the pending Supabase migration 20261026000001 and try again.';

/** Same people who manage the requisition item list: procurement, org super admin, master admin. */
async function canManageStockSettings(userId: string, orgId: string): Promise<boolean> {
    if (await isProcurementUser(userId, orgId)) return true;
    const { data } = await createAdminClient()
        .from('users')
        .select('is_master_admin')
        .eq('id', userId)
        .maybeSingle();
    return Boolean(data?.is_master_admin);
}

async function requireManager(orgId: string) {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
    if (!(await canManageStockSettings(user.id, orgId))) {
        return { error: NextResponse.json({ error: 'Only procurement, org super admins or master admins can change stock settings' }, { status: 403 }) };
    }
    return { user };
}

/** Every property of the org with the stock list it uses. */
export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ orgId: string }> }
) {
    const { orgId } = await params;

    try {
        const auth = await requireManager(orgId);
        if (auth.error) return auth.error;

        const admin = createAdminClient();
        const { data: properties, error: propError } = await admin
            .from('properties')
            .select('id, name, code')
            .eq('organization_id', orgId)
            .order('name');
        if (propError) return NextResponse.json({ error: propError.message }, { status: 500 });

        const { data: settings, error: settingsError } = await admin
            .from('property_stock_settings')
            .select('property_id, item_source, switched_at, switched_by_user:users!switched_by(full_name)')
            .eq('organization_id', orgId);
        const schemaMissing = isMissingSchemaError(settingsError);
        if (settingsError && !schemaMissing) return NextResponse.json({ error: settingsError.message }, { status: 500 });

        // Paged: PostgREST returns at most 1000 rows per request.
        const items: Record<string, unknown>[] = [];
        for (let from = 0; ; from += 1000) {
            const { data: page, error: itemsError } = await admin
                .from('stock_items')
                .select('*')
                .eq('organization_id', orgId)
                .order('id')
                .range(from, from + 999);
            if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 500 });
            items.push(...(page || []));
            if (!page || page.length < 1000) break;
        }

        const byProperty = new Map((settings || []).map(s => [s.property_id, s]));
        const counts = new Map<string, { old: number; requisition: number }>();
        for (const item of items as { property_id: string; item_code?: string; item_source?: string }[]) {
            const c = counts.get(item.property_id) || { old: 0, requisition: 0 };
            if (itemSourceOf(item) === 'catalog') c.requisition++;
            else if (!String(item.item_code || '').startsWith(AUTO_SYNC_CODE_PREFIX)) c.old++;
            counts.set(item.property_id, c);
        }

        return NextResponse.json({
            success: true,
            schema_ready: !schemaMissing,
            properties: (properties || []).map(p => {
                const s = byProperty.get(p.id) as { item_source?: string; switched_at?: string; switched_by_user?: { full_name?: string } | null } | undefined;
                const c = counts.get(p.id) || { old: 0, requisition: 0 };
                return {
                    id: p.id,
                    name: p.name,
                    code: p.code,
                    item_source: toItemSource(s?.item_source),
                    switched_at: s?.switched_at || null,
                    switched_by: s?.switched_by_user?.full_name || null,
                    old_item_count: c.old,
                    requisition_item_count: c.requisition,
                };
            }),
        });
    } catch (err) {
        return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
    }
}

/**
 * Switch one property between its old list and the requisition item list.
 * Body: { property_id, item_source: 'legacy' | 'catalog' }
 *
 * Switching to 'catalog' adds a stock row at quantity 0 for every item the
 * property sees in its monthly requisition. Old items are never changed, so
 * switching back shows them exactly as they were.
 */
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ orgId: string }> }
) {
    const { orgId } = await params;

    try {
        const auth = await requireManager(orgId);
        if (auth.error) return auth.error;

        const body = await request.json();
        const propertyId = String(body?.property_id || '');
        if (!['legacy', 'catalog'].includes(body?.item_source)) {
            return NextResponse.json({ error: "item_source must be 'legacy' or 'catalog'" }, { status: 400 });
        }
        const itemSource = toItemSource(body.item_source);

        const admin = createAdminClient();
        const { data: property } = await admin
            .from('properties')
            .select('id, organization_id, code')
            .eq('id', propertyId)
            .eq('organization_id', orgId)
            .maybeSingle();
        if (!property) return NextResponse.json({ error: 'Property not found in this organization' }, { status: 404 });

        // Rows first, then the switch: if adding rows fails, the property stays on
        // the list it had and nobody sees a half-built one.
        let added = 0;
        if (itemSource === 'catalog') {
            const result = await addMissingRequisitionItems(admin, {
                organizationId: orgId,
                propertyId,
                propertyCode: property.code,
                userId: auth.user.id,
            });
            added = result.added;
            if (result.total === 0) {
                return NextResponse.json({
                    error: 'This property has no items on its monthly requisition list yet. Assign items to it in Manage Items Master first.',
                }, { status: 409 });
            }
        }

        const { error: upsertError } = await admin
            .from('property_stock_settings')
            .upsert({
                property_id: propertyId,
                organization_id: orgId,
                item_source: itemSource,
                switched_at: new Date().toISOString(),
                switched_by: auth.user.id,
                updated_at: new Date().toISOString(),
            }, { onConflict: 'property_id' });

        if (upsertError) {
            const message = isMissingSchemaError(upsertError) ? MISSING_STOCK_SCHEMA : upsertError.message;
            return NextResponse.json({ error: message }, { status: isMissingSchemaError(upsertError) ? 503 : 500 });
        }

        return NextResponse.json({ success: true, item_source: itemSource, added });
    } catch (err) {
        const error = err as { code?: string; message?: string };
        if (isMissingSchemaError(error)) {
            return NextResponse.json({ error: MISSING_STOCK_SCHEMA }, { status: 503 });
        }
        return NextResponse.json({ error: error?.message || 'Unknown error' }, { status: 500 });
    }
}
