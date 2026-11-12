import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import { isMissingSchemaError } from '@/backend/lib/procurement/catalogAccess';
import {
    AUTO_SYNC_CODE_PREFIX,
    itemSourceOf,
    requisitionStockCode,
    toItemSource,
    type StockItemSource,
} from '@/frontend/lib/stock/itemSource';

/**
 * Server side of the per-property stock switch (see frontend/lib/stock/itemSource.ts).
 *
 * Nothing here matches items by name or touches a 'legacy' row. Requisition items
 * are only ever added, keyed on catalog_item_id.
 */

/**
 * Read with the admin client on purpose: the switch is not sensitive, and every
 * caller (a property member, procurement, the nightly job) must see the same
 * answer, or one of them would be shown the wrong list. Which rows a caller may
 * read is still decided by RLS on stock_items.
 */
export async function getPropertyStockSource(propertyId: string): Promise<StockItemSource> {
    const { data, error } = await createAdminClient()
        .from('property_stock_settings')
        .select('item_source')
        .eq('property_id', propertyId)
        .maybeSingle();

    // Migration not run, or no row: the property is on its old list. Any other
    // error must not be guessed at: guessing 'legacy' would unlock deleting a
    // switched property's requisition items.
    if (error && !isMissingSchemaError(error)) throw error;
    if (!data) return 'legacy';
    return toItemSource(data.item_source);
}

const PAGE_SIZE = 1000;

/** Every row of a query, page by page: PostgREST returns at most 1000 rows per request. */
async function fetchAllRows<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
    const rows: T[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await page(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        rows.push(...(data || []));
        if (!data || data.length < PAGE_SIZE) return rows;
    }
}

export const OLD_ITEM_LOCKED_MESSAGE =
    'This is an old stock item. This property now uses its monthly requisition items. Print the new QR codes from the Stock tab.';

export const REQUISITION_LIST_LOCKED_MESSAGE =
    'Items on this stock list come from the monthly requisition list and cannot be added or deleted here.';

/** Is this row on the list the property is currently using? */
export async function isLiveStockItem(
    propertyId: string,
    item: { item_source?: string | null }
): Promise<boolean> {
    return itemSourceOf(item) === await getPropertyStockSource(propertyId);
}

/** Batch version for jobs that walk every property. */
export async function getStockSourcesByProperty(propertyIds: string[]): Promise<Map<string, StockItemSource>> {
    const sources = new Map<string, StockItemSource>();
    if (propertyIds.length === 0) return sources;

    // Chunked so a large organisation does not overflow the request URL.
    const admin = createAdminClient();
    for (let i = 0; i < propertyIds.length; i += 100) {
        const { data, error } = await admin
            .from('property_stock_settings')
            .select('property_id, item_source')
            .in('property_id', propertyIds.slice(i, i + 100));

        if (error) {
            if (isMissingSchemaError(error)) return sources;
            throw error;
        }
        for (const row of data || []) sources.set(row.property_id, toItemSource(row.item_source));
    }
    return sources;
}

/**
 * Does the property have old stock worth showing? Rows the removed requisition
 * auto-sync created (STK- codes) do not count unless someone actually recorded a
 * movement on them, so a property that never used stock management gets no
 * Old Stock tab.
 */
export async function countRealOldItems(supabase: SupabaseClient, propertyId: string): Promise<number> {
    try {
        const legacy = await fetchAllRows<{ id: string; item_code: string | null }>((from, to) => supabase
            .from('stock_items')
            .select('id, item_code')
            .eq('property_id', propertyId)
            .eq('item_source', 'legacy')
            .order('id')
            .range(from, to));

        const autoCreatedIds = legacy
            .filter(i => String(i.item_code || '').startsWith(AUTO_SYNC_CODE_PREFIX))
            .map(i => i.id);

        const movedAutoCreated = new Set<string>();
        for (let i = 0; i < autoCreatedIds.length; i += 100) {
            const { data: moved, error } = await supabase
                .from('stock_movements')
                .select('item_id')
                .in('item_id', autoCreatedIds.slice(i, i + 100));
            if (error) throw error;
            for (const m of moved || []) movedAutoCreated.add(m.item_id as string);
        }

        return legacy.filter(i =>
            !String(i.item_code || '').startsWith(AUTO_SYNC_CODE_PREFIX) || movedAutoCreated.has(i.id)
        ).length;
    } catch {
        // Only decides whether an Old Stock tab is shown; never block the stock screen on it.
        return 0;
    }
}

interface StockRowsInput {
    organizationId: string;
    propertyId: string;
    propertyCode?: string | null;
    userId?: string | null;
}

export interface CatalogItemForStock {
    id: string;
    name: string;
    item_code?: string | null;
    category?: string | null;
    unit?: string | null;
}

/**
 * Make sure each given catalog item has a requisition-list stock row at this
 * property (item_source 'catalog', quantity 0 when new). Existing rows, old or
 * new, are left exactly as they are. Safe to run any number of times.
 */
export async function ensureStockRowsForCatalogItems(
    supabase: SupabaseClient,
    { organizationId, propertyId, propertyCode, userId }: StockRowsInput,
    catalogItems: CatalogItemForStock[]
): Promise<number> {
    if (catalogItems.length === 0) return 0;

    for (let attempt = 0; attempt < 2; attempt++) {
        const existing = await fetchAllRows<{ catalog_item_id: string | null }>((from, to) => supabase
            .from('stock_items')
            .select('catalog_item_id')
            .eq('property_id', propertyId)
            .eq('item_source', 'catalog')
            .order('id')
            .range(from, to));

        const have = new Set(existing.map(i => i.catalog_item_id).filter((id): id is string => Boolean(id)));
        const missing = catalogItems.filter(c => !have.has(c.id));
        if (missing.length === 0) return 0;

        const prefix = (propertyCode || 'PROP').toUpperCase();
        const now = new Date().toISOString();
        const rows = missing.map(c => {
            const itemCode = requisitionStockCode(c);
            // Set explicitly: the insert trigger would give every row of one batch the same barcode.
            const barcode = `${prefix}-${itemCode}`;
            return {
                organization_id: organizationId,
                property_id: propertyId,
                catalog_item_id: c.id,
                item_source: 'catalog',
                item_code: itemCode,
                name: c.name,
                category: c.category || 'General',
                unit: c.unit || 'pcs',
                quantity: 0,
                barcode,
                barcode_format: 'CODE128',
                barcode_generated_at: now,
                qr_code_data: { item_code: itemCode, name: c.name, property_id: propertyId, barcode },
                created_by: userId || null,
            };
        });

        const { error: insertError } = await supabase.from('stock_items').insert(rows);
        if (!insertError) return rows.length;

        // Someone else added the same items a moment ago: re-read and try once more.
        if (insertError.code !== '23505' || attempt === 1) throw insertError;
    }
    return 0;
}

/**
 * Every item the property sees in its monthly requisition gets a stock row.
 *
 * `supabase` is the caller's client when a property member opens the stock tab
 * (RLS decides), or the admin client when an org admin flips the switch.
 */
export async function addMissingRequisitionItems(
    supabase: SupabaseClient,
    input: StockRowsInput
): Promise<{ added: number; total: number }> {
    const catalog = await getRequisitionCatalog(input.organizationId, input.propertyId);
    const added = await ensureStockRowsForCatalogItems(supabase, input, catalog);
    return { added, total: catalog.length };
}

/**
 * The items a property sees on its monthly requisition, with the same rule as
 * the requisition sheet (getCatalogWithSitePrices): active, on the standard
 * list, and assigned to the property or to everyone. Read here rather than
 * through that helper because it returns [] on a query error, and an empty
 * list must never be mistaken for "no items".
 */
export async function getRequisitionCatalog(organizationId: string, propertyId: string): Promise<CatalogItemForStock[]> {
    const admin = createAdminClient();
    type CatalogRow = CatalogItemForStock & { lifecycle?: string; assigned_property_ids?: string[] | null };
    const data = await fetchAllRows<CatalogRow>((from, to) => admin
        .from('procurement_catalog')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .order('id')
        .range(from, to));

    return data
        .filter((item: { lifecycle?: string; assigned_property_ids?: string[] | null }) => {
            if (item.lifecycle && item.lifecycle !== 'standard') return false;
            const assigned = Array.isArray(item.assigned_property_ids) ? item.assigned_property_ids : [];
            return assigned.length === 0 || assigned.includes('ALL') || assigned.includes(propertyId);
        })
        .map((item: { id: string; name: string; item_code?: string | null; category?: string | null; unit?: string | null }) => ({
            id: item.id,
            name: item.name,
            item_code: item.item_code ?? null,
            category: item.category || 'HK',
            unit: item.unit || 'pcs',
        }));
}
