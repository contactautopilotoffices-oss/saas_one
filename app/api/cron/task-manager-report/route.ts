import { NextRequest, NextResponse } from 'next/server';
import { generateUsageReport } from '@/backend/lib/reports/taskManagerUsage/generate';
import { coveragePeriod, followingRun } from '@/backend/lib/reports/taskManagerUsage/schedule';
import { claimRun, listDueSchedules, recordFailedRun } from '@/backend/lib/reports/taskManagerUsage/store';

/**
 * GET /api/cron/task-manager-report
 *
 * Produces the scheduled Task Manager Usage Reports. Vercel crons are fixed, so this runs every 15 minutes and does nothing
 * until an organisation's `next_run_at` has passed; the schedule itself is chosen in the Report tab.
 *
 * It is separate from /api/cron/task-manager on purpose: a slow PDF render must never delay WhatsApp notifications.
 * Per-organisation failures are recorded and collected, not thrown, so one failure cannot silence the others.
 */

export const dynamic = 'force-dynamic';
// One Chromium render per organisation, sequentially.
export const maxDuration = 300;
/** Stop starting new reports after this long. Whatever is left stays due and the next check picks it up. */
const TIME_BUDGET_MS = 200_000;

export async function GET(request: NextRequest) {
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const now = Date.now();
    let due;
    try {
        due = await listDueSchedules(new Date(now).toISOString());
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error('[task-manager-report] schedule lookup failed:', message);
        return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }

    const results: { organization_id: string; ok: boolean; from?: string; to?: string; skipped?: string; error?: string }[] = [];
    for (const item of due) {
        if (Date.now() - now > TIME_BUDGET_MS) {
            results.push({ organization_id: item.organizationId, ok: true, skipped: 'left for the next check' });
            continue;
        }
        const scheduledMs = Date.parse(item.scheduledAt);
        const { from, to } = coveragePeriod(item.schedule, scheduledMs);
        try {
            const nextRun = new Date(followingRun(item.schedule, scheduledMs, now)).toISOString();
            if (!(await claimRun(item, nextRun))) {
                results.push({ organization_id: item.organizationId, ok: true, skipped: 'already taken by another run' });
                continue;
            }
            const { savedId } = await generateUsageReport({ organizationId: item.organizationId, from, to, trigger: 'scheduled', userId: null });
            // A scheduled report that was not saved is lost: nobody is waiting to download it.
            if (!savedId) throw new Error('The report was generated but could not be saved');
            results.push({ organization_id: item.organizationId, ok: true, from, to });
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            console.error(`[task-manager-report] org ${item.organizationId} failed:`, message);
            await recordFailedRun(item.organizationId, from, to, message);
            results.push({ organization_id: item.organizationId, ok: false, from, to, error: message });
        }
    }

    const failed = results.filter(r => !r.ok).length;
    // A run that failed for every organisation must not read as healthy in Vercel's cron log.
    return NextResponse.json({ ok: failed === 0, results }, { status: failed > 0 && failed === results.length ? 500 : 200 });
}
