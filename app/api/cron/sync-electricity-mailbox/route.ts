import { NextRequest, NextResponse } from 'next/server';
import { isZohoMailConfigured } from '@/backend/services/zohoMailService';
import { syncElectricityMailboxForOrg } from '@/backend/lib/electricity/ingest';

// Scheduled electricity@ mailbox ingestion. Bearer-guarded like the other cron routes.
// Fully dormant until the ZOHO_ELEC_MAIL_* env creds are set — same no-op contract as
// sync-purchase-mailbox, so deploying this ahead of the OAuth setup changes nothing.

// Downloads + one Groq vision call per bill PDF, well past the default function timeout.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isZohoMailConfigured('ZOHO_ELEC_MAIL')) {
        return NextResponse.json({ ok: true, count: 0, skipped: 'ZOHO_ELEC_MAIL_* not configured' });
    }

    // The mailbox credentials are GLOBAL (one ZOHO_ELEC_MAIL_REFRESH_TOKEN, one inbox),
    // so the org id here is a pure write target and must be pinned explicitly — same
    // cross-tenant reasoning as ZOHO_MAIL_ORG_ID in sync-purchase-mailbox.
    const pinnedOrgId = process.env.ZOHO_ELEC_MAIL_ORG_ID;
    if (!pinnedOrgId) {
        return NextResponse.json({
            ok: true,
            count: 0,
            skipped: 'ZOHO_ELEC_MAIL_ORG_ID is not set. The shared electricity mailbox is a single global inbox, so the org that receives it must be named explicitly.',
        });
    }

    const result = await syncElectricityMailboxForOrg(pinnedOrgId);
    // A run that failed must not read as healthy in Vercel's cron log.
    return NextResponse.json({ ok: !result.error, count: 1, results: [result] }, { status: result.error ? 500 : 200 });
}
