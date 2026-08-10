import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { syncPurchaseMailboxForOrg } from '@/backend/services/mailboxDigest';
import { isZohoMailConfigured } from '@/backend/services/zohoMailService';

// Scheduled shared purchase@ mailbox digest. Bearer-guarded like the other cron routes.
// Fully dormant until the ZOHO_MAIL_* env creds are set — same no-op contract as the
// Books sync, so deploying this ahead of the OAuth setup changes nothing.

// Up to 300 threads per org, each with an LLM classification call, well past the
// default function timeout.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isZohoMailConfigured()) {
        return NextResponse.json({ ok: true, count: 0, skipped: 'ZOHO_MAIL_* not configured' });
    }

    // The mailbox credentials are GLOBAL (one ZOHO_MAIL_REFRESH_TOKEN, one inbox), so the
    // org id here is a pure write target. Fanning out over every accounts_zoho_config row
    // would copy ONE tenant's inbox into every other tenant's rows the moment a second org
    // is onboarded — cross-tenant disclosure of a third party's correspondence with no
    // code change, only a config row. So the destination org must be pinned explicitly.
    const pinnedOrgId = process.env.ZOHO_MAIL_ORG_ID;
    if (!pinnedOrgId) {
        return NextResponse.json({
            ok: true,
            count: 0,
            skipped: 'ZOHO_MAIL_ORG_ID is not set. The shared mailbox is a single global inbox, so the org that receives it must be named explicitly.',
        });
    }

    // Confirm the pinned org actually has the accounts workspace enabled before writing.
    const { data: cfg } = await supabaseAdmin
        .from('accounts_zoho_config').select('organization_id')
        .eq('organization_id', pinnedOrgId).eq('is_active', true).maybeSingle();
    if (!cfg) {
        return NextResponse.json({
            ok: true, count: 0,
            skipped: `ZOHO_MAIL_ORG_ID ${pinnedOrgId} has no active accounts_zoho_config row`,
        });
    }

    const result = await syncPurchaseMailboxForOrg(pinnedOrgId);
    // A run that failed for the org must not read as healthy in Vercel's cron log.
    return NextResponse.json({ ok: !result.error, count: 1, results: [result] }, { status: result.error ? 500 : 200 });
}
