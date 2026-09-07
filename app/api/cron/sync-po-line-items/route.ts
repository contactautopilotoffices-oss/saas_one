/**
 * PO LINE-ITEM SYNC — scheduled.
 *
 * vercel.json: { "path": "/api/cron/sync-po-line-items", "schedule": "*\/15 * * * *" }
 *
 * The header sync (/api/cron/sync-zoho-books) runs two-hourly and pulls the PO
 * LIST. This pulls the DETAIL of orders it has not read yet — one API call each,
 * which is why it is budgeted rather than a sweep. 200 per pass, quarter-hourly,
 * clears this org's 5,493-order backlog in roughly four hours and then costs
 * almost nothing: only new and modified orders remain.
 *
 * Bearer-guarded like every other cron. Dormant and harmless until
 * 20260907000004_po_line_items is applied — the sync reports the failure per org
 * rather than throwing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { syncPoDetailsForOrg } from '@/backend/services/zohoPoDetailSync';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // `budget` lets an operator run a bigger catch-up by hand without waiting
    // for the schedule. Capped, because the daily quota is shared with the rest
    // of the Books integration.
    const asked = Number(new URL(request.url).searchParams.get('budget') ?? '');
    const budget = Number.isFinite(asked) && asked > 0 ? Math.min(asked, 1000) : undefined;

    const { data: configs } = await supabaseAdmin
        .from('accounts_zoho_config').select('organization_id').eq('is_active', true);

    const results = [];
    for (const c of configs ?? []) {
        results.push(await syncPoDetailsForOrg(String(c.organization_id), budget ? { budget } : undefined));
    }
    return NextResponse.json({ ok: true, orgs: results.length, results });
}
