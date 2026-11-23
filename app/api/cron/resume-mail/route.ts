import { NextResponse } from 'next/server';
import { canUseCandidateSearch, getCandidatesAdmin } from '@/backend/lib/candidates/access';
import { dueResumeMail, MAIL_CONNECTIONS, syncResumeMail } from '@/backend/lib/candidates/resume-mail';

export const runtime = 'nodejs';
export const maxDuration = 300;
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const db = getCandidatesAdmin();
  const started = Date.now();
  let synced = 0; let failed = 0;
  for (const c of await dueResumeMail(db)) {
    if (Date.now() - started > 60_000) break;
    if (!c.connected_by || !await canUseCandidateSearch(c.connected_by, c.organization_id, db)) {
      await db.from(MAIL_CONNECTIONS).update({ active: false, last_error: 'The connected user no longer has Recruitment access. An authorised HR user must reconnect.' })
        .eq('organization_id', c.organization_id).eq('id', c.id);
      continue;
    }
    try { await syncResumeMail(db, c.organization_id, c.id); synced++; }
    catch { failed++; }
  }
  return NextResponse.json({ synced, failed });
}
