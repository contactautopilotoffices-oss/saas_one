import { z } from 'zod';

export const draftSchema = z.object({
    floorTag: z.string().trim().min(1).max(100), month: z.number().int().min(1).max(12),
    year: z.number().int().min(2000).max(2200), siteNotes: z.string().max(20000),
    items: z.array(z.object({
        // Catalog categories are free text (including older/custom labels).
        // A draft must preserve them rather than reject the entire unfinished sheet.
        id: z.string().min(1).max(200), category: z.string().max(1000),
        name: z.string().max(1000), brand: z.string().max(500), details: z.string().max(2000),
        requested_qty: z.number().finite().nonnegative(), available_stock_qty: z.number().finite().nonnegative(),
        unit: z.string().max(100), unit_price: z.number().finite().nonnegative(),
        remarks: z.string().max(2000).optional(), is_site_specific: z.boolean().optional(),
    })).max(1000),
});
export type DraftPayload = z.infer<typeof draftSchema>;
export type SavedDraft = { payload: DraftPayload; updated_at: string; base_updated_at?: string | null };
export const draftStorageKey = (userId: string, orgId: string, propertyId: string) =>
    `monthly-requisition-drafts:v1:${userId}:${orgId}:${propertyId}`;
export const draftPeriodKey = (payload: DraftPayload) => `${payload.year}:${payload.month}:${payload.floorTag}`;
export const newestDraft = (drafts: SavedDraft[]) =>
    [...drafts].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0] || null;
