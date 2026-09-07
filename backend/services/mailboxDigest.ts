/**
 * PRIVACY: this ingests the contents of a shared mailbox (purchase@) into our own
 * database. Everything written here is org-scoped and service-role only — the sync
 * runs with supabaseAdmin, `mailbox_threads` has RLS on with a read policy limited to
 * that org's ACCOUNTS-ROLE members, and only trimmed headers + Zoho's own one-line
 * summaries are persisted (never full message bodies or attachments). Do not widen the
 * scope of this table or copy its rows anywhere that is not org-scoped.
 *
 * THIRD-PARTY PROCESSING: when MAILBOX_DIGEST_USE_LLM is enabled, thread METADATA — the
 * subject and truncated Zoho summaries, with counterparty addresses redacted to their
 * domain — is sent to OpenAI (api.openai.com, a US processor) for classification. Raw
 * counterparty email addresses are never transmitted, and neither are full message bodies
 * or attachments. The flag is OFF by default, so the digest runs fully heuristically
 * unless a deployment opts in; a present OPENAI_API_KEY is not on its own enough.
 *
 * Purchase mailbox digest: pull recent threads, bucket each one into what the team
 * actually owes an action on, upsert into mailbox_threads.
 *
 * Classification runs on OpenAI rather than the Groq client the rest of the repo uses.
 * That is deliberate: GROQ_API_KEY is shared with the ticket classifier, meter OCR, catalog
 * bulk-upload, call coaching and the master-admin chatbot, and Groq's free tier is a
 * 100,000 token DAILY organisation-wide budget. At ~600 tokens per thread this sweep
 * exhausts it in ~165 classifications and takes every interactive AI feature down with it.
 * Separate provider, separate quota. Falls back to deterministic heuristics whenever the
 * key is absent or a call fails, exactly like the Groq client does.
 */

import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { ZohoMailService, ZohoMailThread, isZohoMailConfigured, mailboxAddress } from './zohoMailService';

export type DigestCategory = 'awaiting_reply' | 'unactioned_request' | 'no_discovery' | 'other';

export interface MailboxDigestResult {
    orgId: string;
    synced: number;
    reopened: number;
    aiClassified: number;
    /** Estimated USD spent on classification this run, from the provider's usage numbers. */
    llmCostUsd?: number;
    skipped?: string;
    error?: string;
}

interface Classification {
    category: DigestCategory;
    waitingOn: string;
    by: 'ai' | 'heuristic';
}

const CATEGORIES: DigestCategory[] = ['awaiting_reply', 'unactioned_request', 'no_discovery', 'other'];

// OpenAI, deliberately NOT the shared GROQ_API_KEY.
//
// Groq's free tier is 100,000 tokens PER DAY across the whole organisation, and that key
// also powers ticket classification, meter OCR, catalog bulk-upload, call coaching and the
// master-admin chatbot. At ~600 tokens per thread this digest alone exhausts the daily
// budget in roughly 165 classifications — it starved every interactive AI feature in the
// app within one run. Separate provider = separate quota, so a background sweep can never
// again take live features down.
const LLM_API_URL = 'https://api.openai.com/v1/chat/completions';
const LLM_MODEL = process.env.MAILBOX_DIGEST_MODEL || 'gpt-5.6-terra';
const LLM_TIMEOUT_MS = 10_000;
// A full 300-thread pass is ~180k input tokens — cents on gpt-4o-mini — so the cap exists
// for latency inside the 300s function budget, not for cost.
const MAX_LLM_CALLS = 150;
// Calls run in waves this wide. 8 keeps a 150-thread sweep at ~25s wall clock while
// staying far below the provider's per-minute allowance.
const LLM_CONCURRENCY = 8;

// USD per million tokens. Only rates we have actually been told go here — an unpriced
// model falls back to a deliberately PESSIMISTIC estimate so the cap errs towards
// stopping early rather than overspending on a model whose price we are guessing.
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
    'gpt-5.6-luna': { input: 0.20, output: 1.20 },
    'gpt-4o-mini': { input: 0.15, output: 0.60 },
};
const UNPRICED_MODEL = { input: 2.50, output: 10.00 };

/**
 * SOFT cap: when a run's estimated spend passes this, stop calling the model and let the
 * heuristic finish the remaining threads. Nothing is dropped and nothing throws — the run
 * still writes every thread, just with cheaper verdicts, and the next run picks up where
 * this one stopped because classified threads are skipped.
 *
 * At measured volumes (~600 in / ~60 out tokens per thread) a full 300-thread pass on
 * gpt-5.6-luna is ~$0.06, so the default leaves generous headroom while still bounding a
 * runaway: 24 runs/day × $0.25 caps the day at ~$6 even in the worst case.
 */
const RUN_BUDGET_USD = Number(process.env.MAILBOX_DIGEST_RUN_BUDGET_USD || 0.25);

const LOOKBACK_DAYS = Number(process.env.ZOHO_MAIL_LOOKBACK_DAYS || 21);
const MAX_THREADS = 300;

// Explicit opt-in: shared-mailbox metadata leaves the tenancy boundary on this path, so a
// present API key must never on its own be enough to start sending it.
const LLM_ENABLED = process.env.MAILBOX_DIGEST_USE_LLM === 'true';

// The route budget is 300s. Stop issuing LLM calls with enough headroom left to finish
// the upserts — a run that spent its whole budget classifying used to write nothing at
// all, because no row was persisted until the loop had finished.
const RUN_BUDGET_MS = 200_000;
// Persist as we go rather than in one batch at the end, so a killed run keeps progress.
const UPSERT_CHUNK = 100;

const REQUEST_HINTS = [
    'need', 'require', 'request', 'requisition', 'kindly arrange', 'please arrange', 'please share',
    'please send', 'please provide', 'quotation', 'quote', 'purchase order', ' po ', 'procure',
    'order', 'supply', 'delivery', 'dispatch', 'urgent', 'follow up', 'following up', 'reminder',
    'awaiting', 'pending',
];
const QUESTION_HINTS = [
    '?', 'could you', 'can you', 'would you', 'please confirm', 'let me know', 'any update',
    'status of', 'when can', 'what is the', 'clarify', 'confirm the',
];
const SHARE_HINTS = ['fyi', 'for your reference', 'please find attached', 'sharing', 'attached', 'enclosed', 'catalogue', 'brochure'];

/**
 * Pull recent shared-mailbox threads for an org, classify them, and upsert into
 * mailbox_threads. Stays dormant (never throws) when ZOHO_MAIL_* is unset.
 * Idempotent: upserts on (organization_id, thread_id).
 */
export async function syncPurchaseMailboxForOrg(orgId: string): Promise<MailboxDigestResult> {
    if (!isZohoMailConfigured()) {
        return { orgId, synced: 0, reopened: 0, aiClassified: 0, skipped: 'Zoho Mail is not configured (ZOHO_MAIL_* env vars missing)' };
    }

    const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const stamp = new Date().toISOString();

    try {
        const threads = (await ZohoMailService.listThreads({ since })).slice(0, MAX_THREADS);
        if (threads.length === 0) return { orgId, synced: 0, reopened: 0, aiClassified: 0 };

        const mailbox = mailboxAddress();
        const deadline = Date.now() + RUN_BUDGET_MS;
        resetRunUsage();
        let aiCalls = 0;
        let aiClassified = 0;
        let synced = 0;

        // The lookback window only returns RECENT messages, so a long-running thread is
        // seen with fewer and fewer messages over time. Overwriting message_count and raw
        // from the window alone shrank threads on every run and flipped the derived facts,
        // re-bucketing a month-long answered conversation as "shared, no discovery".
        // Merge against what is already stored instead.
        const stored = await storedThreadHistory(orgId, threads.map(t => t.threadId));

        // Spend the LLM budget on threads that need it: never classified by AI, or changed
        // since the verdict was recorded. Everything else keeps its stored verdict, so the
        // backlog converges over a few runs instead of redoing the same head of the list.
        const aiSeen = await storedAiState(orgId, threads.map(t => t.threadId));
        const needsAi = (t: ZohoMailThread) => {
            const prior = aiSeen.get(t.threadId);
            return !prior || new Date(t.lastMessageAt).getTime() > new Date(prior.at).getTime();
        };
        // Stable: unclassified first, newest first within each group.
        const ordered = [...threads].sort((a, b) =>
            (Number(needsAi(b)) - Number(needsAi(a))) ||
            (new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()));

        // is_resolved / resolved_at are deliberately absent from the payload: ON CONFLICT
        // only overwrites the columns supplied, so a member's tick survives every resync.
        let batch: Record<string, unknown>[] = [];
        const flush = async () => {
            if (!batch.length) return;
            const { error } = await supabaseAdmin
                .from('mailbox_threads').upsert(batch, { onConflict: 'organization_id,thread_id' });
            if (error) throw new Error(error.message);
            synced += batch.length;
            batch = [];
        };

        // Stop on the first 429 rather than burning the remaining budget into rejections —
        // a third of every run was wasted that way. The next hourly run resumes where this
        // one stopped, because already-classified threads are skipped.
        let rateLimited = false;

        // Classify ahead of the write loop, in bounded-concurrency waves. gpt-5.6 costs
        // ~1.3s per call, so 150 sequential calls would take ~195s of a 200s budget and
        // start timing out; in waves of LLM_CONCURRENCY the same work lands in ~25s.
        const aiVerdicts = new Map<string, Classification>();
        if (LLM_ENABLED) {
            const queue = ordered.filter(needsAi).slice(0, MAX_LLM_CALLS);
            for (let i = 0; i < queue.length; i += LLM_CONCURRENCY) {
                if (rateLimited || Date.now() > deadline) break;
                if (runCostUsd() >= RUN_BUDGET_USD) {
                    console.warn(`[MailboxDigest] soft cap hit: $${runCostUsd().toFixed(4)} >= $${RUN_BUDGET_USD}; remaining threads stay heuristic`);
                    break;
                }
                const wave = queue.slice(i, i + LLM_CONCURRENCY);
                const settled = await Promise.all(wave.map(async (t) => {
                    const facts = summarise(mergeThreadMessages(t, stored.get(t.threadId)), mailbox);
                    aiCalls++;
                    return [t.threadId, await classifyWithLLM(facts)] as const;
                }));
                for (const [id, v] of settled) {
                    if (v) { aiVerdicts.set(id, v); aiClassified++; }
                    else if (lastLlmStatus() === 429) rateLimited = true;
                }
            }
        }

        for (const thread of ordered) {
            const merged = mergeThreadMessages(thread, stored.get(thread.threadId));
            const facts = summarise(merged, mailbox);

            // An unchanged thread keeps the AI verdict it already has. Recomputing the
            // heuristic here would quietly downgrade every AI classification back to a
            // heuristic one on the very next run.
            const prior = aiSeen.get(thread.threadId);
            let verdict: Classification = (!needsAi(thread) && prior)
                ? { category: prior.category, waitingOn: prior.waitingOn ?? '', by: 'ai' }
                : heuristicClassify(facts);

            const ai = aiVerdicts.get(thread.threadId);
            if (ai) verdict = ai;

            const newestInbound = [...merged.messages].reverse().find(m => m.fromAddress !== mailbox);
            const newest = merged.messages[merged.messages.length - 1];
            batch.push({
                organization_id: orgId,
                thread_id: merged.threadId,
                subject: merged.subject.slice(0, 500),
                from_address: (newestInbound || newest).fromAddress || null,
                participants: merged.participants,
                last_message_at: merged.lastMessageAt,
                message_count: merged.messages.length,
                snippet: (newest.summary || '').slice(0, 500),
                category: verdict.category,
                waiting_on: verdict.waitingOn.slice(0, 200),
                classified_by: verdict.by,
                // Headers + Zoho's own summaries only — no bodies, no attachments.
                raw: {
                    mailbox,
                    messages: merged.messages.map(m => ({
                        message_id: m.messageId,
                        from: m.fromAddress,
                        to: m.toAddress,
                        cc: m.ccAddress,
                        subject: m.subject,
                        summary: (m.summary || '').slice(0, 300),
                        sent_at: m.sentAt,
                        has_attachment: m.hasAttachment,
                    })),
                },
                synced_at: stamp,
                updated_at: stamp,
            });
            if (batch.length >= UPSERT_CHUNK) await flush();
        }
        await flush();

        const reopened = await reopenThreadsWithNewReplies(orgId, threads);
        return { orgId, synced, reopened, aiClassified, llmCostUsd: Number(runCostUsd().toFixed(5)) };
    } catch (e) {
        const msg = e instanceof Error ? e.message : 'mailbox sync failed';
        console.error('[MailboxDigest] sync failed:', msg);
        return { orgId, synced: 0, reopened: 0, aiClassified: 0, error: msg };
    }
}

/**
 * A thread someone ticked off is live again once a newer message lands on it.
 * `.in()` is chunked because it serialises into the query string — 300 thread ids in
 * one filter builds a ~6KB URL, close enough to the gateway's limit to matter.
 */
const IN_FILTER_CHUNK = 100;

async function reopenThreadsWithNewReplies(orgId: string, threads: ZohoMailThread[]): Promise<number> {
    const newestByThread = new Map(threads.map(t => [t.threadId, new Date(t.lastMessageAt).getTime()]));
    const ids = threads.map(t => t.threadId);
    const stale: string[] = [];

    for (let i = 0; i < ids.length; i += IN_FILTER_CHUNK) {
        const { data } = await supabaseAdmin
            .from('mailbox_threads')
            .select('thread_id, resolved_at')
            .eq('organization_id', orgId)
            .eq('is_resolved', true)
            .in('thread_id', ids.slice(i, i + IN_FILTER_CHUNK));

        for (const r of data || []) {
            const resolvedAt = r.resolved_at ? new Date(r.resolved_at).getTime() : 0;
            if (resolvedAt > 0 && (newestByThread.get(r.thread_id) ?? 0) > resolvedAt) stale.push(r.thread_id);
        }
    }

    for (let i = 0; i < stale.length; i += IN_FILTER_CHUNK) {
        await supabaseAdmin.from('mailbox_threads')
            .update({ is_resolved: false, resolved_at: null })
            .eq('organization_id', orgId).in('thread_id', stale.slice(i, i + IN_FILTER_CHUNK));
    }
    return stale.length;
}

type StoredMessage = {
    message_id?: string; from?: string; to?: string[]; cc?: string[];
    subject?: string; summary?: string; sent_at?: string; has_attachment?: boolean;
};

/** Previously-persisted messages per thread, so a thread never shrinks across runs. */
async function storedThreadHistory(orgId: string, threadIds: string[]): Promise<Map<string, StoredMessage[]>> {
    const out = new Map<string, StoredMessage[]>();
    if (!threadIds.length) return out;

    for (let i = 0; i < threadIds.length; i += IN_FILTER_CHUNK) {
        const { data } = await supabaseAdmin
            .from('mailbox_threads')
            .select('thread_id, raw')
            .eq('organization_id', orgId)
            .in('thread_id', threadIds.slice(i, i + IN_FILTER_CHUNK));
        for (const r of data || []) {
            const msgs = (r as any)?.raw?.messages;
            if (Array.isArray(msgs)) out.set(r.thread_id, msgs as StoredMessage[]);
        }
    }
    return out;
}

/**
 * Which threads already carry an AI verdict, and for which message.
 *
 * Without this the run classifies threads in list order every time, so the same first
 * MAX_LLM_CALLS threads are redone hourly and the tail is never reached at all — the
 * backlog cannot converge no matter how high the rate limit is.
 */
async function storedAiState(orgId: string, threadIds: string[]): Promise<Map<string, StoredAiVerdict>> {
    const out = new Map<string, StoredAiVerdict>();
    if (!threadIds.length) return out;

    for (let i = 0; i < threadIds.length; i += IN_FILTER_CHUNK) {
        const { data } = await supabaseAdmin
            .from('mailbox_threads')
            .select('thread_id, category, waiting_on, last_message_at')
            .eq('organization_id', orgId)
            .eq('classified_by', 'ai')
            .in('thread_id', threadIds.slice(i, i + IN_FILTER_CHUNK));
        for (const r of data || []) {
            if (!r.last_message_at || !r.category) continue;
            out.set(r.thread_id, {
                at: String(r.last_message_at),
                category: r.category as Classification['category'],
                waitingOn: (r.waiting_on as string | null) ?? null,
            });
        }
    }
    return out;
}

interface StoredAiVerdict {
    at: string;
    category: Classification['category'];
    waitingOn: string | null;
}

/**
 * Union the freshly-fetched window with what was stored last time, keyed on message id.
 * The live copy wins on conflict — it is the newer read of the same message.
 */
function mergeThreadMessages(thread: ZohoMailThread, prior?: StoredMessage[]): ZohoMailThread {
    if (!prior?.length) return thread;

    const byId = new Map<string, ZohoMailThread['messages'][number]>();
    for (const p of prior) {
        if (!p?.message_id || !p.sent_at) continue;
        byId.set(p.message_id, {
            messageId: p.message_id,
            threadId: thread.threadId,
            folderId: null,
            subject: p.subject || '',
            summary: p.summary || '',
            fromAddress: p.from || '',
            // Stored rows predate the display name; the live copy carries it.
            fromName: null,
            toAddress: p.to || [],
            ccAddress: p.cc || [],
            sentAt: p.sent_at,
            hasAttachment: !!p.has_attachment,
        });
    }
    for (const m of thread.messages) byId.set(m.messageId, m);

    const messages = [...byId.values()].sort(
        (a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime(),
    );
    const participants = [...new Set(
        messages.flatMap(m => [m.fromAddress, ...m.toAddress, ...m.ccAddress]).filter(Boolean),
    )];

    return {
        ...thread,
        messages,
        participants,
        // Never move the marker backwards; the window's newest is the live truth.
        lastMessageAt: thread.lastMessageAt,
    };
}

interface ThreadFacts {
    subject: string;
    messageCount: number;
    hasOutbound: boolean;
    mailboxRepliedLast: boolean;
    mailboxAddressed: boolean;      // mailbox is an explicit to/cc recipient, i.e. tagged in
    lastInboundFrom: string;
    lastInboundText: string;
    firstInboundText: string;
    hasAttachment: boolean;
    ageDays: number;
}

function summarise(thread: ZohoMailThread, mailbox: string): ThreadFacts {
    const inbound = thread.messages.filter(m => m.fromAddress !== mailbox);
    const outbound = thread.messages.filter(m => m.fromAddress === mailbox);
    const lastInbound = inbound[inbound.length - 1];
    const lastOutbound = outbound[outbound.length - 1];

    const text = (m?: { subject: string; summary: string }) =>
        `${m?.subject || ''} ${m?.summary || ''}`.toLowerCase();

    return {
        subject: thread.subject,
        messageCount: thread.messages.length,
        hasOutbound: outbound.length > 0,
        mailboxRepliedLast: !!lastOutbound && !!lastInbound
            && new Date(lastOutbound.sentAt).getTime() >= new Date(lastInbound.sentAt).getTime(),
        mailboxAddressed: inbound.some(m => [...m.toAddress, ...m.ccAddress].includes(mailbox)),
        lastInboundFrom: lastInbound?.fromAddress || '',
        lastInboundText: text(lastInbound),
        firstInboundText: text(inbound[0]),
        hasAttachment: thread.messages.some(m => m.hasAttachment),
        ageDays: Math.max(0, Math.round((Date.now() - new Date(thread.lastMessageAt).getTime()) / 86400000)),
    };
}

/**
 * Deterministic fallback. Order matters: a thread the mailbox already answered is done;
 * otherwise a direct question outranks a standing request, which outranks a bare share.
 */
function heuristicClassify(f: ThreadFacts): Classification {
    const waitingOnTeam = 'Purchase team';
    if (!f.lastInboundFrom || f.mailboxRepliedLast) {
        return { category: 'other', waitingOn: f.lastInboundFrom || 'No one', by: 'heuristic' };
    }

    const hit = (hints: string[], text: string) => hints.some(h => text.includes(h));

    if (hit(QUESTION_HINTS, f.lastInboundText) && (f.mailboxAddressed || f.messageCount > 1)) {
        return { category: 'awaiting_reply', waitingOn: waitingOnTeam, by: 'heuristic' };
    }
    if (hit(REQUEST_HINTS, f.lastInboundText) || hit(REQUEST_HINTS, f.firstInboundText)) {
        return { category: 'unactioned_request', waitingOn: waitingOnTeam, by: 'heuristic' };
    }
    if (!f.hasOutbound && (f.messageCount === 1 || f.hasAttachment || hit(SHARE_HINTS, f.firstInboundText))) {
        return { category: 'no_discovery', waitingOn: waitingOnTeam, by: 'heuristic' };
    }
    return { category: 'other', waitingOn: f.lastInboundFrom, by: 'heuristic' };
}

/** LLM tie-breaker. Returns null on any failure so the caller keeps the heuristic verdict. */
// HTTP status of the most recent LLM call, so the caller can tell "rate limited" (stop,
// resume next run) apart from "this one thread failed" (skip it, carry on).
let llmStatus = 0;

// Tokens consumed by the current run, reset by resetRunUsage() at the top of each sync.
let runInputTokens = 0;
let runOutputTokens = 0;

function resetRunUsage() { runInputTokens = 0; runOutputTokens = 0; }

/** Estimated USD spent so far this run, from the provider's own usage numbers. */
function runCostUsd(): number {
    const p = MODEL_PRICING[LLM_MODEL] ?? UNPRICED_MODEL;
    return (runInputTokens * p.input + runOutputTokens * p.output) / 1e6;
}
const lastLlmStatus = () => llmStatus;

async function classifyWithLLM(f: ThreadFacts): Promise<Classification | null> {
    // Reset per call. llmStatus is module state, so leaving a previous run's 429 in place
    // meant one timeout (which returns null without a status) tripped the rate-limit
    // short-circuit on the very first thread and skipped the entire run.
    llmStatus = 0;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

    try {
        // gpt-5.x rejects both `max_tokens` (wants `max_completion_tokens`) and any
        // `temperature` other than the default, with a 400 each time. Keep the 4o-style
        // shape available so MAILBOX_DIGEST_MODEL can still point at gpt-4o-mini.
        const isGpt5 = /^(gpt-5|o[34])/.test(LLM_MODEL);
        const response = await fetch(LLM_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({
                model: LLM_MODEL,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: userPrompt(f) },
                ],
                ...(isGpt5
                    ? { max_completion_tokens: 400 }   // headroom: reasoning tokens count here
                    : { temperature: 0.1, max_tokens: 150 }),
                response_format: { type: 'json_object' },
            }),
            signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            llmStatus = response.status;
            console.warn('[MailboxDigest] LLM API error:', response.status);
            return null;
        }
        llmStatus = 200;

        const data = await response.json();
        runInputTokens += Number(data?.usage?.prompt_tokens || 0);
        runOutputTokens += Number(data?.usage?.completion_tokens || 0);
        const content = data?.choices?.[0]?.message?.content;
        if (!content) return null;

        const parsed = JSON.parse(content);
        const category = String(parsed?.category || '').toLowerCase() as DigestCategory;
        if (!CATEGORIES.includes(category)) return null;

        // waiting_on is resolved LOCALLY, not taken from the model: the prompt only ever
        // saw a redacted address, so echoing its answer back would display
        // "someone@vendor.com" to the team. The model decides the category; we own the name.
        const waitingOn = category === 'other' ? (f.lastInboundFrom || 'No one') : 'Purchase team';
        return { category, waitingOn, by: 'ai' };
    } catch (error) {
        clearTimeout(timeoutId);
        if (!(error instanceof Error && error.name === 'AbortError')) {
            console.warn('[MailboxDigest] LLM call failed:', error instanceof Error ? error.message : error);
        }
        return null;
    }
}

const SYSTEM_PROMPT = `You triage a shared purchasing mailbox and decide what the purchase team still owes an action on.

Pick exactly one category:
- "awaiting_reply": someone asked the mailbox a question or wants confirmation, and the mailbox has not answered.
- "unactioned_request": someone needs an item, quote, PO or delivery and nobody from the mailbox has acted yet.
- "no_discovery": something was shared (a document, quote, catalogue, FYI) and no conversation or follow-up started.
- "other": the mailbox already replied, or nothing is pending from the purchase team.

Respond ONLY in valid JSON: {"category": "..."}`;

// The classifier only needs to know WHETHER there is a counterparty, not who. Shipping
// the raw address would send a named third party's PII to a US processor for no gain.
function redactAddress(addr: string): string {
    if (!addr) return 'none';
    const at = addr.lastIndexOf('@');
    return at > 0 ? `someone@${addr.slice(at + 1)}` : 'a sender';
}

function userPrompt(f: ThreadFacts): string {
    return `Subject: ${f.subject}
Messages in thread: ${f.messageCount}
Mailbox has replied at least once: ${f.hasOutbound}
Mailbox sent the most recent message: ${f.mailboxRepliedLast}
Mailbox was explicitly addressed (to/cc): ${f.mailboxAddressed}
Newest inbound sender: ${redactAddress(f.lastInboundFrom)}
Days since last activity: ${f.ageDays}
Has attachments: ${f.hasAttachment}

First inbound message: "${f.firstInboundText.slice(0, 600)}"
Latest inbound message: "${f.lastInboundText.slice(0, 600)}"

Classify and return JSON.`;
}
