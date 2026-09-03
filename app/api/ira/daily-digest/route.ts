import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { buildDigestHtml, sendDigest, IRA_SPOC_EMAIL, IRA_FROM_EMAIL } from '@/backend/lib/ira/dailyDigest';
import { getDailyTasks, summarise, type IraTask, type TaskSummary } from '@/backend/lib/ira/tasks';
import { dailyRunKey, withAgentRun } from '@/backend/lib/agents/instrument';
import type { StepFn } from '@/backend/lib/agents/runtime';

/**
 * GET  /api/ira/daily-digest            → renders the digest in the browser. Sends nothing.
 * GET  /api/ira/daily-digest?format=json → the parsed task list + subject.
 * POST /api/ira/daily-digest             → actually sends it.
 *
 * Sending is deliberately POST-only and gated on IRA_SEND_ENABLED plus either
 * the CRON_SECRET or a signed-in user passing ?confirm=yes, so no cron, crawler
 * or stray GET can mail the team by accident.
 *
 * AUTH — GET is gated on a signed-in Supabase session, the same
 * `createClient()` + `auth.getUser()` → 401 guard every /api/agents/* GET uses.
 * It is not decoration: GET opens an agent run, and runs are written with the
 * SERVICE-ROLE client, which bypasses RLS. An endpoint that lets an anonymous
 * caller write rows to oem_agent_runs / oem_agent_run_steps is a write
 * primitive for the internet. POST keeps its own stricter gate (send flag +
 * CRON_SECRET or ?confirm=yes).
 *
 * TELEMETRY — both paths open an agent run (backend/lib/agents/instrument.ts)
 * so the OEM console shows what Ira actually did rather than an empty table.
 * Three things are deliberate:
 *   · the preview run's trigger is 'shadow', not 'manual'. Rendering a digest
 *     in a browser tab is a REHEARSAL — nothing is sent, nobody is mailed — and
 *     oem_agent_profile excludes 'shadow' from the success-rate denominator.
 *     Counting page views as runs of Ira's job would inflate her scorecard with
 *     work she never did. The run is still visible in the console; it just
 *     isn't scored.
 *   · the 'Sending' step exists ONLY on the path that sends. A preview that
 *     logged a send would be a lie told by the trace.
 *   · grounded:false, because getDailyTasks() still returns the SEED list in
 *     backend/lib/ira/tasks.ts. When that becomes a query over
 *     material_requests, flip it to true — not before.
 *   · no token counts: this job calls no model. A null reads "not measured";
 *     a zero would claim we measured and it was free.
 */

/** The org Ira is registered under — same constant the council routes use. */
const DEFAULT_ORG_ID = '211e1330-ad83-446d-941f-dcea48396798';

interface BuiltDigest {
    tasks: IraTask[];
    summary: TaskSummary;
    subject: string;
    html: string;
}

/**
 * The digest build, exactly as it ran before instrumentation. Used as the
 * fallback below so that a telemetry wrapper can never be the reason a
 * response comes back empty.
 */
async function buildDigest(): Promise<BuiltDigest> {
    const tasks = await getDailyTasks();
    return { tasks, summary: summarise(tasks), ...buildDigestHtml(tasks) };
}

/** The three steps both paths share: read → group → compose. */
async function traceBuild(step: StepFn): Promise<BuiltDigest> {
    const read = await step('Reading open requisitions', 'fetch');
    const tasks = await getDailyTasks();
    await read.ok({
        detail: {
            requisitions: tasks.length,
            // Honest provenance: this is a seeded list, not a table read.
            source: 'backend/lib/ira/tasks.ts SEED',
        },
    });

    const group = await step('Grouping by site', 'think');
    const summary = summarise(tasks);
    await group.ok({
        detail: {
            sites: summary.bySite.length,
            blocking: summary.blocking,
            statuses: summary.byStatus.map((g) => `${g.status}:${g.tasks.length}`),
            largest_site: summary.bySite[0]?.site ?? null,
        },
    });

    const compose = await step('Composing digest', 'write');
    const { subject, html } = buildDigestHtml(tasks);
    await compose.ok({ detail: { subject, html_bytes: html.length, rows: tasks.length } });

    return { tasks, summary, subject, html };
}

export async function GET(request: NextRequest) {
    // Same guard every sibling GET under /api/agents uses. Nothing below this
    // line runs for an anonymous caller — including the service-role writes
    // withAgentRun performs.
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const built = (await withAgentRun<BuiltDigest>(
        {
            orgId: DEFAULT_ORG_ID,
            agentKey: 'ira',
            module: 'procurement',
            // A preview sends nothing, so it is a rehearsal, not a run of the
            // job. 'shadow' keeps it out of the success-rate denominator.
            trigger: 'shadow',
            // One preview run per day: the first render records the trace and
            // every refresh after it is deduped, writing nothing at all.
            runKey: dailyRunKey('ira-daily-digest-preview'),
        },
        async (step) => {
            const result = await traceBuild(step);
            return {
                outcome: `Previewed — ${result.summary.total} open tasks across `
                    + `${result.summary.bySite.length} sites, ${result.summary.blocking} blocking. Nothing sent.`,
                grounded: false,
                result,
            };
        },
        // Non-null in practice; the rebuild guarantees the response either way.
    )) ?? (await buildDigest());

    if (request.nextUrl.searchParams.get('format') === 'json') {
        return NextResponse.json({
            subject: built.subject,
            wouldSendTo: IRA_SPOC_EMAIL,
            wouldSendFrom: IRA_FROM_EMAIL,
            sendEnabled: process.env.IRA_SEND_ENABLED === 'true',
            taskCount: built.tasks.length,
            tasks: built.tasks,
        });
    }

    return new NextResponse(built.html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
}

export async function POST(request: NextRequest) {
    // Three independent guards: the env flag, then EITHER the cron secret OR a
    // signed-in user who passed ?confirm=yes.
    // A request rejected here never opens a run — nothing was attempted.
    if (process.env.IRA_SEND_ENABLED !== 'true') {
        return NextResponse.json(
            { error: 'Sending disabled. Set IRA_SEND_ENABLED=true in .env to arm it.' },
            { status: 409 },
        );
    }

    const auth = request.headers.get('authorization');
    const secret = process.env.CRON_SECRET;
    const fromCron = !!secret && auth === `Bearer ${secret}`;

    // ?confirm=yes is an ARE-YOU-SURE, not a credential — a query parameter
    // anyone can type. The manual path therefore needs both: a signed-in
    // session to say who is asking, and the flag to say they meant it.
    let manual = false;
    if (!fromCron && request.nextUrl.searchParams.get('confirm') === 'yes') {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        manual = !!user;
    }

    if (!fromCron && !manual) {
        return NextResponse.json(
            { error: 'Sign in and add ?confirm=yes, or send the CRON_SECRET bearer token.' },
            { status: 401 },
        );
    }

    const to = request.nextUrl.searchParams.get('to') || IRA_SPOC_EMAIL;

    try {
        const sent = await withAgentRun<{ subject: string; taskCount: number }>(
            {
                orgId: DEFAULT_ORG_ID,
                agentKey: 'ira',
                module: 'procurement',
                trigger: fromCron ? 'cron' : 'manual',
                // A Vercel retry of the same day re-opens this row rather than
                // logging a second send.
                runKey: dailyRunKey('ira-daily-digest'),
            },
            async (step) => {
                const built = await traceBuild(step);

                const send = await step('Sending to the procurement SPOC', 'notify');
                try {
                    await sendDigest(to, built.subject, built.html);
                } catch (error) {
                    await send.fail(error, { detail: { to, from: IRA_FROM_EMAIL } });
                    throw error;
                }
                await send.ok({ detail: { to, from: IRA_FROM_EMAIL, transport: 'smtp' } });

                return {
                    outcome: `Digest sent to ${to} — ${built.summary.total} open tasks, `
                        + `${built.summary.blocking} awaiting a decision.`,
                    entityRef: `mailto:${to}`,
                    grounded: false,
                    result: { subject: built.subject, taskCount: built.tasks.length },
                };
            },
        );

        return NextResponse.json({
            sent: true,
            to,
            subject: sent?.subject ?? null,
            taskCount: sent?.taskCount ?? null,
        });
    } catch (e) {
        return NextResponse.json(
            { sent: false, error: (e as Error).message },
            { status: 500 },
        );
    }
}
