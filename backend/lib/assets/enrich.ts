import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { computeAssetHealth, type AssetHealth } from './performance';

export const ASSET_SELECT = `
    id, organization_id, property_id, category_id, asset_code, qr_token, name, asset_type,
    make, model, serial_number, floor, location, installation_date, purchase_cost, vendor_name,
    lifecycle_years, warranty_start, warranty_end, amc_required, amc_contract_id, status, notes,
    custom_fields, created_by, created_at, updated_at,
    category:asset_categories(id, name, code, color, default_lifecycle_years),
    property:properties(id, name, code)
`;

export interface AssetRow {
    id: string;
    organization_id: string;
    property_id: string;
    category_id: string | null;
    asset_code: string;
    qr_token: string;
    name: string;
    asset_type: string | null;
    make: string | null;
    model: string | null;
    serial_number: string | null;
    floor: string | null;
    location: string | null;
    installation_date: string | null;
    purchase_cost: number | null;
    vendor_name: string | null;
    lifecycle_years: number | null;
    warranty_start: string | null;
    warranty_end: string | null;
    amc_required: boolean | null;
    amc_contract_id: string | null;
    status: string;
    notes: string | null;
    custom_fields: Record<string, unknown> | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
    category?: { id: string; name: string; code: string; color: string | null; default_lifecycle_years: number | null } | null;
    property?: { id: string; name: string; code: string | null } | null;
}

export interface AmcSummary {
    id: string;
    system_name: string;
    vendor_name: string;
    contract_start_date: string;
    contract_end_date: string;
    status: string;
    contract_value: number | null;
}

export type EnrichedAsset = AssetRow & {
    health: AssetHealth;
    amc: AmcSummary | null;
    open_tickets: number;
    overdue_ppm: number;
    total_cost: number;
};

const OPEN_TICKET_STATUSES = ['open', 'assigned', 'in_progress', 'blocked', 'waitlist', 'pending_validation'];

/**
 * Attach live signals (open tickets, overdue PPM, AMC) and the computed grade
 * to a page of assets. Three batched queries regardless of page size.
 */
export async function enrichAssets(assets: AssetRow[], today: Date = new Date()): Promise<EnrichedAsset[]> {
    if (assets.length === 0) return [];
    const ids = assets.map((a) => a.id);
    const amcIds = [...new Set(assets.map((a) => a.amc_contract_id).filter(Boolean))] as string[];
    const todayStr = today.toISOString().slice(0, 10);

    const [ticketLinks, ppmRes, amcRes, costRes] = await Promise.all([
        supabaseAdmin
            .from('asset_events')
            .select('asset_id, ticket_id, ticket:tickets!asset_events_ticket_id_fkey(id, status)')
            .in('asset_id', ids)
            .not('ticket_id', 'is', null),
        supabaseAdmin
            .from('ppm_schedules')
            .select('asset_id')
            .in('asset_id', ids)
            .eq('status', 'pending')
            .lt('planned_date', todayStr),
        amcIds.length
            ? supabaseAdmin
                .from('amc_contracts')
                .select('id, system_name, vendor_name, contract_start_date, contract_end_date, status, contract_value')
                .in('id', amcIds)
            : Promise.resolve({ data: [] as AmcSummary[] }),
        supabaseAdmin
            .from('asset_events')
            .select('asset_id, amount')
            .in('asset_id', ids)
            .not('amount', 'is', null),
    ]);

    // Distinct open tickets per asset (an asset may be logged twice on one ticket).
    const openByAsset = new Map<string, Set<string>>();
    for (const row of (ticketLinks.data || []) as any[]) {
        const t = Array.isArray(row.ticket) ? row.ticket[0] : row.ticket;
        if (!t || !OPEN_TICKET_STATUSES.includes(t.status)) continue;
        if (!openByAsset.has(row.asset_id)) openByAsset.set(row.asset_id, new Set());
        openByAsset.get(row.asset_id)!.add(t.id);
    }
    const overdueByAsset = new Map<string, number>();
    for (const row of (ppmRes.data || []) as { asset_id: string }[]) {
        overdueByAsset.set(row.asset_id, (overdueByAsset.get(row.asset_id) || 0) + 1);
    }
    const amcById = new Map<string, AmcSummary>();
    for (const c of (amcRes.data || []) as AmcSummary[]) amcById.set(c.id, c);
    const costByAsset = new Map<string, number>();
    for (const row of (costRes.data || []) as { asset_id: string; amount: number }[]) {
        costByAsset.set(row.asset_id, (costByAsset.get(row.asset_id) || 0) + Number(row.amount || 0));
    }

    return assets.map((a) => {
        const amc = a.amc_contract_id ? amcById.get(a.amc_contract_id) || null : null;
        const open_tickets = openByAsset.get(a.id)?.size || 0;
        const overdue_ppm = overdueByAsset.get(a.id) || 0;
        const health = computeAssetHealth({
            installation_date: a.installation_date,
            lifecycle_years: a.lifecycle_years,
            category_lifecycle_years: a.category?.default_lifecycle_years ?? null,
            warranty_end: a.warranty_end,
            amc_required: a.amc_required,
            amc: amc ? { contract_end_date: amc.contract_end_date, status: amc.status } : null,
            open_tickets,
            overdue_ppm,
            status: a.status,
        }, today);
        return { ...a, health, amc, open_tickets, overdue_ppm, total_cost: costByAsset.get(a.id) || 0 };
    });
}

/** Write one lifecycle event. Never throws — the ledger must not break the caller. */
export async function recordAssetEvent(event: {
    asset_id: string;
    organization_id: string;
    property_id: string;
    event_type: string;
    title: string;
    description?: string | null;
    ticket_id?: string | null;
    ppm_schedule_id?: string | null;
    amc_contract_id?: string | null;
    amount?: number | null;
    cost_head?: string | null;
    photo_urls?: string[];
    occurred_at?: string;
    created_by?: string | null;
    metadata?: Record<string, unknown>;
}): Promise<{ id: string } | null> {
    const { data, error } = await supabaseAdmin
        .from('asset_events')
        .insert({
            asset_id: event.asset_id,
            organization_id: event.organization_id,
            property_id: event.property_id,
            event_type: event.event_type,
            title: event.title,
            description: event.description ?? null,
            ticket_id: event.ticket_id ?? null,
            ppm_schedule_id: event.ppm_schedule_id ?? null,
            amc_contract_id: event.amc_contract_id ?? null,
            amount: event.amount ?? null,
            cost_head: event.cost_head ?? null,
            photo_urls: event.photo_urls ?? [],
            occurred_at: event.occurred_at ?? new Date().toISOString(),
            created_by: event.created_by ?? null,
            metadata: event.metadata ?? {},
        })
        .select('id')
        .single();
    if (error) {
        console.error('[assets] failed to record event:', error.message);
        return null;
    }
    return data;
}
