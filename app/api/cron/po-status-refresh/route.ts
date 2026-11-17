/**
 * Every 2 minutes (vercel.json): copy the status of POs changed in Zoho Books in the last 15 minutes
 * into the FMS, so an approval, rejection or cancellation shows within about 2 minutes (the full
 * Zoho sync only runs every 2 hours). One small read-only list call per Zoho-connected organisation.
 * Independent of the WhatsApp switch. Never messages anyone. The 15-minute window overlaps the run
 * interval on purpose, so one missed run loses nothing.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { refreshRecentPoStatuses } from '@/backend/lib/accounts/poApprovalWatch';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
    // Refuse outright when CRON_SECRET is unset: "Bearer undefined" must not pass.
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: connected, error } = await supabaseAdmin.from('accounts_zoho_config').select('organization_id').eq('is_active', true);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const results: Record<string, unknown> = {};
    for (const { organization_id } of connected ?? []) {
        results[organization_id] = await refreshRecentPoStatuses(organization_id, 15).catch((e) => ({ checked: 0, changed: 0, error: e instanceof Error ? e.message : String(e) }));
    }
    return NextResponse.json({ ok: true, orgs: Object.keys(results).length, results });
}
