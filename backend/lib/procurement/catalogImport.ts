/**
 * Shared vocabulary for the catalog template import pipeline.
 * /import/preview writes these rows into catalog_import_batches.staged_rows;
 * /import/commit reads them back and applies them.
 */

export type StagedRowAction = 'create' | 'update' | 'unchanged' | 'error';

/** A spreadsheet-derived value: string, number, boolean or absent. */
export type CellValue = string | number | boolean | null | undefined;

export interface StagedCatalogRow {
    /** 1-based worksheet row, so every message points at something the uploader can find. */
    rowNumber: number;
    action: StagedRowAction;
    existing_id: string | null;
    item_code: string;
    name: string;
    /** Field-level diff shown in the preview; empty for creates. */
    changes: Record<string, { from: CellValue; to: CellValue }>;
    /** Exactly what gets written on commit — insert payload for creates, patch for updates. */
    values: Record<string, CellValue>;
    photo_url: string | null;
    errors: string[];
}

/**
 * Item lifecycle.
 *   standard — on the current standard template. The only thing a property is
 *              offered on a new monthly requisition.
 *   legacy   — predates the standard list, or was dropped from it. Stays in the
 *              catalog and in Manage Items, stays resolvable by anything that
 *              already references it, but is NOT offered on new requisitions.
 *   retired  — deactivated (is_active = false). Gone from Manage Items too.
 *              Never deleted, so history keeps resolving.
 */
export type CatalogLifecycle = 'standard' | 'legacy' | 'retired';

/** What the uploader chose to do with an item that the template did not mention. */
export type AbsentItemDecision = 'keep' | 'legacy' | 'retire';

/** Existing procurement_catalog row, as loaded for matching during preview. */
export interface ExistingCatalogRow {
    id: string;
    item_code: string | null;
    name: string;
    category: string | null;
    brand: string | null;
    color_size_details: string | null;
    unit: string | null;
    unit_price: number | null;
    estimated_price: number | null;
    photo_url: string | null;
    sort_order: number | null;
    description: string | null;
    is_active: boolean;
    lifecycle: CatalogLifecycle;
}

/**
 * An active item the uploaded template did not mention.
 * `stock_property_count` / `stock_total_qty` answer the question that actually
 * decides its fate: is any site still holding this?
 */
export interface AbsentCatalogItem {
    id: string;
    item_code: string | null;
    name: string;
    category: string | null;
    lifecycle: CatalogLifecycle;
    stock_property_count: number;
    stock_total_qty: number;
}

/** One lifecycle/visibility change applied by a commit, recorded so it can be undone. */
export interface LifecycleChange {
    id: string;
    name: string;
    from_lifecycle: CatalogLifecycle;
    from_is_active: boolean;
    to_lifecycle: CatalogLifecycle;
    to_is_active: boolean;
}
