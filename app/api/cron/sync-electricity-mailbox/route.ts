import { NextRequest, NextResponse } from 'next/server';
import { isZohoMailConfigured } from '@/backend/services/zohoMailService';
import { syncElectricityMailboxForOrg } from '@/backend/lib/electricity/ingest';

// Scheduled electricity bill mailbox ingestion. Bearer-guarded like the other cron routes.
// Fully dormant until the ZOHO_ELEC_MAIL_* env creds are set — same no-op contract as
// sync-purchase-mailbox, so deploying this ahead of the OAuth setup changes nothing.
// Every dormant path returns 200 and logs the reason: a cron that 500s on an env var
// nobody has set yet trains the operator to ignore the cron log entirely.

// ONE BILL MASTER, TWO DOORS. A bill either arrives here as a mail attachment or is
// uploaded/linked by hand in the Inbox (PATCH /api/electricity/documents). Both doors end
// in upsertBillFromParsed(), which keys on (account_id, billing_month) — so a bill entered
// manually before the board mailed it is UPDATED by this sync rather than duplicated, and
// a bill that has already moved past 'parsed' keeps its workflow_status whichever door it
// came through. Any new intake path must go through that same upsert for this to hold.

// Downloads + one Groq vision call per bill PDF, well past the default function timeout.
export const maxDuration = 300;

// The inbox this cron polls. Bills reach us at deepa.r@worksquare.in — an alias on
// lohitaksha.ranganathan@worksquare.in — not at a dedicated electricity@ box, so that is
// the shipped default rather than a value someone has to remember to set. Override with
// ELECTRICITY_BILL_MAILBOX; ZOHO_ELEC_MAIL_ADDRESS is honoured next so an existing
// deployment that already pinned its mailbox there is not silently re-pointed.
const DEFAULT_BILL_MAILBOX = 'deepa.r@worksquare.in';

function resolveBillMailbox(): string {
    const configured = process.env.ELECTRICITY_BILL_MAILBOX || process.env.ZOHO_ELEC_MAIL_ADDRESS;
    return (configured || DEFAULT_BILL_MAILBOX).trim().toLowerCase();
}

export async function GET(request: NextRequest) {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const mailbox = resolveBillMailbox();

    if (!isZohoMailConfigured('ZOHO_ELEC_MAIL')) {
        const skipped = 'ZOHO_ELEC_MAIL_* not configured';
        console.info(`[ElectricityMailboxCron] skipped (${mailbox}): ${skipped}`);
        return NextResponse.json({ ok: true, mailbox, count: 0, skipped });
    }

    // The mailbox credentials are GLOBAL (one ZOHO_ELEC_MAIL_REFRESH_TOKEN, one inbox),
    // so the org id here is a pure write target and must be pinned explicitly — same
    // cross-tenant reasoning as ZOHO_MAIL_ORG_ID in sync-purchase-mailbox.
    const pinnedOrgId = process.env.ZOHO_ELEC_MAIL_ORG_ID;
    if (!pinnedOrgId) {
        const skipped = 'ZOHO_ELEC_MAIL_ORG_ID is not set. The shared electricity mailbox is a single global inbox, so the org that receives it must be named explicitly.';
        console.info(`[ElectricityMailboxCron] skipped (${mailbox}): ${skipped}`);
        return NextResponse.json({ ok: true, mailbox, count: 0, skipped });
    }

    // ZohoMailService picks the Zoho account by address and reads only
    // ZOHO_ELEC_MAIL_ADDRESS, so hand it the resolved value instead of leaving two env
    // vars to name the same inbox and drift apart. deepa.r@ is an alias, and Zoho lists
    // aliases under the owning account's emailAddress[], so the lookup still matches; if a
    // grant ever stops exposing the alias, ZOHO_ELEC_MAIL_ACCOUNT_ID short-circuits it.
    process.env.ZOHO_ELEC_MAIL_ADDRESS = mailbox;

    try {
        const result = await syncElectricityMailboxForOrg(pinnedOrgId);
        // A run that failed must not read as healthy in Vercel's cron log.
        return NextResponse.json(
            { ok: !result.error, mailbox, count: 1, results: [result] },
            { status: result.error ? 500 : 200 },
        );
    } catch (e) {
        // syncElectricityMailboxForOrg reports its own failures as result.error today; this
        // catch is what keeps a future throw anywhere under it from surfacing as an
        // unhandled crash with no line in the log saying which mailbox was being read.
        const message = e instanceof Error ? e.message : 'electricity mailbox sync failed';
        console.error(`[ElectricityMailboxCron] run failed (${mailbox}):`, message);
        return NextResponse.json({ ok: false, mailbox, count: 0, error: message }, { status: 500 });
    }
}
