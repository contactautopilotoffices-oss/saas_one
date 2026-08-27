import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { syncPurchaseOrdersForOrg } from '@/backend/services/zohoBooksSync';

// Scheduled Zoho Books PO sync. Bearer-guarded like the other cron routes.
// Dormant until at least one org has an active accounts_zoho_config row and
// the ZOHO_BOOKS_* env creds are set.

// A full pull is ~27 Zoho pages plus the same number of upsert chunks per org,
// which comfortably exceeds the default function timeout.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: configs } = await supabaseAdmin
        .from('accounts_zoho_config').select('organization_id').eq('is_active', true);

    const results = [];
    for (const c of configs || []) {
        results.push(await syncPurchaseOrdersForOrg(c.organization_id));
    }
    return NextResponse.json({ ok: true, count: results.length, results });
}
