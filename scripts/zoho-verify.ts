/**
 * Prove every Zoho identity independently. Read-only — sends nothing, syncs nothing.
 */
import { ZohoService } from '@/backend/services/zohoService';
import { ZohoMailService, isZohoMailConfigured, mailboxAddress } from '@/backend/services/zohoMailService';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

const ok = (s: string) => `  OK      ${s}`;
const no = (s: string) => `  FAILED  ${s}`;

(async () => {
    // --- BOOKS ---------------------------------------------------------------
    try {
        const { apiDomain } = await ZohoService.getAccessToken();
        console.log(ok(`BOOKS token refresh   ${apiDomain}`));
        const { data: cfg } = await supabaseAdmin
            .from('accounts_zoho_config').select('zoho_organization_id, last_sync_status, last_synced_at')
            .eq('is_active', true).maybeSingle();
        const pos = await ZohoService.listPurchaseOrders(String(cfg?.zoho_organization_id));
        const dates = pos.map((p: any) => p.date).filter(Boolean).sort();
        console.log(ok(`BOOKS purchase orders ${pos.length} in Zoho, newest ${dates[dates.length - 1]}`));
        const { count } = await supabaseAdmin.from('zoho_purchase_orders').select('*', { count: 'exact', head: true });
        console.log(`          our mirror holds ${count} — ${pos.length - (count ?? 0)} not yet synced`);
        console.log(`          last sync: ${cfg?.last_synced_at?.slice(0, 16)} · ${cfg?.last_sync_status}`);
    } catch (e) {
        console.log(no(`BOOKS  ${e instanceof Error ? e.message : e}`));
    }

    // --- MAIL identities -----------------------------------------------------
    for (const prefix of ['ZOHO_MAIL', 'ZOHO_ELEC_MAIL'] as const) {
        if (!isZohoMailConfigured(prefix)) { console.log(`  SKIP    ${prefix} not configured`); continue; }
        try {
            const msgs = await ZohoMailService.listMessages({ limit: 1 }, prefix);
            console.log(ok(`${prefix} → ${mailboxAddress(prefix)} · reachable, ${msgs.length} message(s) read`));
        } catch (e) {
            console.log(no(`${prefix}  ${e instanceof Error ? e.message : e}`));
        }
    }
})();
