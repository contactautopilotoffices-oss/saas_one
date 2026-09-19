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
}
