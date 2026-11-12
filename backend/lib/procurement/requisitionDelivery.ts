import type { SupabaseClient } from '@supabase/supabase-js';
import { requisitionNotes } from '@/backend/lib/procurement/requisition-approval.mjs';
import { isMissingSchemaError } from '@/backend/lib/procurement/catalogAccess';
import { isValidUuid } from '@/backend/lib/utils';

/**
 * What a monthly requisition ordered, and how much of it delivery challans have
 * brought in. Shared by the challan route and the requisitions list, so both
 * count the same way. The requisition's own status is never changed by a
 * delivery: approval and Issue PO depend on it.
 */

export interface OrderedLine {
    catalog_item_id: string;
    item_name: string;
    unit: string;
    category: string;
    ordered_qty: number;
}

export interface DeliverySummary {
    /** none: no challan yet · partial: something still pending · delivered: everything ordered arrived */
    state: 'none' | 'partial' | 'delivered';
    items_ordered: number;
    items_complete: number;
    challans: number;
}

/** The lines a property actually asked for, keyed by catalog item id (row id 'cat-<id>'). */
export function orderedLines(record: Record<string, unknown>): Map<string, OrderedLine> {
    const notes = requisitionNotes(record) as { items?: unknown };
    const items = Array.isArray(notes.items) ? notes.items : [];
    const lines = new Map<string, OrderedLine>();

    for (const raw of items as Record<string, unknown>[]) {
        const qty = Number(raw?.requested_qty) || 0;
        if (qty <= 0) continue;
        const rowId = String(raw?.id || '');
        const catalogId = String(raw?.catalog_item_id || (rowId.startsWith('cat-') ? rowId.slice(4) : ''));
        if (!isValidUuid(catalogId)) continue;

        const existing = lines.get(catalogId);
        if (existing) {
            existing.ordered_qty += qty;
            continue;
        }
        lines.set(catalogId, {
            catalog_item_id: catalogId,
            item_name: String(raw?.name || 'Item'),
            unit: String(raw?.unit || ''),
            category: String(raw?.category || ''),
            ordered_qty: qty,
        });
    }
    return lines;
}

/**
 * Delivery progress for each requisition that has at least one confirmed
 * challan. Requisitions without one are simply absent from the map. A database
 * without the challan tables returns an empty map, so the list keeps working.
 */
export async function deliverySummaries(
    admin: SupabaseClient,
    records: Record<string, unknown>[]
): Promise<Map<string, DeliverySummary>> {
    const summaries = new Map<string, DeliverySummary>();
    const ids = records.map(r => String(r.id || '')).filter(isValidUuid);
    if (ids.length === 0) return summaries;

    const received = new Map<string, Map<string, number>>();
    const challans = new Map<string, number>();
    for (let i = 0; i < ids.length; i += 100) {
        const { data, error } = await admin
            .from('requisition_deliveries')
            .select('requisition_id, items:requisition_delivery_items(catalog_item_id, received_qty)')
            .eq('status', 'confirmed')
            .in('requisition_id', ids.slice(i, i + 100));
        if (error) {
            if (isMissingSchemaError(error)) return summaries;
            throw error;
        }
        for (const d of (data || []) as { requisition_id: string; items: { catalog_item_id: string | null; received_qty: number }[] | null }[]) {
            challans.set(d.requisition_id, (challans.get(d.requisition_id) || 0) + 1);
            const perItem = received.get(d.requisition_id) || new Map<string, number>();
            for (const item of d.items || []) {
                if (!item.catalog_item_id) continue;
                perItem.set(item.catalog_item_id, (perItem.get(item.catalog_item_id) || 0) + Number(item.received_qty || 0));
            }
            received.set(d.requisition_id, perItem);
        }
    }

    for (const record of records) {
        const id = String(record.id || '');
        if (!challans.has(id)) continue;
        const lines = [...orderedLines(record).values()];
        const got = received.get(id) || new Map<string, number>();
        const complete = lines.filter(l => (got.get(l.catalog_item_id) || 0) >= l.ordered_qty).length;
        summaries.set(id, {
            state: lines.length > 0 && complete === lines.length ? 'delivered' : 'partial',
            items_ordered: lines.length,
            items_complete: complete,
            challans: challans.get(id) || 0,
        });
    }
    return summaries;
}
