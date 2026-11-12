/**
 * ORG WIKI — answering a question.
 *
 * A workflow, not an agent (see AGENT_SPEC.md): retrieve, then one model call.
 *
 *   1. wiki_search (Postgres full-text, OR over the question's words, title boost)
 *      picks the top pages. The overview — the wiki's index — always rides along.
 *   2. No match at all → a fixed reply, no model call.
 *   3. Otherwise one councilChat call (the repo's single LLM client, Engy in
 *      production) answers from those pages only and cites them as [[slug]].
 *   4. The question, what was retrieved, what was cited and what it cost are
 *      written to wiki_questions, and the run is traced in the Agent Console.
 */

import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { councilChat, councilRunCost } from '@/backend/lib/council/llm';
import { withAgentRun } from '@/backend/lib/agents/instrument';
import { WIKI_AGENT_KEY, WIKI_NOT_PROVISIONED, isMissingTable } from './store';

/**
 * Measured 2026-10-16 on real pages: the council default (a reasoning model) took
 * 95–379 s per answer; deepseek-v4-flash-0731 took ~3 s at ~$0.0003 with the same
 * facts. A wrong answer here costs little (cited, read by a person, no action taken),
 * so the fast tier is the right one [BAA p.112]. WIKI_MODEL overrides.
 */
export const WIKI_MODEL = process.env.WIKI_MODEL?.trim() || 'deepseek-v4-flash-0731';

const RETRIEVE = 6;
const PAGE_CHARS = 9000;
const NOT_IN_WIKI = 'NOT IN WIKI:';

export interface WikiAnswer {
    id: string | null;
    status: 'answered' | 'not_found' | 'failed';
    answer: string;
    cited: { slug: string; title: string; kind: string }[];
    retrieved: { slug: string; title: string; kind: string }[];
    costUsd: number | null;
    latencyMs: number;
}

export const WIKI_SYSTEM_PROMPT = [
    'You answer questions for the super admins of Autopilot Offices from their internal wiki.',
    'The wiki pages below were compiled by code from Zoho Books purchase orders and their line items, the purchase@ mailbox digest (subjects and opening lines only) and the FMS development journal. Notes are earlier answers a person chose to save.',
    '',
    'Follow these steps in order. Do not skip any.',
    '1. Read every page below before you answer.',
    '2. Answer only from what the pages say. Do not use outside knowledge, and do not estimate or calculate a figure the pages do not give, except simple sums or differences of figures that are on the pages; say when you have added things up.',
    '3. After every figure, name or claim, cite the page it came from. Each page header shows its citation in double brackets, e.g. [[vendor/bvg-india-limited]]; copy that bracketed slug exactly, and nothing else from the header.',
    '4. If two pages disagree, say so and cite both.',
    `5. If the pages answer the question fully or partly, answer with what they give and say plainly what is missing. Only if the pages hold nothing that answers it, begin your reply with "${NOT_IN_WIKI}" and say in one or two sentences what the pages cover that is closest.`,
    '6. PO values and vendor or site totals include tax, as on the PO. Line-item rates and line totals are before tax. Never compare one with the other without saying so.',
    '7. Lead with the direct answer in one or two sentences, then at most six "- " bullets of supporting detail. Write money the way the pages do (₹ with Indian digit grouping).',
    '8. Plain text and "- " bullets only. No tables, no headings, no markdown links other than [[slug]] citations.',
    '',
    'Format example only (these figures are invented, never repeat them):',
    'Question: What did we last pay for floor cleaner?',
    'Answer: ₹805 a can, on 12 Aug 2026 [[item/floor-cleaner-5l-can]].',
    '- The median over 14 purchases is ₹790 [[item/floor-cleaner-5l-can]].',
    '- Two vendors supply it; the cheaper on median is the one we last bought from [[item/floor-cleaner-5l-can]].',
].join('\n');

type Hit = { slug: string; kind: string; title: string; summary: string | null; score: number };

export async function askWiki(opts: { orgId: string; userId: string; question: string }): Promise<WikiAnswer> {
    const question = opts.question.replace(/\s+/g, ' ').trim().slice(0, 500);
    const t0 = Date.now();

    const { data: hitsRaw, error: searchError } = await supabaseAdmin.rpc('wiki_search', {
        p_org: opts.orgId, p_query: question, p_limit: RETRIEVE,
    });
    if (searchError) throw new Error(isMissingTable(searchError) ? WIKI_NOT_PROVISIONED : `Wiki search failed: ${searchError.message}`);
    const hits = (hitsRaw ?? []) as Hit[];

    const record = async (row: {
        status: WikiAnswer['status']; answer: string | null; retrieved: string[]; cited: string[];
        cost: number | null; error?: string | null;
    }) => {
        const { data } = await supabaseAdmin.from('wiki_questions').insert({
            organization_id: opts.orgId, asked_by: opts.userId, question,
            answer: row.answer, status: row.status, retrieved: row.retrieved, cited: row.cited,
            model: row.status === 'answered' || row.status === 'not_found' ? WIKI_MODEL ?? 'default' : null,
            cost_usd: row.cost, latency_ms: Date.now() - t0, error: row.error ?? null,
        }).select('id').maybeSingle();
        return data?.id ?? null;
    };

    // Full-text rank favours month pages for "pending approval" (their status column
    // repeats it), so the page built to answer that kind of question always rides along.
    const wantsFlags = /pending|approv|draft|duplicate|repeat|flag|risk|overdue|rise|rising|increase|jump/i.test(question);
    const slugs = [...new Set([...hits.map((h) => h.slug), ...(wantsFlags ? ['flags'] : []), 'overview'])];
    const { data: pagesRaw, error: pageError } = await supabaseAdmin.from('wiki_pages')
        .select('slug, kind, title, body_md').eq('organization_id', opts.orgId).in('slug', slugs);
    if (pageError) throw new Error(`Reading wiki pages failed: ${pageError.message}`);
    const pages = slugs.map((s) => (pagesRaw ?? []).find((p) => p.slug === s)).filter(Boolean) as
        { slug: string; kind: string; title: string; body_md: string }[];
    const meta = (s: string) => {
        const p = pages.find((x) => x.slug === s);
        return p ? { slug: p.slug, title: p.title, kind: p.kind } : null;
    };
    const retrieved = pages.map((p) => ({ slug: p.slug, title: p.title, kind: p.kind }));

    if (!hits.length) {
        const answer = 'Nothing in the wiki matches that question. Try naming a vendor, a site, an item or a month, or open the overview to see what the wiki holds.';
        const id = await record({ status: 'not_found', answer, retrieved: [], cited: [], cost: null });
        return { id, status: 'not_found', answer, cited: [], retrieved, costUsd: null, latencyMs: Date.now() - t0 };
    }

    const context = pages.map((p) => {
        const body = p.body_md.length > PAGE_CHARS ? `${p.body_md.slice(0, PAGE_CHARS)}\n[…page cut for length]` : p.body_md;
        return `=== PAGE [[${p.slug}]] — ${p.title} ===\n${body}`;
    }).join('\n\n');

    try {
        const out = await withAgentRun<{ text: string; cost: number }>(
            { orgId: opts.orgId, agentKey: WIKI_AGENT_KEY, module: 'procurement', trigger: 'manual', model: WIKI_MODEL },
            async (step) => {
                const r = await step('Retrieved pages', 'fetch', { question, retrieved: slugs });
                await r.ok();
                const llm = await step('Answering from the pages', 'llm');
                const before = councilRunCost().costUsd;
                const text = await councilChat([
                    { role: 'system', content: WIKI_SYSTEM_PROMPT },
                    { role: 'user', content: `Question: ${question}\n\nPages:\n\n${context}` },
                ], 'synthesis', { model: WIKI_MODEL });
                // councilChat keeps a process-wide running total and returns no usage, so the
                // cost is the difference across the call — approximate if another call overlaps.
                const cost = Math.max(0, councilRunCost().costUsd - before);
                await llm.ok({ detail: { chars_in: context.length, chars_out: text.length } });
                return { outcome: `Answered from ${pages.length} pages.`, costUsd: cost || null, grounded: true, result: { text, cost } };
            },
        );
        const raw = (out?.text ?? '').trim();
        const notFound = raw.toUpperCase().startsWith(NOT_IN_WIKI);
        const answer = notFound ? raw.slice(NOT_IN_WIKI.length).trim() : raw;
        const known = new Set(pages.map((p) => p.slug));
        const citedSlugs = [...new Set([...answer.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map((m) => m[1].trim()))].filter((s) => known.has(s));
        const status = notFound ? 'not_found' : 'answered';
        const id = await record({ status, answer, retrieved: slugs, cited: citedSlugs, cost: out?.cost ?? null });
        return {
            id, status, answer,
            cited: citedSlugs.map(meta).filter(Boolean) as WikiAnswer['cited'],
            retrieved, costUsd: out?.cost ?? null, latencyMs: Date.now() - t0,
        };
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const id = await record({ status: 'failed', answer: null, retrieved: slugs, cited: [], cost: null, error: message.slice(0, 500) });
        return { id, status: 'failed', answer: `The answer could not be produced: ${message.slice(0, 200)}`, cited: [], retrieved, costUsd: null, latencyMs: Date.now() - t0 };
    }
}
