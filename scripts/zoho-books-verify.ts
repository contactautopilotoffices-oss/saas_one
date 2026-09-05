/**
 * Prove the new credentials work, WITHOUT running the sync.
 * Read-only: refreshes a token and reads page 1 of purchase orders.
 */
import { ZohoService } from '@/backend/services/zohoService';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

(async () => {
    try {
        const { apiDomain } = await ZohoService.getAccessToken();
        console.log('1. token refresh      OK   apiDomain', apiDomain);
    } catch (e) {
        console.error('1. token refresh      FAILED —', e instanceof Error ? e.message : e);
        process.exit(1);
    }

    const { data: cfg } = await supabaseAdmin
        .from('accounts_zoho_config').select('zoho_organization_id, last_synced_at, last_sync_status')
        .eq('is_active', true).maybeSingle();
    console.log('2. config             org', cfg?.zoho_organization_id, '| last sync', cfg?.last_synced_at?.slice(0, 16), '|', cfg?.last_sync_status);

    const pos = await ZohoService.listPurchaseOrders(String(cfg?.zoho_organization_id));
    console.log('3. purchase orders    OK   Zoho returned', pos.length, 'POs');

    const dates = pos.map((p: any) => p.date).filter(Boolean).sort();
    console.log('   newest PO date in Zoho:', dates[dates.length - 1], '| oldest:', dates[0]);

    const { count } = await supabaseAdmin.from('zoho_purchase_orders')
        .select('*', { count: 'exact', head: true });
    console.log('4. our copy           ', count, 'POs stored locally —', (pos.length - (count ?? 0)), 'missing');

    console.log('\nCredentials work. Nothing was written. To actually sync:\n  npx tsx scripts/zoho-books-sync.ts');
})();
