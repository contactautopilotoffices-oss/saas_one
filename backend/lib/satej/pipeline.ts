/**
 * SATEJ — the vendor discovery state machine.
 *
 *   submitted → (needs_clarification) → structured → discovering → (awaiting_call_approval)
 *   → calling → calls_done → analyzing → ranked → notified
 *
 * advance() moves one requirement forward as far as it can, then stops at a
 * waiting state (a team answer, an approval, calls in progress). It is safe to
 * call any number of times: a row lock stops two workers from processing the
 * same requirement, and every stage is idempotent.
 *
 * Every stage that does work (LLM, search, a Bolna batch, WhatsApp) runs inside
 * withAgentRun, so it appears on Satej's trace in the Agent Console. The one
 * stage that is only waiting — 'calling', polled every minute — is not traced,
 * or the console would drown in empty runs.
 *
 * Ported from the procurement-agent package. Deliberate differences, and why:
 *   · tenant-scoped (organizationId on every row); FMS login instead of a shared key
 *   · Engy through the shared council client; no second LLM client
 *   · WhatsApp through AiSensy templates; the WhatsApp command channel
 *     (NEW / STATUS / ANSWER over chat) is not ported — see the journal entry
 *   · call approval ON by default (SATEJ_AUTO_START_CALLS)
 *   · a failed search or failed page-reading is reported as a failure, never as
 *     "no vendors found"; a call that cannot be analysed stops being retried
 *     after 3 attempts instead of costing an LLM call every minute forever
 */

import { withAgentRun } from '@/backend/lib/agents/instrument';
import type { StepFn } from '@/backend/lib/agents/runtime';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { satejConfig } from './config';
import { getRepo, DuplicateCodeError } from './repo';
import { chatJSON, llmSpendUsd } from './clients/llm';
import { exaSearch, type ExaPage } from './clients/exa';
import { createBatch, getBatch, listBatchExecutions, scheduleBatch } from './clients/bolna';
import { sendTemplate } from './clients/whatsapp';
import { STRUCTURER_SYSTEM, structurerUser } from './prompts/structurer';
import { DISCOVERY_SYSTEM, discoveryUser } from './prompts/discovery';
import { CALL_ANALYST_SYSTEM, callAnalystUser } from './prompts/callAnalyst';
import { CALL_VARIABLES } from './prompts/voiceAgent';
import { rankVendors, scoreCall } from './scoring';
import { inputNeededTemplateParams, noVendorsTemplateParams, questionsAsk, summaryTemplateParams } from './summary';
import {
    FINAL_CALL_STATUSES,
    type CallAnalysis,
    type CallRecord,
    type LiveProgress,
    type Requirement,
    type RequirementInput,
    type RequirementStatus,
    type StructuredBrief,
    type Vendor,
} from './types';
import { mapLimit, newId, newRequirementCode, nextCallSlot, normName, normaliseIndianPhone, nowIso, toCsv } from './util';

export const SATEJ_AGENT_KEY = 'satej';

const WAITING: RequirementStatus[] = ['needs_clarification', 'awaiting_call_approval', 'notified', 'failed', 'cancelled'];
export const WORKER_STATUSES: RequirementStatus[] = ['submitted', 'structured', 'discovering', 'calling', 'calls_done', 'analyzing', 'ranked'];
/** Stages that do work worth a trace. 'calling' only polls. */
const TRACED: RequirementStatus[] = ['submitted', 'structured', 'discovering', 'calls_done', 'analyzing', 'ranked'];
const MAX_ANALYSIS_ATTEMPTS = 3;
const MAX_PAGES = 40;

type Trigger = 'manual' | 'cron' | 'webhook';

const isFinal = (s: string) => (FINAL_CALL_STATUSES as readonly string[]).includes(s);

/** A step recorder that records nothing — for untraced stages and mock runs. */
const NO_STEP: StepFn = async () => ({
    id: null,
    seq: 0,
    async end() { /* not recording */ },
    async ok() { /* not recording */ },
    async fail() { /* not recording */ },
});

function log(r: Requirement, msg: string) {
    r.events.push({ at: nowIso(), msg });
    if (r.events.length > 200) r.events = r.events.slice(-200);
}

/**
 * The live board's snapshot. Saved at most every 1.5 s while a stage runs, so
 * the page (polling every few seconds) watches Satej search, read and pick
 * vendors as it happens instead of seeing only the end result.
 */
const lastLiveSave = new Map<string, number>();
async function setLive(r: Requirement, patch: Partial<LiveProgress> & { stage?: LiveProgress['stage'] }, force = false) {
    r.live = { ...(r.live ?? { stage: patch.stage ?? 'structuring', detail: '' }), ...patch, updatedAt: nowIso() } as LiveProgress;
    const last = lastLiveSave.get(r.id) ?? 0;
    if (!force && Date.now() - last < 1500) return;
    lastLiveSave.set(r.id, Date.now());
    await getRepo().saveRequirement(r).catch(() => undefined); // progress is a nicety; never fail a stage over it
}

const hostOf = (url: string) => {
    try { return new URL(url).host.replace(/^www\./, ''); } catch { return url; }
};

// ------------------------------------------------------------------ kill switch

/**
 * Satej's row in the Agent Console registry. 'paused' or 'retired' there stops
 * new work here. A failed read does NOT stop work — it is logged — because the
 * registry is telemetry-grade infrastructure and must not take procurement down.
 */
export async function isSatejPaused(organizationId: string): Promise<boolean> {
    if (satejConfig.mockMode) return false;
    const { data, error } = await supabaseAdmin
        .from('oem_agents')
        .select('status')
        .eq('organization_id', organizationId)
        .eq('agent_key', SATEJ_AGENT_KEY)
        .maybeSingle();
    if (error) {
        console.warn(`[satej] could not read agent status for ${organizationId}: ${error.message}`);
        return false;
    }
    return data?.status === 'paused' || data?.status === 'retired';
}

// ------------------------------------------------------------------ create

export function validateInput(i: Partial<RequirementInput>): string[] {
    const errs: string[] = [];
    if (!i.title?.trim()) errs.push('Title is required');
    if (!i.itemDescription?.trim()) errs.push('Describe what is needed');
    if (!i.locationCity?.trim()) errs.push('City is required');
    if (i.spendType !== 'capex' && i.spendType !== 'opex') errs.push('Type must be CapEx or OpEx');
    if (i.notifyWhatsapp?.trim() && !normaliseIndianPhone(i.notifyWhatsapp)) errs.push('WhatsApp number is not a valid Indian number');
    return errs;
}

export async function createRequirement(organizationId: string, input: RequirementInput, appOrigin: string | null): Promise<Requirement> {
    const repo = getRepo();
    const now = nowIso();
    const notify = normaliseIndianPhone(input.notifyWhatsapp || satejConfig.defaultNotifyNumber) ?? '';
    const r: Requirement = {
        id: newId(),
        organizationId,
        code: newRequirementCode(),
        status: 'submitted',
        input: { ...input, notifyWhatsapp: notify, vendorTarget: input.vendorTarget || satejConfig.vendorTarget },
        appOrigin,
        clarifications: [],
        round: 1,
        events: [],
        createdAt: now,
        updatedAt: now,
    };
    log(r, `Requirement received from ${input.requestedBy || 'the team'}`);
    for (let attempt = 0; ; attempt++) {
        try {
            await repo.createRequirement(r);
            return r;
        } catch (e) {
            if (!(e instanceof DuplicateCodeError) || attempt >= 4) throw e;
            r.code = newRequirementCode(); // four random digits per day; a clash is rare, not impossible
        }
    }
}

// ------------------------------------------------------------------ advance

export async function advance(id: string, opts: { budgetMs?: number; trigger?: Trigger } = {}): Promise<Requirement | null> {
    const repo = getRepo();
    const budgetMs = opts.budgetMs ?? 240_000;
    if (!(await repo.tryLock(id, Math.ceil(budgetMs / 1000) + 60))) return repo.getRequirement(id);
    const started = Date.now();
    try {
        for (let step = 0; step < 12; step++) {
            const r = await repo.getRequirement(id);
            if (!r || WAITING.includes(r.status)) return r;
            if (Date.now() - started > budgetMs) return r;
            const before = r.status;
            try {
                if (TRACED.includes(before) && !satejConfig.mockMode) {
                    await traced(r, before, opts.trigger ?? 'manual');
                } else {
                    await runStage(r, NO_STEP);
                }
            } catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                log(r, `Error while ${before.replace(/_/g, ' ')}: ${message}`);
                r.error = message;
                // Calls cost money and messages reach people, so a failing early stage is parked, not retried forever.
                if (['submitted', 'structured', 'discovering'].includes(before)) r.status = 'failed';
                await repo.saveRequirement(r);
                return r;
            }
            if (r.status !== before && r.status !== 'notified' && r.status !== 'failed') r.error = undefined;
            await repo.saveRequirement(r);
            if (r.status === before) return r; // nothing more to do right now (calls still running, retry later)
        }
        return repo.getRequirement(id);
    } finally {
        await repo.unlock(id);
    }
}

async function traced(r: Requirement, before: RequirementStatus, trigger: Trigger) {
    await withAgentRun(
        { orgId: r.organizationId, agentKey: SATEJ_AGENT_KEY, module: 'vendors', trigger },
        async (step) => {
            const spentBefore = llmSpendUsd();
            await runStage(r, step);
            const spent = llmSpendUsd() - spentBefore;
            return {
                outcome: `${r.code}: ${before.replace(/_/g, ' ')} → ${r.status.replace(/_/g, ' ')}`,
                entityRef: r.code,
                ...(spent > 0 ? { costUsd: Math.round(spent * 1e6) / 1e6 } : {}),
                status: r.status === before ? 'skipped' : 'succeeded',
            };
        },
    );
}

async function runStage(r: Requirement, step: StepFn) {
    switch (r.status) {
        case 'submitted':
            return structure(r, step);
        case 'structured':
        case 'discovering':
            return discover(r, step);
        case 'calling':
            return checkCalls(r);
        case 'calls_done':
        case 'analyzing':
            return analyze(r, step);
        case 'ranked':
            return notify(r, step);
    }
}

// ------------------------------------------------------------------ 1. structure

/** What the LLM sees of the form: no phone number, no user id, no budget — none of it shapes a brief. */
function formForLlm(i: RequirementInput) {
    return {
        title: i.title,
        spendType: i.spendType,
        itemDescription: i.itemDescription,
        quantity: i.quantity,
        unit: i.unit,
        scope: i.scope,
        locationCity: i.locationCity,
        locationArea: i.locationArea,
        siteName: i.siteName,
        timeline: i.timeline,
        notes: i.notes,
    };
}

const strings = (x: unknown): string[] => (Array.isArray(x) ? x.map(String).map((s) => s.trim()).filter(Boolean) : []);

async function structure(r: Requirement, step: StepFn) {
    await setLive(r, { stage: 'structuring', detail: 'Reading your requirement and writing the brief' }, true);
    const s = await step('Structuring the requirement into a brief', 'llm');
    const raw = await chatJSON<StructuredBrief>({
        task: 'structure',
        system: STRUCTURER_SYSTEM,
        user: structurerUser(formForLlm(r.input), r.clarifications),
        model: 'smart',
    });
    const brief: StructuredBrief = {
        ...raw,
        specs: strings(raw.specs),
        vendorTypes: strings(raw.vendorTypes),
        mustHave: strings(raw.mustHave),
        questions: strings(raw.questions).slice(0, 3),
        searchQueries: strings(raw.searchQueries).slice(0, 7),
        timelineDays: typeof raw.timelineDays === 'number' && Number.isFinite(raw.timelineDays) ? raw.timelineDays : null,
        locationCity: String(raw.locationCity || r.input.locationCity),
        locationArea: String(raw.locationArea || r.input.locationArea || ''),
    };
    r.brief = brief;
    r.live = null;
    await s.ok({ detail: { questions: brief.questions.length, queries: brief.searchQueries.length } });

    if (brief.questions.length) {
        r.status = 'needs_clarification';
        log(r, `Satej asked ${brief.questions.length} question(s) before searching`);
        await tellTeam(r, step, satejConfig.waInputTemplate, inputNeededTemplateParams(r, questionsAsk(r)), 'questions');
        return;
    }
    if (!brief.searchQueries.length) throw new Error('The brief came back with no search queries');
    r.status = 'structured';
    log(r, `Brief ready: ${brief.itemSummary}, ${brief.quantityText}, ${brief.locationText}`);
}

export async function answerClarification(r: Requirement, answers: string[]): Promise<void> {
    if (r.status !== 'needs_clarification') throw new Error(`This requirement is ${r.status.replace(/_/g, ' ')}, not waiting for answers`);
    const qs = r.brief?.questions ?? [];
    if (answers.length === 1 && qs.length > 1) {
        r.clarifications.push({ question: qs.join(' / '), answer: answers[0] });
    } else {
        qs.forEach((q, i) => r.clarifications.push({ question: q, answer: answers[i] ?? '' }));
    }
    r.status = 'submitted';
    log(r, 'Team answered the questions');
    await getRepo().saveRequirement(r);
}

// ------------------------------------------------------------------ 2. discover vendors

interface Candidate {
    name: string;
    phone: string;
    phoneRaw: string;
    address: string;
    area: string;
    city: string;
    website: string;
    sells: string;
    years: number | null;
    relevance: number;
    urls: Set<string>;
}

interface PageVendor {
    name?: unknown;
    phones?: unknown;
    address?: unknown;
    area?: unknown;
    city?: unknown;
    website?: unknown;
    sells?: unknown;
    yearsInBusiness?: unknown;
    relevance?: unknown;
    _url: string;
}

function sameCity(a: string, b: string): boolean {
    const x = a.toLowerCase().trim();
    const y = b.toLowerCase().trim();
    if (!x || !y) return true; // no city on the page: keep, the call will confirm
    const alias: Record<string, string> = { bombay: 'mumbai', bangalore: 'bengaluru', gurgaon: 'gurugram', calcutta: 'kolkata' };
    const nx = alias[x] ?? x;
    const ny = alias[y] ?? y;
    return nx.includes(ny) || ny.includes(nx);
}

function roundQueries(b: StructuredBrief, round: number): string[] {
    if (round <= 1) return b.searchQueries;
    // Wider search for later rounds: nearby areas and directories.
    const extra = b.vendorTypes.flatMap((t) => [
        `${t} near ${b.locationArea} ${b.locationCity}`,
        `${t} ${b.locationCity} indiamart`,
        `best ${t} in ${b.locationCity} sulekha`,
    ]);
    return [...b.searchQueries, ...extra].slice(0, 10);
}

async function discover(r: Requirement, step: StepFn) {
    const repo = getRepo();
    const b = r.brief!;
    if (r.status !== 'discovering') {
        r.status = 'discovering';
        await repo.saveRequirement(r);
    }

    const queries = roundQueries(b, r.round);
    const s1 = await step(`Searching the web for vendors (${queries.length} queries)`, 'tool', { queries });
    const liveQueries = queries.map((text) => ({ text, done: false, pages: 0 }));
    await setLive(r, { stage: 'searching', detail: `Searching the web: ${queries.length} queries`, queries: liveQueries, spotted: [], pagesRead: 0, pagesTotal: 0 }, true);
    const searchErrors: string[] = [];
    const pageLists = await mapLimit(queries, 3, async (q, i) => {
        const found = await exaSearch(q).catch((e: unknown) => {
            searchErrors.push(e instanceof Error ? e.message : String(e));
            return [] as ExaPage[];
        });
        liveQueries[i] = { text: q, done: true, pages: found.length };
        await setLive(r, { queries: [...liveQueries] });
        return found;
    });
    const seen = new Set<string>();
    // At most MAX_PAGES are read: each is one model call, and the whole stage has to fit in one function run.
    const pages = pageLists.flat().filter((p) => p.url && p.text && !seen.has(p.url) && seen.add(p.url)).slice(0, MAX_PAGES);
    if (!pages.length && searchErrors.length === queries.length) {
        await s1.fail(new Error(searchErrors[0]));
        throw new Error(`Web search failed for every query: ${searchErrors[0]}`);
    }
    await s1.ok({ detail: { pages: pages.length, failedQueries: searchErrors.length } });
    log(r, `Searched ${queries.length} queries, read ${pages.length} pages${searchErrors.length ? ` (${searchErrors.length} searches failed)` : ''}`);

    const briefLine = `${b.itemSummary}. Quantity: ${b.quantityText}. Scope: ${b.scopeType}. Location: ${b.locationText}. Vendor types: ${b.vendorTypes.join(', ')}.`;
    const s2 = await step(`Reading ${pages.length} pages for vendor details`, 'llm');
    const readErrors: string[] = [];
    const spotted: NonNullable<LiveProgress['spotted']> = [];
    let pagesRead = 0;
    await setLive(r, { stage: 'reading', detail: `Reading ${pages.length} pages for vendors`, pagesRead: 0, pagesTotal: pages.length }, true);
    const extracted = await mapLimit(pages, 6, async (page) => {
        try {
            const out = await chatJSON<{ vendors?: Omit<PageVendor, '_url'>[] }>({
                task: 'discover',
                system: DISCOVERY_SYSTEM,
                user: discoveryUser(briefLine, page),
                model: 'fast',
            });
            const list = (Array.isArray(out.vendors) ? out.vendors : []).map((v): PageVendor => ({ ...v, _url: page.url }));
            for (const v of list) {
                if (Number(v.relevance ?? 0) >= 6 && v.name) {
                    spotted.push({ name: String(v.name), area: String(v.area || v.city || ''), source: hostOf(page.url), relevance: Number(v.relevance) });
                }
            }
            return list;
        } catch (e) {
            readErrors.push(e instanceof Error ? e.message : String(e));
            return [] as PageVendor[];
        } finally {
            pagesRead++;
            await setLive(r, { pagesRead, spotted: spotted.slice(-60), detail: `Read ${pagesRead} of ${pages.length} pages · ${spotted.length} possible vendors spotted` });
        }
    });
    if (pages.length && readErrors.length === pages.length) {
        await s2.fail(new Error(readErrors[0]));
        throw new Error(`Could not read any of the ${pages.length} pages: ${readErrors[0]}`);
    }
    await s2.ok({ detail: { vendorsOnPages: extracted.flat().length, unreadPages: readErrors.length } });

    await setLive(r, { stage: 'choosing', detail: 'Removing duplicates, checking cities and phone numbers, skipping recent calls' }, true);
    const s3 = await step('Filtering, de-duplicating and choosing vendors to call', 'decide');
    const byPhone = new Map<string, Candidate>();
    const byName = new Map<string, Candidate>();
    for (const v of extracted.flat()) {
        const relevance = Number(v.relevance ?? 0);
        if (relevance < 6 || !v.name) continue;
        if (!sameCity(String(v.city ?? ''), b.locationCity)) continue;
        const phones = Array.isArray(v.phones) ? v.phones.map(String) : [];
        const phone = phones.map((p) => normaliseIndianPhone(p)).find(Boolean);
        if (!phone) continue;
        const years = typeof v.yearsInBusiness === 'number' ? v.yearsInBusiness : null;
        const key = normName(String(v.name));
        const existing = byPhone.get(phone) ?? byName.get(key);
        if (existing) {
            existing.urls.add(v._url);
            existing.relevance = Math.max(existing.relevance, relevance);
            existing.website ||= String(v.website ?? '');
            existing.years ??= years;
            existing.area ||= String(v.area ?? '');
            continue;
        }
        const c: Candidate = {
            name: String(v.name).trim(),
            phone,
            phoneRaw: phones[0] ?? '',
            address: String(v.address ?? ''),
            area: String(v.area ?? ''),
            city: String(v.city || b.locationCity),
            website: String(v.website ?? ''),
            sells: String(v.sells ?? ''),
            years,
            relevance,
            urls: new Set([v._url]),
        };
        byPhone.set(phone, c);
        byName.set(key, c);
    }

    let candidates = [...byPhone.values()];
    const blocked = new Set(satejConfig.blockedNumbers.map((n) => normaliseIndianPhone(n)).filter(Boolean) as string[]);
    const recent = await repo.recentlyCalledPhones(r.organizationId, candidates.map((c) => c.phone), satejConfig.doNotRecallDays);
    const skipped = candidates.filter((c) => blocked.has(c.phone) || recent.has(c.phone));
    candidates = candidates.filter((c) => !blocked.has(c.phone) && !recent.has(c.phone));

    const areaLc = b.locationArea.toLowerCase();
    candidates.sort(
        (x, y) =>
            y.relevance - x.relevance
            || Number(!!y.area && !!areaLc && y.area.toLowerCase().includes(areaLc)) - Number(!!x.area && !!areaLc && x.area.toLowerCase().includes(areaLc))
            || Number(!!y.website) - Number(!!x.website)
            || (y.years ?? 0) - (x.years ?? 0),
    );
    const chosen = candidates.slice(0, r.input.vendorTarget || satejConfig.vendorTarget);

    const now = nowIso();
    const toVendor = (c: Candidate, status: Vendor['status'], excludeReason?: string): Vendor => ({
        id: newId(),
        organizationId: r.organizationId,
        requirementId: r.id,
        name: c.name,
        phone: c.phone,
        phoneRaw: c.phoneRaw,
        address: c.address,
        area: c.area,
        city: c.city,
        website: c.website,
        sells: c.sells,
        webYearsInBusiness: c.years,
        relevance: c.relevance,
        sourceUrls: [...c.urls],
        status,
        excludeReason,
        createdAt: now,
    });
    await repo.saveVendors([
        ...chosen.map((c) => toVendor(c, 'found')),
        ...skipped.map((c) => toVendor(c, 'excluded', blocked.has(c.phone) ? 'Blocked number' : `Called in the last ${satejConfig.doNotRecallDays} days`)),
    ]);
    await s3.ok({ detail: { chosen: chosen.length, skipped: skipped.length } });
    r.live = null;
    log(r, `Found ${chosen.length} vendors to call${skipped.length ? `, skipped ${skipped.length} (blocked or called recently)` : ''}`);

    if (!chosen.length) {
        r.status = 'failed';
        r.error = 'No callable vendors found. Use "Find more vendors" for a wider search.';
        await tellTeam(r, step, satejConfig.waSummaryTemplate, noVendorsTemplateParams(r), 'no-vendors notice');
        return;
    }
    if (!satejConfig.autoStartCalls) {
        r.status = 'awaiting_call_approval';
        log(r, 'Waiting for the team to approve the call list');
        await tellTeam(
            r,
            step,
            satejConfig.waInputTemplate,
            inputNeededTemplateParams(r, `${chosen.length} vendors are ready to call. Please check the list and approve the calls.`),
            'approval request',
        );
        return;
    }
    await startCalls(r, step);
}

// ------------------------------------------------------------------ 3. calls via Bolna

const SCOPE_TEXT: Record<StructuredBrief['scopeType'], string> = {
    supply_only: 'supply only',
    supply_and_install: 'supply and installation',
    service: 'service work',
    amc: 'annual maintenance contract',
    works_contract: 'complete works contract',
};

/** "Shree Ganesh Interiors Pvt. Ltd." is spoken as "Shree Ganesh Interiors" — nobody says the suffix on a call. */
export function spokenName(name: string): string {
    const cut = name
        .replace(/\s*\((?:p|i)\)\s*/gi, ' ')
        .replace(/[\s,.-]+(?:pvt\.?|private|ltd\.?|limited|llp|inc\.?|co\.?)(?=[\s,.]|$)/gi, '')
        .replace(/[\s,.-]+$/, '')
        .trim();
    return cut || name;
}

/** One CSV row per vendor. Column names are CALL_VARIABLES — Meera's prompt uses exactly these. */
export function buildCallCsv(r: Requirement, vendors: Vendor[]): string {
    const b = r.brief!;
    const rows = vendors.map((v): Record<(typeof CALL_VARIABLES)[number], string> => ({
        contact_number: v.phone,
        vendor_name: spokenName(v.name),
        vendor_ref: v.id,
        requirement_code: r.code,
        item_category: b.itemCategory,
        item_summary: b.itemSummary,
        quantity_text: b.quantityText,
        scope_text: SCOPE_TEXT[b.scopeType] ?? b.scopeType,
        location_text: b.locationText,
        spend_type_text: r.input.spendType === 'capex' ? 'a one-time project' : 'a recurring requirement',
        timeline_text: b.timelineText || 'as early as possible',
    }));
    return toCsv(rows, [...CALL_VARIABLES]);
}

/**
 * Batch-level webhook (posted once, when the batch ends). The per-call webhook
 * is set on the Bolna agent itself — scripts/satej-sync-bolna.ts. Null when no
 * public https origin is known: Bolna cannot reach localhost, and the 5-minute
 * sync in checkCalls covers the gap.
 */
function batchWebhookUrl(r: Requirement): string | null {
    const origin = r.appOrigin || satejConfig.publicBaseUrl;
    if (!origin?.startsWith('https://') || !satejConfig.webhookToken) return null;
    return `${origin}/api/satej/bolna?token=${encodeURIComponent(satejConfig.webhookToken)}`;
}

async function startCalls(r: Requirement, step: StepFn) {
    const repo = getRepo();
    if (!satejConfig.mockMode && !satejConfig.bolnaAgentId) throw new Error('SATEJ_BOLNA_AGENT_ID is not set, so there is no voice agent to call with');
    const vendors = (await repo.listVendors(r.id)).filter((v) => v.status === 'found');
    if (!vendors.length) throw new Error('No vendors to call');
    const s = await step(`Scheduling ${vendors.length} calls on Bolna`, 'tool');
    const batchId = await createBatch(buildCallCsv(r, vendors), batchWebhookUrl(r));
    const at = nextCallSlot(new Date(), satejConfig.callWindowStart, satejConfig.callWindowEnd, satejConfig.callDays);
    await scheduleBatch(batchId, at);
    for (const v of vendors) v.status = 'queued';
    await repo.saveVendors(vendors);
    r.bolnaBatchId = batchId;
    r.callsScheduledAt = at.toISOString();
    r.status = 'calling';
    await s.ok({ detail: { batchId, vendors: vendors.length, scheduledAt: r.callsScheduledAt } });
    log(r, `Bolna batch ${batchId} scheduled for ${vendors.length} vendors`);
}

export async function approveCalls(r: Requirement, approvedBy: string): Promise<void> {
    if (r.status !== 'awaiting_call_approval') throw new Error(`This requirement is ${r.status.replace(/_/g, ' ')}, not waiting for approval`);
    log(r, `${approvedBy || 'The team'} approved the call list`);
    if (satejConfig.mockMode) {
        await startCalls(r, NO_STEP);
    } else {
        await withAgentRun(
            { orgId: r.organizationId, agentKey: SATEJ_AGENT_KEY, module: 'vendors', trigger: 'manual' },
            async (step) => {
                await startCalls(r, step);
                return { outcome: `${r.code}: calls approved and scheduled`, entityRef: r.code };
            },
        );
    }
    r.error = undefined;
    await getRepo().saveRequirement(r);
}

/** Only the parts of a Bolna execution Satej reads. */
interface BolnaExecution {
    id?: unknown;
    execution_id?: unknown;
    agent_id?: unknown;
    batch_id?: unknown;
    status?: unknown;
    transcript?: unknown;
    summary?: unknown;
    extracted_data?: unknown;
    conversation_duration?: unknown;
    created_at?: unknown;
    user_number?: unknown;
    context_details?: { recipient_data?: Record<string, unknown> } & Record<string, unknown>;
    telephony_data?: { to_number?: unknown; recording_url?: unknown; duration?: unknown };
    batch_run_details?: { retried?: unknown };
}

/** Stores one Bolna execution (webhook or sync). Returns the requirement it belongs to, or null if it is not Satej's. */
export async function ingestExecution(ex: BolnaExecution): Promise<Requirement | null> {
    const repo = getRepo();
    const execId = String(ex?.id ?? ex?.execution_id ?? '');
    if (!execId) return null;
    // Another agent on the same Bolna account (Ira, Radhika) is none of Satej's business.
    if (satejConfig.bolnaAgentId && ex.agent_id && String(ex.agent_id) !== satejConfig.bolnaAgentId) return null;
    const recipient = (ex.context_details?.recipient_data ?? {}) as Record<string, unknown>;

    let r: Requirement | null = null;
    if (ex.batch_id) r = await repo.getRequirementByBatch(String(ex.batch_id));
    if (!r && recipient.requirement_code) r = await repo.getRequirementByCode(String(recipient.requirement_code));
    if (!r) return null;

    const toNumber = normaliseIndianPhone(String(ex.telephony_data?.to_number ?? recipient.contact_number ?? ex.user_number ?? '')) ?? '';
    const vendors = await repo.listVendors(r.id);
    const vendor = vendors.find((v) => v.id === recipient.vendor_ref) ?? vendors.find((v) => v.phone === toNumber && v.status !== 'excluded');

    const prev = await repo.getCallByExecution(execId);
    const now = nowIso();
    const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
    const call: CallRecord = {
        id: prev?.id ?? newId(),
        organizationId: r.organizationId,
        requirementId: r.id,
        vendorId: vendor?.id ?? prev?.vendorId ?? null,
        executionId: execId,
        toNumber: toNumber || prev?.toNumber || '',
        status: String(ex.status ?? prev?.status ?? 'unknown'),
        durationSec: num(ex.conversation_duration) ?? num(ex.telephony_data?.duration) ?? prev?.durationSec ?? null,
        transcript: String(ex.transcript || prev?.transcript || ''),
        bolnaSummary: String(ex.summary || prev?.bolnaSummary || ''),
        extracted: (ex.extracted_data as Record<string, unknown> | null) ?? prev?.extracted ?? null,
        recordingUrl: String(ex.telephony_data?.recording_url || prev?.recordingUrl || ''),
        retried: Number(ex.batch_run_details?.retried ?? prev?.retried ?? 0),
        analysis: prev?.analysis,
        score: prev?.score,
        analysisAttempts: prev?.analysisAttempts,
        analysisError: prev?.analysisError,
        createdAt: prev?.createdAt ?? (typeof ex.created_at === 'string' ? ex.created_at : now),
        updatedAt: now,
    };
    await repo.saveCall(call);

    if (vendor && isFinal(call.status)) {
        const reached = call.status === 'completed' && call.transcript.length > 80;
        if (reached) vendor.status = 'called';
        else if (vendor.status !== 'called') vendor.status = 'not_reached';
        await repo.saveVendor(vendor);
    }
    return r;
}

async function callsFinished(r: Requirement): Promise<boolean> {
    const repo = getRepo();
    const [vendors, calls] = await Promise.all([repo.listVendors(r.id), repo.listCalls(r.id)]);
    const inBatch = vendors.filter((v) => ['queued', 'called', 'not_reached'].includes(v.status));
    const anyLive = calls.some((c) => !isFinal(c.status));
    if (inBatch.length > 0 && inBatch.every((v) => v.status === 'called') && !anyLive) return true;

    // Every vendor has a final result and nothing changed for a while: retries are over.
    const everyoneFinal = inBatch.length > 0 && inBatch.every((v) => v.status === 'called' || v.status === 'not_reached');
    const lastUpdate = Math.max(0, ...calls.map((c) => new Date(c.updatedAt).getTime()));
    if (everyoneFinal && !anyLive && Date.now() - lastUpdate >= satejConfig.retryIdleMinutes * 60_000) return true;

    // Otherwise trust Bolna's batch status (it knows about pending retries).
    if (r.bolnaBatchId) {
        const batch = await getBatch(r.bolnaBatchId).catch(() => null);
        const status = (batch?.status ?? '').toLowerCase();
        const scheduled = r.callsScheduledAt ? new Date(r.callsScheduledAt).getTime() : 0;
        const hadTime = calls.length > 0 || Date.now() - scheduled > 15 * 60_000;
        if (['completed', 'stopped', 'failed'].includes(status) && !anyLive && hadTime) return true;
    }
    return false;
}

async function checkCalls(r: Requirement) {
    // Safety net: pull executions from Bolna in case a webhook was missed (at most every 5 minutes).
    const scheduled = r.callsScheduledAt ? new Date(r.callsScheduledAt).getTime() : Date.now();
    const lastSync = r.lastSyncAt ? new Date(r.lastSyncAt).getTime() : 0;
    if (r.bolnaBatchId && Date.now() > scheduled && Date.now() - lastSync > 5 * 60_000) {
        try {
            const execs = await listBatchExecutions(r.bolnaBatchId);
            for (const ex of execs) await ingestExecution({ ...ex, batch_id: ex.batch_id ?? r.bolnaBatchId } as BolnaExecution);
        } catch (e) {
            log(r, `Could not sync calls from Bolna, will retry: ${e instanceof Error ? e.message : e}`);
        }
        r.lastSyncAt = nowIso();
    }
    const timedOut = Date.now() - scheduled > satejConfig.callBatchTimeoutHours * 3600_000;
    if ((await callsFinished(r)) || timedOut) {
        r.status = 'calls_done';
        r.callsCompletedAt = nowIso();
        log(r, timedOut ? 'Call window timed out, moving on with the calls that finished' : 'All calls finished');
    }
}

// ------------------------------------------------------------------ 4. analyse and rank

function sanitiseAnalysis(a: CallAnalysis): CallAnalysis {
    const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
    const tri = (x: unknown) => (x === 'yes' || x === 'no' ? x : 'unknown');
    const list = (x: unknown) => (Array.isArray(x) ? x.map(String) : []);
    return {
        reachedRightPerson: a.reachedRightPerson !== false,
        contactPerson: String(a.contactPerson ?? ''),
        gstRegistered: tri(a.gstRegistered),
        gstin: String(a.gstin ?? ''),
        yearsExperience: num(a.yearsExperience),
        annualTurnoverText: String(a.annualTurnoverText ?? ''),
        annualTurnoverLakhs: num(a.annualTurnoverLakhs),
        hasWebsite: tri(a.hasWebsite),
        websiteUrl: String(a.websiteUrl ?? ''),
        hasCompanyProfile: tri(a.hasCompanyProfile),
        turnaroundDays: num(a.turnaroundDays),
        turnaroundText: String(a.turnaroundText ?? ''),
        specialisations: list(a.specialisations),
        specialisationMatch: ['exact', 'strong', 'partial', 'weak'].includes(a.specialisationMatch) ? a.specialisationMatch : 'weak',
        clients: Array.isArray(a.clients)
            ? a.clients.filter((c) => c?.name).map((c) => ({ name: String(c.name), sector: String(c.sector ?? '') }))
            : [],
        referencesOffered: a.referencesOffered === true,
        testimonialsText: String(a.testimonialsText ?? ''),
        usps: list(a.usps),
        authenticityScore: num(a.authenticityScore) ?? 0,
        authenticityReasons: list(a.authenticityReasons),
        redFlags: list(a.redFlags),
        summary: String(a.summary ?? ''),
        evidence: Array.isArray(a.evidence) ? a.evidence.map((e) => ({ field: String(e?.field ?? ''), quote: String(e?.quote ?? '') })) : [],
    };
}

async function analyze(r: Requirement, step: StepFn) {
    const repo = getRepo();
    if (r.status !== 'analyzing') {
        r.status = 'analyzing';
        await repo.saveRequirement(r);
    }
    const b = r.brief!;
    const [vendors, calls] = await Promise.all([repo.listVendors(r.id), repo.listCalls(r.id)]);
    const reqLine = `${b.itemSummary}. Quantity: ${b.quantityText}. Scope: ${b.scopeType}. Location: ${b.locationText}. Timeline: ${b.timelineText || 'not set'}. Spend: ${r.input.spendType}.`;

    const todo = calls.filter((c) => isFinal(c.status) && !c.score);
    const s = await step(`Analysing ${todo.length} call transcript(s)`, 'llm');
    let failed = 0;
    let analysed = 0;
    await setLive(r, { stage: 'analysing', detail: `Analysing ${todo.length} call(s)` }, true);
    await mapLimit(todo, 3, async (c) => {
        const v = vendors.find((x) => x.id === c.vendorId);
        const spoke = c.status === 'completed' && c.transcript.length >= 150;
        if (spoke) {
            try {
                c.analysis = sanitiseAnalysis(
                    await chatJSON<CallAnalysis>({
                        task: 'analyze',
                        system: CALL_ANALYST_SYSTEM,
                        user: callAnalystUser({
                            requirement: reqLine,
                            vendor: {
                                name: v?.name ?? '',
                                area: v?.area ?? '',
                                city: v?.city ?? '',
                                website: v?.website ?? '',
                                sells: v?.sells ?? '',
                                webYearsInBusiness: v?.webYearsInBusiness ?? null,
                            },
                            bolnaExtracted: c.extracted,
                            transcript: c.transcript,
                        }),
                        model: 'smart',
                    }),
                );
                c.score = scoreCall(c.analysis, b, v);
                c.analysisError = undefined;
            } catch (e) {
                failed++;
                c.analysisAttempts = (c.analysisAttempts ?? 0) + 1;
                c.analysisError = e instanceof Error ? e.message : String(e);
                if (c.analysisAttempts >= MAX_ANALYSIS_ATTEMPTS) {
                    // Ranked, but flagged: GST status is genuinely unknown, and the summary says to listen to the call.
                    c.score = { total: 0, qualification: 'verify_gst', parts: [] };
                    log(r, `Gave up analysing the call to ${v?.name ?? c.toNumber} after ${c.analysisAttempts} attempts; listen to the recording`);
                } else {
                    log(r, `Could not analyse the call to ${v?.name ?? c.toNumber} (attempt ${c.analysisAttempts}), will retry`);
                }
            }
        } else {
            c.score = { total: 0, qualification: 'not_reached', parts: [] };
        }
        await repo.saveCall(c);
        analysed++;
        await setLive(r, { detail: `Analysed ${analysed} of ${todo.length} call(s)` });
    });
    await s.ok({ detail: { analysed: todo.length - failed, failed } });

    const fresh = await repo.listCalls(r.id);
    if (fresh.some((c) => isFinal(c.status) && !c.score)) return; // retried on the next pass

    const s2 = await step('Ranking vendors with the fixed rulebook', 'decide');
    r.ranking = rankVendors(fresh, await repo.listVendors(r.id));
    r.status = 'ranked';
    r.live = null;
    const qualified = r.ranking.filter((x) => x.score.qualification === 'qualified').length;
    await s2.ok({ detail: { ranked: r.ranking.length, qualified } });
    log(r, `Ranked ${r.ranking.length} vendors, ${qualified} qualified`);
}

// ------------------------------------------------------------------ 5. tell the purchase team

/** Best-effort WhatsApp; the Satej page is the record either way. */
async function tellTeam(r: Requirement, step: StepFn, template: string, params: string[], what: string): Promise<boolean> {
    if (!r.input.notifyWhatsapp) return false;
    const s = await step(`WhatsApp ${what} to the purchase team`, 'notify');
    const res = await sendTemplate(r.input.notifyWhatsapp, template, params);
    if (res.ok) {
        await s.ok({ detail: { template } });
        log(r, `WhatsApp ${what} sent to ${r.input.notifyWhatsapp}`);
    } else {
        await s.fail(new Error(res.error ?? 'send failed'));
        log(r, `WhatsApp ${what} could not be sent: ${res.error}`);
    }
    return res.ok;
}

async function notify(r: Requirement, step: StepFn) {
    if (!r.input.notifyWhatsapp) {
        r.status = 'notified';
        r.notifiedAt = nowIso();
        log(r, 'No WhatsApp number on this requirement; the ranked summary is on the Satej page');
        return;
    }
    r.notifyAttempts = (r.notifyAttempts ?? 0) + 1;
    if (await tellTeam(r, step, satejConfig.waSummaryTemplate, summaryTemplateParams(r), 'summary')) {
        r.status = 'notified';
        r.notifiedAt = nowIso();
        r.error = undefined;
        return;
    }
    if (r.notifyAttempts >= 3) {
        r.status = 'notified';
        r.error = 'WhatsApp delivery failed 3 times. The ranked summary is on this page.';
    }
}

// ------------------------------------------------------------------ team actions

/** Before calls go out an edit re-plans from scratch; after, it starts a new round. */
const PRE_CALL: RequirementStatus[] = ['submitted', 'needs_clarification', 'structured', 'discovering', 'awaiting_call_approval', 'failed'];
const EDITABLE_FIELDS = ['title', 'itemDescription', 'quantity', 'unit', 'scope', 'locationCity', 'locationArea', 'siteName', 'timeline', 'budgetHint', 'notes', 'vendorTarget', 'spendType', 'notifyWhatsapp'] as const;
type EditableField = (typeof EDITABLE_FIELDS)[number];

export async function editRequirement(r: Requirement, changes: Partial<Record<EditableField, unknown>>, by: string): Promise<{ newRound: boolean; changed: string[] }> {
    if (r.status === 'cancelled') throw new Error('This requirement is cancelled');
    const repo = getRepo();
    if (!(await repo.tryLock(r.id, 120))) {
        throw new Error('Satej is in the middle of a step on this requirement. Try again in a minute.');
    }
    try {
        const fresh = (await repo.getRequirement(r.id))!;
        const changed: string[] = [];
        const input = { ...fresh.input } as Record<string, unknown>;
        for (const key of EDITABLE_FIELDS) {
            if (!(key in changes)) continue;
            let next: unknown = changes[key];
            if (key === 'vendorTarget') {
                const n = Number(next);
                next = Number.isFinite(n) ? Math.min(40, Math.max(3, Math.round(n))) : input.vendorTarget;
            } else if (key === 'spendType') {
                next = next === 'capex' ? 'capex' : 'opex';
            } else if (key === 'notifyWhatsapp') {
                const raw = String(next ?? '').trim();
                const norm = raw ? normaliseIndianPhone(raw) : '';
                if (raw && !norm) throw new Error('WhatsApp number is not a valid Indian number');
                next = norm;
            } else {
                next = String(next ?? '').trim();
            }
            if (String(input[key] ?? '') === String(next ?? '')) continue;
            changed.push(`${key}: "${String(input[key] ?? '') || '—'}" → "${String(next ?? '') || '—'}"`);
            input[key] = next;
        }
        if (!changed.length) throw new Error('Nothing was changed');
        const errs = validateInput(input as Partial<RequirementInput>);
        if (errs.length) throw new Error(errs.join('; '));
        fresh.input = input as unknown as RequirementInput;

        const newRound = !PRE_CALL.includes(fresh.status);
        if (newRound) {
            fresh.round = (fresh.round ?? 1) + 1;
            fresh.bolnaBatchId = undefined;
            fresh.callsScheduledAt = undefined;
            fresh.callsCompletedAt = undefined;
            fresh.lastSyncAt = undefined;
        } else {
            // Vendors found for the old version were never called; they describe the wrong job.
            await repo.deleteVendors(fresh.id, ['found']);
        }
        fresh.brief = undefined;
        fresh.live = null;
        fresh.error = undefined;
        fresh.status = 'submitted';
        log(fresh, `${by} edited the requirement (${changed.join('; ')}). `
            + (newRound
                ? `Calls already made stand; round ${fresh.round} searches again with the new details and skips vendors already called.`
                : 'Satej is re-planning from the start.'));
        await repo.saveRequirement(fresh);
        Object.assign(r, fresh);
        return { newRound, changed };
    } finally {
        await repo.unlock(r.id);
    }
}

/** Take a vendor off the call list before the calls are approved. */
export async function excludeVendor(r: Requirement, vendorId: string, by: string): Promise<string> {
    if (r.status !== 'awaiting_call_approval') throw new Error('Vendors can only be removed while the call list is waiting for approval');
    const repo = getRepo();
    const v = (await repo.listVendors(r.id)).find((x) => x.id === vendorId);
    if (!v) throw new Error('Vendor not found on this requirement');
    if (v.status !== 'found') throw new Error(`${v.name} is not on the call list`);
    v.status = 'excluded';
    v.excludeReason = `Removed by ${by}`;
    await repo.saveVendor(v);
    log(r, `${by} removed ${v.name} from the call list`);
    await repo.saveRequirement(r);
    return v.name;
}

export async function resendSummary(r: Requirement) {
    if (!r.ranking) throw new Error('There is no ranking yet');
    r.status = 'ranked';
    r.notifyAttempts = 0;
    log(r, 'Resend of the WhatsApp summary requested');
    await getRepo().saveRequirement(r);
}

export async function reanalyze(r: Requirement) {
    const repo = getRepo();
    for (const c of await repo.listCalls(r.id)) {
        delete c.analysis;
        delete c.score;
        delete c.analysisAttempts;
        delete c.analysisError;
        await repo.saveCall(c);
    }
    r.status = 'calls_done';
    log(r, 'Re-analysis requested');
    await repo.saveRequirement(r);
}

/** A wider next round with new vendors. Vendors already called are skipped automatically. */
export async function runAgain(r: Requirement) {
    if (!r.brief) throw new Error('This requirement has no brief yet');
    r.round = (r.round ?? 1) + 1;
    r.status = 'structured';
    r.bolnaBatchId = undefined;
    r.callsScheduledAt = undefined;
    r.callsCompletedAt = undefined;
    r.lastSyncAt = undefined;
    r.error = undefined;
    log(r, `Round ${r.round} started with a wider search`);
    await getRepo().saveRequirement(r);
}

/** Puts a failed requirement back where it broke. */
export async function retryFailed(r: Requirement) {
    if (r.status !== 'failed') throw new Error(`This requirement is ${r.status.replace(/_/g, ' ')}, not failed`);
    r.status = r.brief ? 'structured' : 'submitted';
    r.error = undefined;
    log(r, 'Retry requested');
    await getRepo().saveRequirement(r);
}

export async function cancelRequirement(r: Requirement) {
    r.status = 'cancelled';
    log(r, 'Cancelled by the team');
    await getRepo().saveRequirement(r);
}

// ------------------------------------------------------------------ worker tick

/** The cron route calls this every minute. Advances every requirement that has work to do, in every organisation. */
export async function workerTick(budgetMs = 240_000): Promise<{ processed: string[]; paused: string[]; errors: string[] }> {
    const list = await getRepo().listByStatus(WORKER_STATUSES);
    const started = Date.now();
    const processed: string[] = [];
    const paused: string[] = [];
    const errors: string[] = [];
    const pausedByOrg = new Map<string, boolean>();
    for (const r of list) {
        if (Date.now() - started > budgetMs) break;
        if (!pausedByOrg.has(r.organizationId)) pausedByOrg.set(r.organizationId, await isSatejPaused(r.organizationId));
        if (pausedByOrg.get(r.organizationId)) {
            paused.push(r.code);
            continue;
        }
        try {
            await advance(r.id, { budgetMs: 50_000, trigger: 'cron' });
            processed.push(r.code);
        } catch (e) {
            // One bad row must not stop the rest of the queue.
            errors.push(`${r.code}: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    return { processed, paused, errors };
}
