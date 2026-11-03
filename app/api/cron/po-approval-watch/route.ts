/**
 * Every 10 minutes (vercel.json): notice POs the founder has approved in Zoho and WhatsApp the
 * vendor the approved PO. When the switch (po_notify_settings.auto_mode) is off, or nothing has
 * changed, this returns after at most three small read-only Zoho list calls.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { runPoApprovalWatch } from '@/backend/lib/accounts/poApprovalWatch';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request: NextRequest) {
    // Refuse outright when CRON_SECRET is unset: "Bearer undefined" must not pass.
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
        console.error('[po-approval-watch] CRON_SECRET is not set; refusing to run');
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Only organisations that switched it on cost anything.
    const { data: orgs, error } = await supabaseAdmin.from('po_notify_settings').select('organization_id').in('auto_mode', ['test', 'live']);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const results: Record<string, unknown> = {};
    for (const { organization_id } of orgs ?? []) results[organization_id] = await runPoApprovalWatch(organization_id);
    return NextResponse.json({ ok: true, orgs: Object.keys(results).length, results });
}
