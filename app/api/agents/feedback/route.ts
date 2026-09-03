import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { awardCoins } from '@/backend/lib/agents/runtime';
import {
    AGENT_RUNTIME_MIGRATION,
    isNotProvisionedError,
    type AgentFeedbackSignal,
    type OemAgentFeedback,
} from '@/frontend/types/agentRuntime';

/**
 * THE REINFORCEMENT LOOP.
 * =============================================================================
 * An agentic employee learns from two signals, and they are NOT the same signal:
 *
 *   1. "You did the job well."     -> praise, worth Autopilot coins.
 *   2. "The job was done wrong."   -> reject, costs coins.
 *   3. "The job was not worth      -> roi_flag. This is the one people collapse
 *       doing at all."                into (2) and lose. A perfectly executed
 *                                     task that was never in the company's ROI
 *                                     is a DIFFERENT failure from a botched one:
 *                                     the fix is re-scoping the goal, not
 *                                     rewriting the procedure. So roi_flag rides
 *                                     its own column (oem_agent_feedback.roi_flag),
 *                                     its own counter on the profile
 *                                     (roi_flags_30d), and its own 20% term in
 *                                     the reliability score. It is never blended
 *                                     into success_rate.
 *   4. "Do it like THIS next time" -> correction. Worth zero coins, because it
 *                                     is not a verdict — it is instruction.
 *                                     `guidance` is required free text and lands
 *                                     with applied_to_prompt_version = NULL.
 *
 * (4) is what closes the loop. Pending guidance is not a log line; it is a
 * QUEUE. Every row with applied_to_prompt_version IS NULL is a natural-language
 * change an operator typed that the agent has not absorbed yet. The console
 * renders that count as "3 corrections waiting to be folded into the next
 * version", and prompt regeneration reads the queue, folds it into the new
 * system prompt, then stamps the rows with the version that absorbed them.
 * That stamp is the difference between feedback that was heard and feedback
 * that was merely recorded.
 *
 * Coins are posted through the oem_award_coins() SQL function, never by this
 * route computing balance_after itself: the function takes a row lock on the
 * registry, appends to the append-only ledger, and lets a trigger refresh the
 * cached balance. Two operators clicking "praise" at the same instant therefore
 * cannot interleave into a wrong balance.
 *
 * Endpoints
 *   POST /api/agents/feedback?orgId=
 *        body { agentKey, runId?, signal, coins?, roi_flag?, reason, guidance? }
 *   GET  /api/agents/feedback?orgId=&agentKey=&limit=
 *        -> { history, pending_guidance, pending_count, ledger, totals }
 *
 * Degrades to HTTP 200 { provisioned: false } when 20260830000001_agent_runtime
 * has not been applied yet. A console that has never seen the migration should
 * look unprovisioned, not broken.
 */

export const dynamic = 'force-dynamic';

/* ---------------------------------------------------------------------------
 * Coin policy. These are the DEFAULTS, deliberately asymmetric.
 *
 * A reject costs less than praise pays (-5 vs +10) because most rejects are a
 * near miss and an agent that is punished harder than it is rewarded converges
 * on doing nothing. An ROI flag costs the most (-15) because it is the most
 * expensive mistake the business can absorb: real tokens, real minutes, real
 * operator attention, spent on work nobody wanted.
 *
 * An explicit `coins` in the body overrides the default, subject to the sign
 * and magnitude rules below.
 * ------------------------------------------------------------------------- */
const DEFAULT_COINS: Record<AgentFeedbackSignal, number> = {
    praise: 10,
    reject: -5,
    roi_flag: -15,
    correction: 0,
};

/** Sign each signal is allowed to carry. Prevents "praise, -400". */
const REQUIRED_SIGN: Record<AgentFeedbackSignal, 'positive' | 'negative' | 'zero'> = {
    praise: 'positive',
    reject: 'negative',
    roi_flag: 'negative',
    correction: 'zero',
};

/** Fat-finger ceiling. One click must not be able to move a balance by 10,000. */
const MAX_COINS_PER_EVENT = 500;

const VALID_SIGNALS: AgentFeedbackSignal[] = ['praise', 'reject', 'correction', 'roi_flag'];

/** How the council log records each verdict. Corrections and ROI flags are not
 *  rejections — they are work for a human, so they read as 'needs_human'. */
const COUNCIL_DECISION: Record<AgentFeedbackSignal, 'approved' | 'rejected' | 'needs_human'> = {
    praise: 'approved',
    reject: 'rejected',
    roi_flag: 'needs_human',
    correction: 'needs_human',
};

/** Same key set the provisioned GET returns, so one client renderer covers both. */
const EMPTY_GET = {
    history: [] as OemAgentFeedback[],
    history_limit: 0,
    pending_guidance: [] as OemAgentFeedback[],
    pending_count: 0,
    ledger: [] as unknown[],
    totals_for_page: { praise: 0, reject: 0, correction: 0, roi_flag: 0, net_coins: 0 },
};

function notProvisioned(extra: Record<string, unknown>) {
    return NextResponse.json(
        {
            provisioned: false,
            migration: AGENT_RUNTIME_MIGRATION,
            reason: `Agent runtime is not set up yet — apply ${AGENT_RUNTIME_MIGRATION}.sql.`,
            ...extra,
        },
        { status: 200 },
    );
}

function readOrgId(request: NextRequest, body?: Record<string, unknown>): string | null {
    const sp = new URL(request.url).searchParams;
    return (
        sp.get('orgId') || sp.get('org_id') || sp.get('organization_id') ||
        (body?.orgId as string) || (body?.organization_id as string) || null
    );
}

/* =========================================================================== */
/* POST — record one reinforcement event                                       */
/* =========================================================================== */

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const orgId = readOrgId(request, body);
        if (!orgId) return NextResponse.json({ error: 'orgId required' }, { status: 400 });

        const agentKey = typeof body.agentKey === 'string'
            ? body.agentKey.trim()
            : typeof body.agent_key === 'string' ? (body.agent_key as string).trim() : '';
        if (!agentKey) return NextResponse.json({ error: 'agentKey required' }, { status: 400 });

        const signal = body.signal as AgentFeedbackSignal;
        if (!VALID_SIGNALS.includes(signal)) {
            return NextResponse.json(
                { error: `signal must be one of ${VALID_SIGNALS.join(', ')}` },
                { status: 400 },
            );
        }

        const runId = (body.runId as string) || (body.run_id as string) || null;
        const reason = typeof body.reason === 'string' ? body.reason.trim() || null : null;
        const guidance = typeof body.guidance === 'string' ? body.guidance.trim() || null : null;

        // A correction with no guidance is an empty gesture: it teaches the agent
        // nothing and clogs the pending queue with a row that regeneration cannot
        // use. Refuse it rather than accept a correction that corrects nothing.
        if (signal === 'correction' && !guidance) {
            return NextResponse.json(
                {
                    error: 'guidance is required for a correction — it is the natural-language change the next prompt version absorbs.',
                    field: 'guidance',
                },
                { status: 400 },
            );
        }

        // ---- Coins: default by signal, overridable, sign- and magnitude-checked.
        let coins = DEFAULT_COINS[signal];
        if (body.coins !== undefined && body.coins !== null) {
            const override = Number(body.coins);
            if (!Number.isFinite(override) || !Number.isInteger(override)) {
                return NextResponse.json({ error: 'coins must be an integer' }, { status: 400 });
            }
            const sign = REQUIRED_SIGN[signal];
            if (sign === 'positive' && override < 0) {
                return NextResponse.json({ error: `'${signal}' cannot carry negative coins` }, { status: 400 });
            }
            if (sign === 'negative' && override > 0) {
                return NextResponse.json({ error: `'${signal}' cannot carry positive coins` }, { status: 400 });
            }
            if (Math.abs(override) > MAX_COINS_PER_EVENT) {
                return NextResponse.json(
                    { error: `coins is capped at ±${MAX_COINS_PER_EVENT} per event` },
                    { status: 400 },
                );
            }
            coins = override;
        }

        // roi_flag the SIGNAL always sets roi_flag the COLUMN. Any other signal may
        // still raise it explicitly — "you did it right, but it wasn't worth doing"
        // is a real and useful verdict.
        const roiFlag = signal === 'roi_flag' ? true : body.roi_flag === true;

        // ---- 1. The feedback row. This is the durable record.
        const { data: feedback, error: fbError } = await supabase
            .from('oem_agent_feedback')
            .insert({
                organization_id: orgId,
                agent_key: agentKey,
                run_id: runId,
                signal,
                coins,
                roi_flag: roiFlag,
                reason,
                guidance,
                applied_to_prompt_version: null, // pending until a regeneration absorbs it
                created_by: user.id,
            })
            .select()
            .single();

        if (isNotProvisionedError(fbError)) return notProvisioned({ feedback: null });
        if (fbError) return NextResponse.json({ error: fbError.message }, { status: 500 });

        // ---- 2. The coins. awardCoins() wraps the oem_award_coins() SQL function,
        //         which takes a FOR UPDATE lock across the balance read and the
        //         ledger insert, so two operators praising the same run in the same
        //         second cannot both read 40 and both write 45.
        //
        //         TENANCY NOTE: awardCoins() writes with the SERVICE ROLE, which
        //         bypasses RLS. It is safe to call here only because it runs strictly
        //         AFTER the feedback insert above, and that insert went through the
        //         USER-scoped client where the `oem_insert_org_member` WITH CHECK
        //         policy already proved this caller belongs to this org. Do not move
        //         this call above the insert, and do not call it on a path where no
        //         RLS-checked write has happened first.
        //
        //         A coin failure must never lose the feedback we already recorded,
        //         so it is reported alongside the row rather than thrown.
        let coinsBalance: number | null = null;
        let coinsRecorded = false;
        let coinError: string | null = null;
        if (coins !== 0) {
            const award = await awardCoins(orgId, agentKey, coins, reason || `${signal} feedback`, {
                feedbackId: feedback.id,
                runId,
                userId: user.id,
            });
            coinsBalance = award.balance;
            coinsRecorded = award.recorded;
            if (!award.recorded) {
                coinError = 'The coin ledger did not accept the movement; the feedback itself was recorded.';
            }
        }

        // ---- 3. Governance. Every verdict on an agent belongs in the council log,
        //         next to the prompt and bundle changes it will eventually cause.
        //         oem_council_log ships with the ORIGINAL OEM migration, so it may
        //         exist while the runtime tables do not; a failure is non-fatal.
        const summaryBits = [
            `${signal.replace('_', ' ')} on ${agentKey}`,
            coins !== 0 ? `${coins > 0 ? '+' : ''}${coins} coins` : null,
            roiFlag ? 'ROI-flagged' : null,
            reason,
        ].filter(Boolean);

        const { error: logError } = await supabase.from('oem_council_log').insert({
            organization_id: orgId,
            agent_key: agentKey,
            review_type: 'performance_review',
            summary: summaryBits.join(' — ').slice(0, 500),
            decision: COUNCIL_DECISION[signal],
            decided_by: 'human',
            details: {
                signal,
                coins,
                roi_flag: roiFlag,
                run_id: runId,
                feedback_id: feedback.id,
                // The guidance text itself, so the log reads as a transcript of what
                // the operator actually asked for, not just that they asked.
                guidance,
                coins_balance_after: coinsBalance,
            },
            created_by: user.id,
        });
        if (logError && !isNotProvisionedError(logError)) {
            console.error('[agents/feedback] council log', logError.message);
        }

        return NextResponse.json(
            {
                provisioned: true,
                feedback,
                coins_delta: coins,
                coins_balance: coinsBalance,
                coins_recorded: coinsRecorded,
                coin_error: coinError,
                council_logged: !logError,
                // The loop, stated back to the caller so the UI can say it out loud.
                pending: signal === 'correction' || !!guidance
                    ? 'Guidance queued. It will be folded into the next system-prompt version.'
                    : null,
            },
            { status: 201 },
        );
    } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}

/* =========================================================================== */
/* GET — feedback history + the pending-guidance queue                         */
/* =========================================================================== */

export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { searchParams } = new URL(request.url);
        const orgId = readOrgId(request);
        if (!orgId) return NextResponse.json({ error: 'orgId required' }, { status: 400 });

        // agentKey is optional: omit it for an org-wide reinforcement feed.
        const agentKey = searchParams.get('agentKey') || searchParams.get('agent_key');
        const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 50, 1), 200);

        let historyQ = supabase
            .from('oem_agent_feedback')
            .select('*')
            .eq('organization_id', orgId)
            .order('created_at', { ascending: false })
            .limit(limit);
        if (agentKey) historyQ = historyQ.eq('agent_key', agentKey);

        // PENDING GUIDANCE is a state, not a time window. A correction typed six
        // weeks ago that no regeneration has absorbed is still owed to the agent,
        // so this query carries no date filter — only `applied_to_prompt_version
        // IS NULL AND guidance IS NOT NULL`, matching the oem_agent_profile view's
        // own `pend` CTE so the count here and the count there never disagree.
        let pendingQ = supabase
            .from('oem_agent_feedback')
            .select('*')
            .eq('organization_id', orgId)
            .is('applied_to_prompt_version', null)
            .not('guidance', 'is', null)
            .order('created_at', { ascending: true }) // oldest first: it has waited longest
            .limit(200);
        if (agentKey) pendingQ = pendingQ.eq('agent_key', agentKey);

        let ledgerQ = supabase
            .from('oem_agent_coin_ledger')
            .select('id, agent_key, delta, balance_after, reason, feedback_id, run_id, created_at')
            .eq('organization_id', orgId)
            .order('created_at', { ascending: false })
            .limit(25);
        if (agentKey) ledgerQ = ledgerQ.eq('agent_key', agentKey);

        const [historyRes, pendingRes, ledgerRes] = await Promise.all([historyQ, pendingQ, ledgerQ]);

        if (isNotProvisionedError(historyRes.error) || isNotProvisionedError(pendingRes.error)) {
            return notProvisioned({ agent_key: agentKey, ...EMPTY_GET });
        }
        if (historyRes.error) {
            return NextResponse.json({ error: historyRes.error.message }, { status: 500 });
        }

        const history = (historyRes.data ?? []) as OemAgentFeedback[];
        const pending = (pendingRes.data ?? []) as OemAgentFeedback[];

        // Totals are over the returned page, not all time — labelled as such so a
        // reader does not mistake a page summary for a lifetime one.
        const totals = history.reduce(
            (acc, row) => {
                if (row.signal in acc) acc[row.signal] += 1;
                acc.net_coins += row.coins ?? 0;
                return acc;
            },
            { praise: 0, reject: 0, correction: 0, roi_flag: 0, net_coins: 0 } as Record<string, number>,
        );

        return NextResponse.json({
            provisioned: true,
            agent_key: agentKey,
            history,
            history_limit: limit,
            pending_guidance: pending,
            pending_count: pending.length,
            ledger: isNotProvisionedError(ledgerRes.error) ? [] : (ledgerRes.data ?? []),
            totals_for_page: totals,
        });
    } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}
