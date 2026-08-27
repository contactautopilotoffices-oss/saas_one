import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { ZohoService } from './zohoService';

export interface ZohoSyncResult {
    orgId: string;
    zohoOrgId?: string;
    synced: number;
    error?: string;
}

/**
 * Pull all purchase orders from Zoho Books into `zoho_purchase_orders` for an org.
 * No-ops gracefully when the org has no Zoho config or creds are missing.
 * Idempotent: upserts on (organization_id, po_number).
 */
export async function syncPurchaseOrdersForOrg(orgId: string): Promise<ZohoSyncResult> {
    const { data: cfg } = await supabaseAdmin
        .from('accounts_zoho_config').select('*').eq('organization_id', orgId).maybeSingle();

    if (!cfg?.zoho_organization_id || cfg.is_active === false) {
        return { orgId, synced: 0, error: 'Zoho Books is not configured for this organization' };
    }

    const stamp = () => new Date().toISOString();
    try {
        const pos = await ZohoService.listPurchaseOrders(cfg.zoho_organization_id);
        const mapped = pos
            // purchaseorder_id is the upsert key, so a record without one cannot be
            // stored idempotently — it would insert a fresh row on every sync.
            .filter((po: any) => po.purchaseorder_id)
            .map((po: any) => ({
                organization_id: orgId,
                po_number: String(po.purchaseorder_number || po.purchaseorder_id),
                vendor_name: po.vendor_name || null,
                vendor_id: po.vendor_id || null,
                zoho_po_id: po.purchaseorder_id || null,
                po_amount: Number(po.total ?? 0) || 0,
                status: po.status || null,
                // Site / department / category live in Zoho as PO custom fields
                // (cf_*), which the dashboard filters key off of.
                department: po.cf_department || po.cf_department_unformatted || null,
                project_name: po.cf_site || po.cf_site_unformatted || null,
                category: po.cf_category || po.cf_category_unformatted || null,
                po_date: po.date || null,
                delivery_date: po.delivery_date || po.expected_delivery_date || null,
                currency: po.currency_code || 'INR',
                source: 'zoho',
                raw: po,
                synced_at: stamp(),
            }));

        // De-dupe by zoho_po_id (last wins) so a single chunk's ON CONFLICT upsert never
        // touches the same (organization_id, zoho_po_id) target twice. Keying on po_number
        // here used to discard real POs: Zoho does not guarantee purchaseorder_number is
        // unique, and this org has 16 pairs of distinct POs sharing a number.
        const rows = Array.from(
            mapped.reduce((m, r) => m.set(r.zoho_po_id, r), new Map<string, (typeof mapped)[number]>()).values(),
        );

        let synced = 0;
        for (let i = 0; i < rows.length; i += 200) {
            const chunk = rows.slice(i, i + 200);
            const { error } = await supabaseAdmin
                .from('zoho_purchase_orders').upsert(chunk, { onConflict: 'organization_id,zoho_po_id' });
            if (error) throw new Error(error.message);
            synced += chunk.length;
        }

        await supabaseAdmin.from('accounts_zoho_config')
            .update({ last_synced_at: stamp(), last_sync_status: `ok: ${synced} POs` }).eq('organization_id', orgId);
        return { orgId, zohoOrgId: cfg.zoho_organization_id, synced };
    } catch (e) {
        const msg = e instanceof Error ? e.message : 'sync failed';
        await supabaseAdmin.from('accounts_zoho_config')
            .update({ last_synced_at: stamp(), last_sync_status: `error: ${msg}` }).eq('organization_id', orgId);
        return { orgId, synced: 0, error: msg };
    }
}
