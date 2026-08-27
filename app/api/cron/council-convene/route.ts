import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { gatherDataPack } from '@/backend/lib/council/dataPack';
import { runCouncil, loadAgents, createSupabaseCouncilStore } from '@/backend/lib/council/runner';
import { DEFAULT_QUESTION } from '@/backend/lib/council/personas';
import { dispatchSessionFindings } from '@/backend/lib/council/dispatch';
import { resetCouncilCost, councilRunCost, isMockLlm } from '@/backend/lib/council/llm';

/**
 * GET /api/cron/council-convene — the council convenes itself.
 *
 * This is the route that changes what the system IS. Everything before it required a
 * human to click Convene, which made the council a very good report generator. On a
 * schedule it reads the live FMS state, forms findings, and routes each one to a named
 * owner with a clock — without anyone asking it to.
 *
 * Sequence: live data pack → 3-stage council → dispatch findings to SPOCs.
 * Dispatch failure does NOT fail the run: the audit is already persisted and valuable on
 * its own, so a routing problem is reported alongside a successful convening rather than
 * discarding it.
 *
 * Auth: the standard Bearer CRON_SECRET guard used by the other 19 crons.
 *
 * COST: one convening is ~17 model calls (~134k tokens, ~$0.05 on gpt-5.6-luna). The
 * schedule in vercel.json is weekly deliberately — this is not a cheap poll, and a
 * daily cadence would produce findings faster than anyone can action them, which is the
 * notification-fatigue failure documented in AI_OPERATIONS_LAYER_PLAN §6.
 */

export const dynamic = 'force-dynamic';
// 8 opinions + 8 reviews + synthesis on a reasoning model. The default budget is nowhere near enough.
export const maxDuration = 300;

/** The org the council is seeded for. Override per-run with ?org_id= for a second org. */
const DEFAULT_ORG_ID = '211e1330-ad83-446d-941f-dcea48396798';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // A scheduled run that quietly writes canned findings into the findings board would be
    // indistinguishable from a real audit. Refuse rather than fabricate (FP-01).
    if (isMockLlm()) {
        console.error('[cron council-convene] refusing to run: COUNCIL_MOCK_LLM=1');
        return NextResponse.json({
            error: 'COUNCIL_MOCK_LLM is set — refusing to persist mock findings from a scheduled run',
        }, { status: 500 });
    }

    const sp = new URL(request.url).searchParams;
    const orgParam = sp.get('org_id');
    if (orgParam && !UUID_RE.test(orgParam)) {
        return NextResponse.json({ error: 'org_id must be a uuid' }, { status: 400 });
    }
    const orgId = orgParam || DEFAULT_ORG_ID;
    const question = sp.get('question')?.trim() || DEFAULT_QUESTION;

    const startedAt = Date.now();
    resetCouncilCost();

    // 1. Session row first, so a crash mid-run leaves a visible 'running' session rather
    //    than no trace at all.
    const { data: session, error: insertError } = await supabaseAdmin
        .from('council_sessions')
        .insert({ org_id: orgId, question, trigger: 'scheduled', status: 'running' })
        .select('id')
        .single();

    if (insertError) {
        console.error('[cron council-convene] session insert:', insertError.message);
        // 500 so the Vercel cron log is honestly red rather than falsely green.
        return NextResponse.json({
            error: 'Could not create the session',
            details: insertError.message,
            hint: 'If this mentions a missing relation, apply supabase/migrations/20260803000001_agent_council.sql',
        }, { status: 500 });
    }
    const sessionId = session.id as string;

    try {
        // 2. Live FMS state, pinned to the session so the audit stays replayable.
        const dataPack = await gatherDataPack(orgId);
        await supabaseAdmin.from('council_sessions').update({ data_pack: dataPack }).eq('id', sessionId);

        const unavailable = Object.entries(dataPack.sections)
            .filter(([, s]) => s.note)
            .map(([k]) => k);

        // 3. Deliberate.
        const agents = await loadAgents(orgId);
        const result = await runCouncil({
            sessionId, orgId, question, agents, dataPack,
            store: createSupabaseCouncilStore(),
        });

        // 4. Route the findings. Isolated: the audit survives a dispatch failure.
        let dispatch = null;
        let dispatchError: string | null = null;
        try {
            dispatch = await dispatchSessionFindings(orgId, sessionId);
        } catch (error) {
            dispatchError = error instanceof Error ? error.message : String(error);
            console.error('[cron council-convene] dispatch failed:', dispatchError);
        }

        const cost = councilRunCost();
        const payload = {
            ok: true,
            session_id: sessionId,
            org_id: orgId,
            agents_run: result.opinions.length,
            agents_failed: result.failedAgents,
            findings: result.findingsCount,
            dispatch,
            dispatch_error: dispatchError,
            data_pack_sections_unavailable: unavailable,
            cost_usd: cost.costUsd,
            llm_calls: cost.calls,
            duration_ms: Date.now() - startedAt,
        };
        console.log('[cron council-convene]', JSON.stringify(payload));
        return NextResponse.json(payload);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[cron council-convene] run failed:', message);
        await supabaseAdmin
            .from('council_sessions')
            .update({ status: 'failed', error: message, completed_at: new Date().toISOString() })
            .eq('id', sessionId);
        return NextResponse.json({
            error: 'Council run failed',
            details: message,
            session_id: sessionId,
            cost_usd: councilRunCost().costUsd,
        }, { status: 500 });
    }
}
