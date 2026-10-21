/**
 * Rebuild the org wiki for every organization that has Zoho POs — Mondays 06:00 IST
 * (vercel.json, 00:30 UTC). No model call; ~12 s for 5.7k POs and 26k lines.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { rebuildWiki } from '@/backend/lib/wiki/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
    // Refuse outright when CRON_SECRET is unset: "Bearer undefined" must not pass.
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
        console.error('[wiki-compile] CRON_SECRET is not set; refusing to run');
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: orgs, error } = await supabaseAdmin.from('organizations').select('id');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const results: Record<string, unknown> = {};
    let failed = 0;
    for (const { id } of orgs ?? []) {
        const { count } = await supabaseAdmin.from('zoho_purchase_orders')
            .select('id', { count: 'exact', head: true }).eq('organization_id', id);
        if (!count) continue;
        try {
            const r = await rebuildWiki(id, 'cron');
            results[id] = { pages: r.pages, pruned: r.pruned, journal: r.journal, ms: r.ms };
        } catch (e) {
            failed++;
            results[id] = { error: e instanceof Error ? e.message : String(e) };
            console.error('[wiki-compile] rebuild failed', id, e);
        }
    }
    // A failed org is a failed run: a green 200 here would hide it, as the mailbox cron once did.
    return NextResponse.json({ ok: failed === 0, results }, { status: failed ? 500 : 200 });
}
