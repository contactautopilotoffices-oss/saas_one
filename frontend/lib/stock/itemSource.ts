/**
 * Which stock list a property is using.
 *
 * 'legacy'  - the property's own item list, as it was before the switch.
 * 'catalog' - one row per item the property sees in its monthly requisition.
 *
 * Both kinds live in stock_items, told apart by stock_items.item_source. A property
 * only ever works with one of them; the other is kept untouched. Every helper here
 * treats a missing column or setting as 'legacy', so a database that has not had
 * 20261026000001 yet behaves exactly as before.
 */

export type StockItemSource = 'legacy' | 'catalog';

/** Item codes the old requisition auto-sync gave the rows it created. */
export const AUTO_SYNC_CODE_PREFIX = 'STK-';

export function toItemSource(value: unknown): StockItemSource {
    return value === 'catalog' ? 'catalog' : 'legacy';
}

export function itemSourceOf(item: { item_source?: string | null } | null | undefined): StockItemSource {
    return toItemSource(item?.item_source);
}

export function liveItems<T extends { item_source?: string | null }>(items: T[], source: StockItemSource): T[] {
    return items.filter(item => itemSourceOf(item) === source);
}

/**
 * Movements that belong to the list the property is using. Movements whose item
 * was deleted (item_id null) only show while the property is on its old list,
 * which is where they came from.
 */
export function movementsForItems<T extends { item_id?: string | null }>(
    movements: T[],
    liveItemIds: Set<string>,
    source: StockItemSource
): T[] {
    return movements.filter(m => (m.item_id ? liveItemIds.has(m.item_id) : source === 'legacy'));
}

/**
 * Run a query with the list filter in the query itself (so row limits apply to
 * the right list), and once more without it if that fails, e.g. on a database
 * without 20261026000001, which has no item_source column. Callers still filter
 * in JavaScript, so both paths show the same rows.
 */
export async function withListFilter<R extends { error: unknown }>(run: (filtered: boolean) => PromiseLike<R>): Promise<R> {
    const filtered = await run(true);
    return filtered.error ? run(false) : filtered;
}

/** Stock item code for a requisition item: stable, and never clashes with old codes. */
export function requisitionStockCode(catalogItem: { id: string; item_code?: string | null }): string {
    const base = catalogItem.item_code || `ITM-${catalogItem.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    return `REQ-${base}`;
}
