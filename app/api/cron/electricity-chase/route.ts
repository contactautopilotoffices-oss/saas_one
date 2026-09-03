import { NextRequest, NextResponse } from 'next/server';
import { advanceDueChases, type ChaseAdvanceSummary } from '@/backend/lib/electricity/chase';
import { withAgentRun } from '@/backend/lib/agents/instrument';

// Hourly electricity chase driver (Phase 4 of docs/ELECTRICITY_AUTOMATION_PLAN.md):
// advances due touches, detects completions (missing readings now logged) and
// defaults (touch 3 + grace elapsed). Bearer-guarded like the other cron routes.
// vercel.json schedule: { "path": "/api/cron/electricity-chase", "schedule": "7 * * * *" }
//
// TELEMETRY — the hour's work is recorded as one agent run (Ira / electricity)
// so the OEM console shows a chase heartbeat instead of an empty table. Three
// things are deliberate:
//   · the summary the response is built from is captured by the job itself, so
//     the wrapper cannot be the reason the response changes shape;
//   · a run that scanned nothing is 'skipped', not 'succeeded' — a no-op must
//     not read as work;
//   · no token counts: this job calls no model. A null reads "not measured";
//     a zero would claim we measured and it was free.
// The run is filed under the org the OEM console renders; advanceDueChases()
// itself is portfolio-wide, which the step detail states rather than implies.

export const maxDuration = 300;

/** The org the agents are registered under — same constant the council routes use. */
const DEFAULT_ORG_ID = '211e1330-ad83-446d-941f-dcea48396798';

/**
 * `electricity-chase:2026-08-30T14` — one run per scheduled hour, matching the
 * "7 * * * *" cadence. A Vercel retry inside the same hour is deduped against
 * the run already recorded; the next hour opens a new one.
 */
function hourlyRunKey(when: Date = new Date()): string {
    return `electricity-chase:${when.toISOString().slice(0, 13)}`;
}

export async function GET(request: NextRequest) {
    // AUTH — presence FIRST, comparison SECOND. `Bearer ${undefined}` is the
    // string 'Bearer undefined', so building the comparison out of an UNSET
    // variable turns a missing secret into a known password. With CRON_SECRET
    // unset this route accepted a caller sending `Authorization: Bearer
    // undefined` and refused Vercel's scheduler, which sends no header at all —
    // pure loss, and now that this job also writes an agent run, that caller
    // could trigger the job AND write telemetry. Same pattern as
    // app/api/cron/agent-heartbeat. Behaviour with CRON_SECRET SET is unchanged.
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
        console.error(
            '[electricity-chase] CRON_SECRET is not set on this deployment. Refusing every '
            + 'request, including Vercel\'s own scheduler.',
        );
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Captured by the job below. The response is built from THIS value, never
    // from withAgentRun's return, so telemetry cannot alter what the cron reports.
    let summary: ChaseAdvanceSummary | undefined;

    await withAgentRun({
        orgId: DEFAULT_ORG_ID,
        agentKey: 'ira',
        module: 'electricity',
        trigger: 'cron',
        runKey: hourlyRunKey(),
    }, async (step) => {
        const advance = await step('Advancing chase tasks past their due time', 'tool');
        const result = await advanceDueChases();
        summary = result;
        await advance.ok({
            detail: {
                scanned: result.scanned,
                completed: result.completed,
                touch_1_sent: result.touch1,
                touch_2_sent: result.touch2,
                touch_3_sent: result.touch3,
                defaulted: result.defaulted,
                errors: result.errors.length,
                scope: 'all organizations',
            },
        });

        // The job collects per-task errors and still returns; the trace must
        // show them rather than let a partial failure read as a clean pass.
        if (result.errors.length > 0) {
            const failures = await step('Chase tasks that could not be advanced', 'error');
            await failures.end('failed', {
                detail: { errors: result.errors.length, first_errors: result.errors.slice(0, 5) },
            });
        }

        const touches = result.touch1 + result.touch2 + result.touch3;

        if (result.scanned === 0) {
            return {
                outcome: 'No chase tasks were due this hour — nothing advanced.',
                status: 'skipped' as const,
            };
        }

        const parts = [
            `Advanced ${result.scanned} due chase task${result.scanned === 1 ? '' : 's'}`,
            `${touches} touch${touches === 1 ? '' : 'es'} sent (T1 ${result.touch1} / T2 ${result.touch2} / T3 ${result.touch3})`,
            `${result.completed} closed as complete`,
            `${result.defaulted} defaulted`,
        ];
        if (result.errors.length > 0) {
            parts.unshift(`${result.errors.length} task${result.errors.length === 1 ? '' : 's'} errored`);
        }

        return { outcome: `${parts.join('; ')}.` };
    });

    // Unreachable: the block above assigns `summary` before it returns, and
    // withAgentRun re-throws anything the block throws. Kept so the response is
    // never derived from a value the telemetry layer might not have produced —
    // and it reports "we do not know", not a healthy zero.
    if (!summary) {
        return NextResponse.json(
            { ok: false, error: 'chase driver returned no summary' },
            { status: 500 },
        );
    }

    // A run with errors must not read as healthy in Vercel's cron log.
    return NextResponse.json(
        { ok: summary.errors.length === 0, ...summary },
        { status: summary.errors.length === 0 ? 200 : 500 },
    );
}
