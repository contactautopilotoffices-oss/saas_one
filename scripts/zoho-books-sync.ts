/**
 * Run the REAL sync locally — the same function the cron calls.
 * This WRITES: upserts purchase orders and updates accounts_zoho_config.
 */
import { syncPurchaseOrdersForOrg } from '@/backend/services/zohoBooksSync';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

(async () => {
    const { data: cfgs } = await supabaseAdmin
        .from('accounts_zoho_config').select('organization_id').eq('is_active', true);
    for (const c of cfgs ?? []) {
        const before = await supabaseAdmin.from('zoho_purchase_orders')
            .select('*', { count: 'exact', head: true }).eq('organization_id', c.organization_id);
        console.log(`org ${c.organization_id}: ${before.count} POs before`);
        const r = await syncPurchaseOrdersForOrg(c.organization_id);
        const after = await supabaseAdmin.from('zoho_purchase_orders')
            .select('*', { count: 'exact', head: true }).eq('organization_id', c.organization_id);
        console.log(`  result:`, JSON.stringify(r));
        console.log(`  ${after.count} POs after  (+${(after.count ?? 0) - (before.count ?? 0)})`);
    }
})();
