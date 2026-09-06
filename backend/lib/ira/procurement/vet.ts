/**
 * VETTING — a council persona reads a runtime agent's findings and says
 * whether they hold up, before anyone is mailed.
 * -----------------------------------------------------------------------------
 * "Ira reports to Nair." Nair is the procurement specialist on the council: a
 * persona with a system prompt in council_agents.persona, run through the same
 * councilChat() the council convenes with. Here Nair does not convene — Nair
 * reviews. One call, one verdict, written to oem_council_log as review_type
 * 'vetting' and stamped on the digest header ("Vetted by Nair · 2 concerns").
 *
 * WHAT VETTING IS NOT
 *   - It does not change a finding. Ira's detector is deterministic SQL and a
 *     persona's opinion must not edit arithmetic. Nair can flag, not rewrite.
 *   - It does not block the send. A model outage or a "needs_human" verdict
 *     still lets the digest go, with the verdict line saying so. A reviewer
 *     who can silently veto the mail is a second failure mode, not a control.
 *   - It does not re-derive numbers. Nair is handed the findings as data and
 *     judged on whether the reasoning is sound and the actions executable.
 *
 * ── AGENT SPEC BLOCK (doctrine §3) ───────────────────────────────────────────
 *   Task boundary   judge one run's findings; output verdict + concerns        [BAA p.104]
 *   Tools           none; findings are passed in as data                       [BAA p.94]
 *   Failure mode    returns { ok:false, why } as data; digest proceeds         [BAA p.94]
 *   Judge the path  the rubric asks whether each finding's EVIDENCE supports
 *                   its PRIORITY and whether the ACTION is executable this
 *                   week — not whether Nair "agrees"                           [BAA p.95]
 *   Judge model     DIFFERENT model family from the producer is the doctrine;
 *                   Ira is code, so the family constraint is trivially met.
 *                   Reasoning precedes the score in the output contract       [BAA pp.96–98]
 *   Memory          none across runs, deliberately: a reviewer that remembers
 *                   last week's verdict anchors on it                          [BAA p.103]
 *   Cost            one 'vet' call, ~3k output tokens max; logged per run     [BAA p.112]
 *   Known deviation the hand-audit of rubric outputs (L6) is a process the
 *                   team must run; the log rows make it possible, not done   [BAA p.98]
 */

import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { councilChat, councilRunCost, resetCouncilCost } from '@/backend/lib/council/llm';
import { loadAgents } from '@/backend/lib/council/runner';
import type { CouncilAgentDef } from '@/backend/lib/council/personas';
import type { Finding } from './types';

export type Verdict = 'sound' | 'sound_with_concerns' | 'needs_human';

export interface Concern {
    /** finding.key the concern is about, or null for a run-level concern. */
    finding_key: string | null;
    /** One sentence. What is weak: evidence, priority, or action. */
    concern: string;
    /** What Nair would change or check. */
    suggestion: string;
}

export interface VetResult {
    ok: boolean;
    why?: string;
    reviewer: { key: string; name: string; title: string } | null;
    verdict: Verdict | null;
    /** Two or three sentences, Nair's own words, written BEFORE the verdict. */
    reasoning: string | null;
    concerns: Concern[];
    findingsReviewed: number;
    costUsd: number;
    /** Set when the verdict was written to the council log. */
    loggedId: string | null;
}

const EMPTY: VetResult = { ok: false, reviewer: null, verdict: null, reasoning: null, concerns: [], findingsReviewed: 0, costUsd: 0, loggedId: null };

function findingsAsData(findings: ReadonlyArray<Finding>): string {
    return findings.map((f, i) => [
        `#${i + 1} key=${f.key} priority=${f.priority}${f.amount !== null ? ` amount_inr=${Math.round(f.amount)}` : ''}`,
        `  title: ${f.title}`,
        f.vendor ? `  vendor: ${f.vendor}` : null,
        f.property ? `  site: ${f.property}` : null,
        `  problem: ${f.problem.replace(/\s+/g, ' ').slice(0, 600)}`,
        f.refs.length ? `  records: ${f.refs.map((r) => `${r.kind}:${r.label}${r.id ? '' : ' (unresolved)'}`).join(', ')}` : '  records: none',
        f.stats?.length ? `  stats: ${f.stats.map((s) => `${s.label}=${s.value}`).join('; ')}` : null,
        `  actions: ${f.actions.map((a) => `[${a.recipient}] ${a.action}${a.deadline ? ` (by ${a.deadline})` : ''}`).join(' | ')}`,
    ].filter(Boolean).join('\n')).join('\n\n');
}

export function buildVettingMessages(reviewer: CouncilAgentDef, agentName: string, findings: ReadonlyArray<Finding>, window: string) {
    // INSTRUCTIONS FIRST, PERSONA SECOND. The persona ends with its own output
    // contract (a findings array for a convene). Placed first, the model
    // followed THAT and produced a convene-shaped essay that ate the whole
    // token budget. The task the reviewer is doing today leads; the persona
    // is who they are while doing it.
    const system = `You are ${reviewer.name}, ${reviewer.title}. Today you are NOT convening and you must NOT produce a findings list. You are REVIEWING the output of ${agentName}, an automated agent that reports to you, before it is mailed to the procurement desk. Your entire reply is one small JSON object described below. Think briefly; answer tersely.

WHO YOU ARE (background only — its output format does not apply today):
${reviewer.persona.replace(/Reply with ONLY[\s\S]*$/i, '').replace(/Return (a|the) JSON[\s\S]*$/i, '').trim()}

YOUR TASK TODAY:

Judge each finding on exactly two things, in this order:
1. EVIDENCE → PRIORITY. Does the evidence given support the priority claimed? A "critical" with no record behind it, or an amount that does not match the stated problem, is a concern.
2. ACTION → EXECUTABLE. Could the named recipient do the stated action this week, with what is in front of them? An action that needs information the mail does not carry is a concern.

You do not rewrite findings and you do not recompute numbers. You flag. Be specific: name the finding key. Be brief: one sentence per concern.

Reply with ONLY this JSON, nothing before or after, under 200 words total:
{
  "reasoning": "<2-3 sentences, your assessment of the run as a whole, written before you decide>",
  "verdict": "sound" | "sound_with_concerns" | "needs_human",
  "concerns": [ { "finding_key": "<key or null>", "concern": "<one sentence>", "suggestion": "<one sentence>" } ]
}
"needs_human" means: do not trust this run without a person reading it first.`;

    const user = `AGENT: ${agentName}\nSCAN WINDOW: ${window}\nFINDINGS (${findings.length}):\n\n${findingsAsData(findings)}\n\nProduce the JSON now.`;
    return [{ role: 'system' as const, content: system }, { role: 'user' as const, content: user }];
}

function parseVerdict(raw: string): { reasoning: string; verdict: Verdict; concerns: Concern[] } | null {
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const start = cleaned.indexOf('{'); const end = cleaned.lastIndexOf('}');
    if (start < 0 || end < 0) return null;
    try {
        const j = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
        const v = String(j.verdict ?? '');
        if (!['sound', 'sound_with_concerns', 'needs_human'].includes(v)) return null;
        const concerns = Array.isArray(j.concerns) ? j.concerns.map((c) => {
            const x = c as Record<string, unknown>;
            return { finding_key: x.finding_key ? String(x.finding_key) : null, concern: String(x.concern ?? '').slice(0, 400), suggestion: String(x.suggestion ?? '').slice(0, 400) };
        }).filter((c) => c.concern) : [];
        return { reasoning: String(j.reasoning ?? '').slice(0, 1200), verdict: v as Verdict, concerns };
    } catch { return null; }
}

/**
 * Have the persona named by `reportsTo` vet this run's findings. Never throws.
 * Writes the verdict to oem_council_log (review_type 'vetting') when it can.
 */
export async function vetFindings(
    orgId: string,
    agentKey: string,
    agentName: string,
    reportsTo: string | null | undefined,
    findings: ReadonlyArray<Finding>,
    window: string,
): Promise<VetResult> {
    if (!reportsTo) return { ...EMPTY, why: 'agent reports to nobody' };
    if (!findings.length) return { ...EMPTY, why: 'nothing to vet' };

    let reviewer: CouncilAgentDef | undefined;
    try {
        reviewer = (await loadAgents(orgId)).find((a) => a.key === reportsTo);
    } catch (e) {
        return { ...EMPTY, why: `council roster unavailable: ${e instanceof Error ? e.message : e}` };
    }
    if (!reviewer) return { ...EMPTY, why: `no council persona with key "${reportsTo}"` };
    const who = { key: reviewer.key, name: reviewer.name, title: reviewer.title };

    resetCouncilCost();
    let raw: string;
    try {
        raw = await councilChat(buildVettingMessages(reviewer, agentName, findings, window), 'vet');
    } catch (e) {
        return { ...EMPTY, reviewer: who, why: `model call failed: ${e instanceof Error ? e.message : e}`, findingsReviewed: findings.length };
    }
    const parsed = parseVerdict(raw);
    const cost = councilRunCost().costUsd;
    if (!parsed) {
        return { ...EMPTY, reviewer: who, why: 'reviewer did not return a parseable verdict', findingsReviewed: findings.length, costUsd: cost };
    }

    // Only concerns about findings that exist in this run survive; a key the
    // model invented is dropped, not surfaced.
    const known = new Set(findings.map((f) => f.key));
    const concerns = parsed.concerns.map((c) => ({ ...c, finding_key: c.finding_key && known.has(c.finding_key) ? c.finding_key : null }));

    let loggedId: string | null = null;
    // 'vetting' needs migration 20260907000001. Until it is applied, the verdict
    // is filed as 'performance_review' — the closest existing type, unused by any
    // other writer — so nothing is lost and the console still shows it.
    for (const reviewType of ['vetting', 'performance_review'] as const) {
        if (loggedId) break;
    try {
        const { data } = await supabaseAdmin.from('oem_council_log').insert({
            organization_id: orgId,
            agent_key: agentKey,
            review_type: reviewType,
            decision: parsed.verdict === 'needs_human' ? 'needs_human' : 'approved',
            decided_by: 'council',
            summary: `${reviewer.name} vetted ${agentName}'s ${window} scan: ${parsed.verdict.replace(/_/g, ' ')}` +
                (concerns.length ? `, ${concerns.length} concern(s)` : '') + '.',
            details: {
                agent_key: agentKey, reviewer: who, verdict: parsed.verdict,
                reasoning: parsed.reasoning, findings_reviewed: findings.length,
                concerns, cost_usd: cost, window,
            },
        }).select('id').maybeSingle();
        loggedId = data?.id ? String(data.id) : null;
    } catch { /* the log is advisory; the verdict still travels on the digest */ }
    }

    return { ok: true, reviewer: who, verdict: parsed.verdict, reasoning: parsed.reasoning, concerns, findingsReviewed: findings.length, costUsd: cost, loggedId };
}
