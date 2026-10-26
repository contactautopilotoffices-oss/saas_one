import { NextRequest, NextResponse } from 'next/server';
import { runMailArchive } from '@/backend/lib/mailArchive/ingest';

// Mail archive intake, every 15 minutes: new mail, then history, then email text,
// for every mailbox on mail_archive_mailboxes. Each run resumes from saved
// bookmarks, so the 5-minute cap only decides how much is done per run.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    // Fails CLOSED: with CRON_SECRET unset, "Bearer undefined" must not be a password.
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const results = await runMailArchive({ budgetMs: 240_000 });
        // A mailbox still waiting for its owner to connect is expected in a sandbox,
        // not a failure. A mailbox that errored is, and must show red in Vercel's log.
        const failed = results.filter((r) => r.state === 'error');
        return NextResponse.json({ ok: failed.length === 0, results }, { status: failed.length ? 500 : 200 });
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        // Roster table missing = migration not applied yet. Loud, with the fix.
        const hint = /mail_archive_mailboxes|does not exist|PGRST205/i.test(message)
            ? ' Apply supabase/migrations/20261006000002_mail_archive.sql.' : '';
        return NextResponse.json({ ok: false, error: message + hint }, { status: 500 });
    }
}
