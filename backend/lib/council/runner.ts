/**
 * Council runner — the 3-stage protocol from docs/COUNCIL_SPEC.md, adapted
 * from scratch/llm-council-ref/backend/council.py:
 *
 *   Stage 1: the 8 personas analyze the question + data pack in parallel;
 *            each returns findings JSON (parsed leniently) → council_messages
 *            (stage='opinion') + council_findings rows.
 *   Stage 2: opinions are anonymized as Agent A..H; every persona ranks all
 *            analyses on evidence quality + actionability → council_messages
 *            (stage='review', label = the reviewer's anonymized id).
 *   Stage 3: a neutral chairman synthesizes the Council Audit markdown
 *            (P0s w/ repro-impact-ask, data trust, quick wins, open
 *            questions, compliance exposure) → council_messages
 *            (stage='synthesis'); aggregate rankings ride in its findings col.
 *
 * Session status moves running → stage1 → stage2 → synthesis → complete, or
 * failed with the error text, so the UI can stream progress.
 *
 * Persistence goes through the CouncilStore interface: the production store
 * hits the council_* tables via the service role; tests (and the
 * COUNCIL_MOCK_LLM smoke run) substitute an in-memory store, which keeps this
 * module runnable before the migration is applied.
 */

import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { councilChat, COUNCIL_MODEL } from './llm';
import {
    FOUNDING_AGENTS,
    buildOpinionMessages,
    buildReviewMessages,
    buildSynthesisMessages,
    CHAIRMAN_KEY,
} from './personas';
import type { CouncilAgentDef, CouncilFinding, LabeledOpinion } from './personas';
import type { CouncilDataPack } from './dataPack';

// ---------------------------------------------------------------------------
// Lenient parsing
// ---------------------------------------------------------------------------

const SEVERITIES = new Set(['P0', 'P1', 'P2']);

function normalizeFinding(raw: unknown): CouncilFinding | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const title = typeof r.title === 'string' ? r.title.trim() : '';
    if (!title) return null;
    const sev = typeof r.severity === 'string' ? r.severity.toUpperCase().trim() : '';
    return {
        severity: (SEVERITIES.has(sev) ? sev : 'P2') as CouncilFinding['severity'],
        title,
        detail: typeof r.detail === 'string' ? r.detail : '',
        evidence: r.evidence && typeof r.evidence === 'object' && !Array.isArray(r.evidence)
            ? (r.evidence as Record<string, unknown>)
            : {},
        recommendation: typeof r.recommendation === 'string' ? r.recommendation : '',
    };
}

/**
 * Lenient findings parser: strips code fences, tolerates prose around the
 * JSON array, normalizes severity/title/evidence. Unparseable → [] (the raw
 * content is still persisted as the opinion message, so nothing is lost).
 */
export function parseFindings(raw: string): CouncilFinding[] {
    let text = raw.trim();
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (fence) text = fence[1].trim();
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start === -1 || end === -1 || end <= start) return [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(text.slice(start, end + 1));
    } catch {
        return [];
    }
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeFinding).filter((f): f is CouncilFinding => f !== null);
}

/** Parse the FINAL RANKING section of a stage-2 review into ordered labels. */
export function parseRanking(text: string): string[] {
    const idx = text.indexOf('FINAL RANKING:');
    const section = idx >= 0 ? text.slice(idx) : text;
    const numbered = section.match(/\d+\.\s*Agent [A-Z]/g);
    if (numbered && numbered.length) {
        return numbered.map(m => m.match(/Agent [A-Z]/)![0]);
    }
    return section.match(/Agent [A-Z]/g) || [];
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export type SessionStatus = 'running' | 'stage1' | 'stage2' | 'synthesis' | 'complete' | 'failed';

export interface CouncilMessageRow {
    session_id: string;
    agent_key: string;
    stage: 'opinion' | 'review' | 'synthesis';
    label?: string | null;
    content: string;
    findings?: unknown;
    model?: string;
}

export interface CouncilFindingRow {
    org_id: string;
    session_id: string;
    agent_key: string;
    severity: string;
    title: string;
    detail: string;
    evidence: unknown;
    recommendation?: string;
}

export interface CouncilStore {
    setSessionStatus(sessionId: string, status: SessionStatus, extra?: Record<string, unknown>): Promise<void>;
    saveMessage(msg: CouncilMessageRow): Promise<void>;
    saveFindings(rows: CouncilFindingRow[]): Promise<void>;
}

/** Production store — council_* tables via the service role. */
export function createSupabaseCouncilStore(): CouncilStore {
    return {
        async setSessionStatus(sessionId, status, extra) {
            const { error } = await supabaseAdmin
                .from('council_sessions')
                .update({ status, ...(extra || {}) })
                .eq('id', sessionId);
            if (error) throw new Error(`council_sessions update: ${error.message}`);
        },
        async saveMessage(msg) {
            const { error } = await supabaseAdmin.from('council_messages').insert(msg);
            if (error) throw new Error(`council_messages insert: ${error.message}`);
        },
        async saveFindings(rows) {
            if (!rows.length) return;
            const { error } = await supabaseAdmin.from('council_findings').insert(rows);
            if (error) throw new Error(`council_findings insert: ${error.message}`);
        },
    };
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

/**
 * Load the org's active agents from council_agents. Falls back to the
 * built-in personas when the table is missing (migration not applied) or the
 * org has no seed — the council can still convene, and the UI gets the same
 * shape either way.
 */
export async function loadAgents(orgId: string): Promise<CouncilAgentDef[]> {
    try {
        const { data, error } = await supabaseAdmin
            .from('council_agents')
            .select('key, name, title, email, lens, persona, color, sort')
            .eq('org_id', orgId)
            .eq('is_active', true)
            .order('sort', { ascending: true });
        if (error) throw new Error(error.message);
        if (data && data.length) {
            return (data as Array<Omit<CouncilAgentDef, 'sort'> & { sort: number | null }>).map((row, i) => ({
                key: row.key,
                name: row.name,
                title: row.title,
                email: row.email,
                lens: row.lens,
                persona: row.persona,
                color: row.color,
                sort: row.sort ?? i + 1,
            }));
        }
        console.warn(`[council] no seeded agents for org ${orgId} — using built-in personas`);
    } catch (e) {
        console.warn('[council] council_agents unavailable — using built-in personas:', e instanceof Error ? e.message : e);
    }
    return FOUNDING_AGENTS;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export interface CouncilReview {
    agentKey: string;
    agentName: string;
    label: string;
    content: string;
    parsedRanking: string[];
}

export interface AggregateRank {
    agentKey: string;
    agentName: string;
    averageRank: number;
    rankingsCount: number;
}

export interface CouncilRunResult {
    sessionId: string;
    status: 'complete';
    opinions: LabeledOpinion[];
    reviews: CouncilReview[];
    aggregate: AggregateRank[];
    synthesis: string;
    findingsCount: number;
    /** Personas whose stage-1 call failed — their seat stayed dark this run. */
    failedAgents: string[];
}

export interface RunCouncilOptions {
    sessionId: string;
    orgId: string;
    question: string;
    agents: CouncilAgentDef[];
    dataPack: CouncilDataPack;
    store: CouncilStore;
}

const labelFor = (i: number) => `Agent ${String.fromCharCode(65 + i)}`;

export async function runCouncil(opts: RunCouncilOptions): Promise<CouncilRunResult> {
    const { sessionId, orgId, question, agents, dataPack, store } = opts;
    const sorted = [...agents].sort((a, b) => a.sort - b.sort);

    // Persistence failures must not nuke an expensive LLM run — log and continue.
    const persist = async (what: string, fn: () => Promise<void>) => {
        try {
            await fn();
        } catch (e) {
            console.error(`[council] persist failed (${what}):`, e instanceof Error ? e.message : e);
        }
    };
    const setStatus = (status: SessionStatus, extra?: Record<string, unknown>) =>
        persist(`status=${status}`, () => store.setSessionStatus(sessionId, status, extra));

    try {
        // ---------------------------------------------------------------
        // Stage 1 — independent opinions, 8 parallel calls.
        // ---------------------------------------------------------------
        await setStatus('stage1');

        const opinionCalls = await Promise.allSettled(
            sorted.map(agent => councilChat(buildOpinionMessages(agent, question, dataPack), 'opinion')),
        );

        const opinions: LabeledOpinion[] = [];
        const failedAgents: string[] = [];
        const findingRows: CouncilFindingRow[] = [];

        for (let i = 0; i < sorted.length; i++) {
            const agent = sorted[i];
            const call = opinionCalls[i];
            if (call.status === 'rejected') {
                failedAgents.push(agent.key);
                console.error(`[council] stage1 ${agent.key} failed:`, call.reason);
                continue;
            }
            const content = call.value;
            const findings = parseFindings(content);
            opinions.push({ label: labelFor(i), agentKey: agent.key, agentName: agent.name, content, findings });

            await persist(`opinion ${agent.key}`, () => store.saveMessage({
                session_id: sessionId,
                agent_key: agent.key,
                stage: 'opinion',
                content,
                findings,
                model: COUNCIL_MODEL,
            }));

            for (const f of findings) {
                findingRows.push({
                    org_id: orgId,
                    session_id: sessionId,
                    agent_key: agent.key,
                    severity: f.severity,
                    title: f.title,
                    detail: f.detail,
                    evidence: f.evidence,
                    recommendation: f.recommendation,
                });
            }
        }

        if (!opinions.length) {
            throw new Error(`All ${sorted.length} stage-1 persona calls failed (${failedAgents.join(', ')})`);
        }
        await persist('findings', () => store.saveFindings(findingRows));

        // ---------------------------------------------------------------
        // Stage 2 — anonymized peer review. Labels are stable across all
        // reviewers so the aggregate maps back cleanly.
        // ---------------------------------------------------------------
        await setStatus('stage2');

        const reviewCalls = await Promise.allSettled(
            sorted.map(agent => councilChat(buildReviewMessages(agent, question, opinions), 'review')),
        );

        const reviews: CouncilReview[] = [];
        for (let i = 0; i < sorted.length; i++) {
            const agent = sorted[i];
            const call = reviewCalls[i];
            if (call.status === 'rejected') {
                console.error(`[council] stage2 ${agent.key} failed:`, call.reason);
                continue;
            }
            const content = call.value;
            const parsedRanking = parseRanking(content);
            const label = labelFor(i);
            reviews.push({ agentKey: agent.key, agentName: agent.name, label, content, parsedRanking });

            await persist(`review ${agent.key}`, () => store.saveMessage({
                session_id: sessionId,
                agent_key: agent.key,
                stage: 'review',
                label,
                content,
                findings: { parsed_ranking: parsedRanking },
                model: COUNCIL_MODEL,
            }));
        }

        // Aggregate: average rank position per anonymized label → agent.
        const labelToAgent = new Map(opinions.map(o => [o.label, o]));
        const positions = new Map<string, number[]>();
        for (const r of reviews) {
            r.parsedRanking.forEach((label, idx) => {
                if (!labelToAgent.has(label)) return;
                if (!positions.has(label)) positions.set(label, []);
                positions.get(label)!.push(idx + 1);
            });
        }
        const aggregate: AggregateRank[] = [...positions.entries()]
            .map(([label, pos]) => {
                const o = labelToAgent.get(label)!;
                return {
                    agentKey: o.agentKey,
                    agentName: o.agentName,
                    averageRank: Math.round((pos.reduce((s, p) => s + p, 0) / pos.length) * 100) / 100,
                    rankingsCount: pos.length,
                };
            })
            .sort((a, b) => a.averageRank - b.averageRank);

        // ---------------------------------------------------------------
        // Stage 3 — chairman synthesis → the Council Audit.
        // ---------------------------------------------------------------
        await setStatus('synthesis');

        const synthesis = await councilChat(
            buildSynthesisMessages(question, dataPack, opinions, reviews, aggregate),
            'synthesis',
        );

        await persist('synthesis message', () => store.saveMessage({
            session_id: sessionId,
            agent_key: CHAIRMAN_KEY,
            stage: 'synthesis',
            content: synthesis,
            findings: {
                aggregate_rankings: aggregate,
                label_to_agent: Object.fromEntries([...labelToAgent.entries()].map(([l, o]) => [l, o.agentKey])),
            },
            model: COUNCIL_MODEL,
        }));

        await setStatus('complete', { completed_at: new Date().toISOString() });

        return {
            sessionId,
            status: 'complete',
            opinions,
            reviews,
            aggregate,
            synthesis,
            findingsCount: findingRows.length,
            failedAgents,
        };
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await setStatus('failed', { error: message });
        throw e instanceof Error ? e : new Error(message);
    }
}
