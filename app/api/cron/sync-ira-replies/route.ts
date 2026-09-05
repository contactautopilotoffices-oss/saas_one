/**
 * IRA REPLIES — read the mailbox, turn replies into dispositions.
 *
 * The closing half of the digest loop. Vidya replies to a finding; this reads it
 * and closes the line, which is what stops the next scan raising it again.
 *
 * Bearer-guarded like every other cron. Dormant and harmless until
 * 20260905000001_agent_findings is applied and ZOHO_MAIL_* creds are set — it
 * reports what it could not do rather than throwing.
 *
 * vercel.json: { "path": "/api/cron/sync-ira-replies", "schedule": "*\/15 * * * *" }
 *
 * WINDOW: 24h of mail on every pass, not 15 minutes. Overlap is free — a reply
 * already applied is skipped by the `.is('disposition', null)` guard in the
 * collector — whereas a gap silently loses somebody's answer, and they will not
 * send it twice.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { withAgentRun } from '@/backend/lib/agents/instrument';
import { collectIraReplies } from '@/backend/lib/ira/procurement/collectReplies';
import { isZohoMailConfigured } from '@/backend/services/zohoMailService';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

const LOOKBACK_HOURS = 24;
const AGENT_KEY = 'ira';

export async function GET(request: NextRequest) {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isZohoMailConfigured()) {
        return NextResponse.json({ ok: true, skipped: 'ZOHO_MAIL_* not configured' });
    }

    // Orgs that actually run this agent, rather than a hardcoded id.
    const { data: orgs, error } = await supabaseAdmin
        .from('oem_agents').select('organization_id').eq('agent_key', AGENT_KEY);

    if (error) {
        return NextResponse.json({ ok: true, skipped: `agent registry unavailable: ${error.message}` });
    }

    const since = new Date(Date.now() - LOOKBACK_HOURS * 3600_000);
    const results = [];

    for (const orgId of [...new Set((orgs ?? []).map((o) => String(o.organization_id)))]) {
        const r = await withAgentRun(
            {
                orgId, agentKey: AGENT_KEY, module: 'procurement', trigger: 'cron',
                // No runKey: every pass should be traced, and this runs quarter-hourly.
            },
            async (step) => {
                const s = await step(`Reading replies since ${since.toISOString().slice(0, 16)}`, 'fetch');
                const collected = await collectIraReplies(orgId, AGENT_KEY, since);
                await s.ok({
                    detail: {
                        scanned: collected.scanned, matched: collected.matched,
                        applied: collected.applied, ignored: collected.ignored.length,
                    },
                });

                // Ignored replies are a real operator signal — somebody answered and
                // it did not land. Surface them rather than counting them silently.
                if (collected.ignored.length) {
                    const i = await step(`${collected.ignored.length} reply(ies) read but not applied`, 'decide');
                    await i.ok({ detail: { ignored: collected.ignored.slice(0, 10) } });
                }
                for (const e of collected.errors) console.error('[ira replies]', orgId, e);

                return {
                    outcome: collected.applied > 0
                        ? `Closed ${collected.applied} line(s) from ${collected.matched} matched reply(ies).`
                        : `No replies applied${collected.matched ? ` (${collected.matched} matched but not applied)` : ''}.`,
                    status: (collected.applied === 0 ? 'skipped' : 'succeeded') as 'skipped' | 'succeeded',
                    result: collected,
                };
            },
        );
        results.push({ orgId, ...(r ?? { scanned: 0, matched: 0, applied: 0 }) });
    }

    return NextResponse.json({ ok: true, since: since.toISOString(), results });
}
