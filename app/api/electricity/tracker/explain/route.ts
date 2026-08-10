import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveElectricityAccess, isElectricityAccessError, readOrgId, isMissingRelation } from '@/backend/lib/electricity/access';
import {
    loadAlertRows, loadAopActualByMonth, billedTotalsByMonth, n, type AlertRow,
} from '@/backend/lib/electricity/tracker';

/**
 * POST /api/electricity/tracker/explain
 *
 * "What changed, and what should I check?" — for one bill, or for one month's
 * reconciliation gap. A short plain-English note, not a chatbot: the model sees only
 * aggregate figures already computed by /api/electricity/tracker (this account's own
 * history, or this month's billed-vs-AOP delta), never vendor contacts or free text.
 *
 * Body: { org_id?, bill_id }               — explain one bill
 *    or { org_id?, reconciliation_month }  — explain one month's reconciliation gap (YYYY-MM)
 *
 * Reuses the client pattern from backend/services/mailboxDigest.ts: OpenAI (not the
 * shared Groq key — see that file for why), gpt-5.x's `max_completion_tokens` requirement,
 * no custom temperature, a request timeout, and a soft per-run cost cap. Unlike the
 * mailbox digest there is deliberately NO heuristic fallback: if the model is unavailable
 * or fails, this returns that fact, never a fabricated explanation.
 *
 * CACHED, keyed on the exact aggregates sent (see electricity_bill_explanations.input_hash)
 * so a render never re-calls OpenAI for a figure that has not changed since the last call,
 * and a changed bill or a changed reconciliation figure invalidates itself automatically.
 */

export const dynamic = 'force-dynamic';

const LLM_API_URL = 'https://api.openai.com/v1/chat/completions';
const LLM_MODEL = process.env.ELECTRICITY_EXPLAIN_MODEL || 'gpt-5.6-luna';
const LLM_TIMEOUT_MS = 10_000;

// USD per million tokens. Same rates backend/services/mailboxDigest.ts documents having
// actually been billed; an unpriced model falls back to a pessimistic estimate so the cap
// errs toward stopping rather than guessing a good price.
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
    'gpt-5.6-luna': { input: 0.20, output: 1.20 },
    'gpt-4o-mini': { input: 0.15, output: 0.60 },
};
const UNPRICED_MODEL = { input: 2.50, output: 10.00 };

// Explanations are 2-4 sentences over a handful of numbers — this is a cheap call (well
// under a tenth of a cent at the rates above). The cap exists as a backstop against a
// runaway loop calling this route in a tight cycle, not because any single call is pricey.
const CALL_BUDGET_USD = Number(process.env.ELECTRICITY_EXPLAIN_CALL_BUDGET_USD || 0.02);

interface Body {
    bill_id?: string;
    reconciliation_month?: string; // 'YYYY-MM'
}

export async function POST(request: NextRequest) {
    const body = (await request.json().catch(() => null)) as Body | null;
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

    const access = await resolveElectricityAccess(request, readOrgId(request, body));
    if (isElectricityAccessError(access)) return access;

    if (!body.bill_id && !body.reconciliation_month) {
        return NextResponse.json({ error: 'bill_id or reconciliation_month is required' }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        return NextResponse.json({ provisioned: false, reason: 'OPENAI_API_KEY is not configured' });
    }

    let alerts;
    try {
        alerts = await loadAlertRows(access.organizationId);
    } catch (e) {
        console.error('[electricity explain]', e instanceof Error ? e.message : e);
        return NextResponse.json({ error: 'Could not load the tracker' }, { status: 500 });
    }
    if (!alerts.provisioned) {
        return NextResponse.json({ provisioned: false, reason: 'The electricity tracker is not set up yet' });
    }

    let subjectKey: string;
    let aggregates: Record<string, unknown>;
    let subjectLabel: string;

    if (body.bill_id) {
        const built = buildBillAggregates(alerts.data, body.bill_id);
        if (!built) return NextResponse.json({ error: 'Unknown bill for this organization' }, { status: 404 });
        subjectKey = `bill:${body.bill_id}`;
        aggregates = built.aggregates;
        subjectLabel = `${built.aggregates.site_label} · ${built.aggregates.provider} · ${built.aggregates.billing_month}`;
    } else {
        const month = String(body.reconciliation_month).slice(0, 7);
        let aop;
        try {
            aop = await loadAopActualByMonth(access.organizationId);
        } catch (e) {
            console.error('[electricity explain reconciliation]', e instanceof Error ? e.message : e);
            return NextResponse.json({ error: 'Could not load the AOP comparison' }, { status: 500 });
        }
        const built = buildReconciliationAggregates(alerts.data, aop.byMonth, month);
        if (!built) return NextResponse.json({ error: 'No data for that month' }, { status: 404 });
        subjectKey = `reconciliation:${month}`;
        aggregates = built;
        subjectLabel = `Reconciliation · ${month}`;
    }

    const inputHash = createHash('sha256').update(JSON.stringify(aggregates)).digest('hex');

    // ---- Cache lookup — never calls OpenAI on render ----------------------------------
    const cached = await supabaseAdmin
        .from('electricity_bill_explanations')
        .select('explanation, input_hash, model, created_at')
        .eq('organization_id', access.organizationId)
        .eq('subject_key', subjectKey)
        .maybeSingle();

    if (cached.error && isMissingRelation(cached.error)) {
        return NextResponse.json({ provisioned: false, reason: 'The explanation cache is not set up yet — apply supabase/migrations/20260802000005_electricity_bill_explanations.sql' });
    }
    if (cached.data && cached.data.input_hash === inputHash) {
        return NextResponse.json({
            provisioned: true, cached: true, subject: subjectLabel,
            explanation: cached.data.explanation, generated_at: cached.data.created_at,
        });
    }

    const result = await callModel(aggregates, !!body.bill_id);
    if (!result) {
        return NextResponse.json({
            provisioned: true, cached: false, subject: subjectLabel,
            explanation: null, error: 'The AI assist could not reach the model. Try again shortly.',
        });
    }

    const { data: saved, error: saveErr } = await supabaseAdmin
        .from('electricity_bill_explanations')
        .upsert({
            organization_id: access.organizationId,
            subject_key: subjectKey,
            input_hash: inputHash,
            explanation: result.explanation,
            model: LLM_MODEL,
            cost_usd: result.costUsd,
            updated_at: new Date().toISOString(),
        }, { onConflict: 'organization_id,subject_key' })
        .select('explanation, created_at')
        .single();

    if (saveErr) {
        // The explanation is still good even if the cache write failed — do not throw it
        // away over a persistence error.
        console.error('[electricity explain] cache write failed:', saveErr.message);
        return NextResponse.json({ provisioned: true, cached: false, subject: subjectLabel, explanation: result.explanation });
    }

    return NextResponse.json({
        provisioned: true, cached: false, subject: subjectLabel,
        explanation: saved.explanation, generated_at: saved.created_at,
    });
}

// ---------------------------------------------------------------------------------------
// Aggregate builders — figures only, no vendor contacts (the schema holds none anyway) and
// no free text from the sheet beyond the provider/site names already shown on screen.
// ---------------------------------------------------------------------------------------

function buildBillAggregates(rows: AlertRow[], billId: string) {
    const bill = rows.find(r => r.id === billId);
    if (!bill) return null;

    const history = rows
        .filter(r => r.account_id === bill.account_id && r.id !== bill.id && r.total_amount !== null)
        .sort((a, b) => b.billing_month.localeCompare(a.billing_month))
        .slice(0, 6);

    const avgTotal = history.length
        ? Math.round(history.reduce((s, r) => s + n(r.total_amount), 0) / history.length)
        : null;
    const sameMonthLastYear = rows.find(r =>
        r.account_id === bill.account_id && r.id !== bill.id &&
        r.billing_month.slice(5, 7) === bill.billing_month.slice(5, 7) &&
        r.billing_month.slice(0, 4) !== bill.billing_month.slice(0, 4));

    return {
        aggregates: {
            site_label: bill.site_label,
            provider: bill.provider,
            billing_month: bill.billing_month,
            total_amount: bill.total_amount,
            due_date: bill.due_date,
            early_payment_date: bill.early_payment_date,
            early_payment_amount: bill.early_payment_amount,
            payment_status: bill.payment_status,
            payment_date: bill.payment_date,
            urgency: bill.urgency,
            history_trailing_months: history.length,
            history_average_total: avgTotal,
            history_recent_totals: history.map(r => ({ month: r.billing_month, total: r.total_amount })),
            same_month_last_year_total: sameMonthLastYear?.total_amount ?? null,
        },
    };
}

function buildReconciliationAggregates(
    rows: AlertRow[],
    aopByMonth: Map<string, number>,
    month: string,
): Record<string, unknown> | null {
    const billedByMonth = billedTotalsByMonth(rows);
    const target = `${month}-01`;
    const billed = billedByMonth.has(target) ? Math.round(billedByMonth.get(target)!) : null;
    const aop = aopByMonth.has(target) ? Math.round(aopByMonth.get(target)!) : null;
    if (billed === null && aop === null) return null;

    const delta = billed !== null && aop !== null ? aop - billed : null;
    const deltaPct = delta !== null && billed ? Math.round((delta / billed) * 1000) / 10 : null;

    const priorMonths = [...billedByMonth.keys(), ...aopByMonth.keys()]
        .filter((m, i, arr) => arr.indexOf(m) === i && m < target)
        .sort().reverse().slice(0, 3);

    const history = priorMonths.map(m => {
        const b = billedByMonth.has(m) ? Math.round(billedByMonth.get(m)!) : null;
        const a = aopByMonth.has(m) ? Math.round(aopByMonth.get(m)!) : null;
        const d = b !== null && a !== null && b ? Math.round(((a - b) / b) * 1000) / 10 : null;
        return { month: m.slice(0, 7), billed_total: b, aop_actual: a, delta_pct: d };
    });

    return {
        month, billed_total: billed, aop_actual: aop, delta, delta_pct: deltaPct,
        prior_months: history,
    };
}

// ---------------------------------------------------------------------------------------
// Model call — mirrors backend/services/mailboxDigest.ts's classifyWithLLM shape.
// ---------------------------------------------------------------------------------------

async function callModel(aggregates: Record<string, unknown>, isBill: boolean): Promise<{ explanation: string; costUsd: number } | null> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

    try {
        const isGpt5 = /^(gpt-5|o[34])/.test(LLM_MODEL);
        const response = await fetch(LLM_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({
                model: LLM_MODEL,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: userPrompt(aggregates, isBill) },
                ],
                ...(isGpt5
                    ? { max_completion_tokens: 350 }   // headroom: reasoning tokens count here
                    : { temperature: 0.2, max_tokens: 200 }),
            }),
            signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            console.warn('[electricity explain] LLM API error:', response.status);
            return null;
        }

        const data = await response.json();
        const inputTokens = Number(data?.usage?.prompt_tokens || 0);
        const outputTokens = Number(data?.usage?.completion_tokens || 0);
        const pricing = MODEL_PRICING[LLM_MODEL] ?? UNPRICED_MODEL;
        const costUsd = (inputTokens * pricing.input + outputTokens * pricing.output) / 1e6;

        if (costUsd > CALL_BUDGET_USD) {
            console.warn(`[electricity explain] call cost $${costUsd.toFixed(5)} exceeded the $${CALL_BUDGET_USD} soft cap`);
        }

        const content = data?.choices?.[0]?.message?.content;
        if (!content || !String(content).trim()) return null;

        return { explanation: String(content).trim(), costUsd: Math.round(costUsd * 1e6) / 1e6 };
    } catch (error) {
        clearTimeout(timeoutId);
        if (!(error instanceof Error && error.name === 'AbortError')) {
            console.warn('[electricity explain] LLM call failed:', error instanceof Error ? error.message : error);
        }
        return null;
    }
}

const SYSTEM_PROMPT = `You explain electricity billing figures to a facilities/procurement team in plain English.
You are given AGGREGATE FIGURES ONLY for one bill or one month's reconciliation between two internal trackers — never
vendor contact details or free text from any document.

Write 2-4 short sentences covering:
1. What changed compared to this account's own recent history (or, for a reconciliation gap, compared to recent months).
2. Whether it fits a seasonal pattern (electricity bills in this portfolio swing with summer cooling load) or looks anomalous.
3. One concrete thing to check next (e.g. "confirm this bill was entered", "check for a missing invoice", "confirm the meter reading").

Rules:
- Use ONLY the numbers given to you. Never invent a figure, a date, or a cause you were not given evidence for.
- No greeting, no restating every number back — the reader can already see the table. Add the interpretation the table cannot state for itself.
- Plain text only, no markdown, no bullet points.`;

function userPrompt(aggregates: Record<string, unknown>, isBill: boolean): string {
    const kind = isBill ? 'a single electricity bill' : "one month's gap between the electricity bill tracker and the AOP budget-vs-actual sheet";
    return `Explain ${kind}. Figures (JSON):\n${JSON.stringify(aggregates, null, 2)}`;
}
