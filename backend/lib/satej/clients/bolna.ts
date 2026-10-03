/**
 * Bolna — batch calling for Satej, plus the two agent calls the webhook
 * mapping needs. Shapes checked against Bolna's API reference on 2026-09-28:
 *
 *   POST  /batches                     multipart: agent_id, file, webhook_url?, retry_config?, from_phone_numbers[]
 *   POST  /batches/{id}/schedule       multipart: scheduled_at (ISO, numeric offset, ≥ 2 min ahead)
 *   GET   /batches/{id}                → { status: created|scheduled|running|completed|stopped|failed, ... }
 *   GET   /batches/{id}/executions     → bare array of execution objects
 *   GET   /v2/agent/{id}               → agent, incl. webhook_url and agent_prompts.task_1.system_prompt
 *   PATCH /v2/agent/{id}               { agent_config: { webhook_url } }
 *
 * Two different webhooks, easy to confuse:
 *   · the AGENT's webhook_url receives every call's status changes and its final
 *     transcript — this is the one Satej depends on, set via setAgentWebhook();
 *   · a BATCH's webhook_url is posted once, when the whole batch finishes.
 * Both point at /api/satej/bolna, which tells them apart.
 *
 * Ira's lifecycle helpers live in backend/services/bolnaService.ts; that client
 * is JSON-only, and batches need multipart, so Satej keeps this small one.
 */

import { satejConfig } from '../config';
import { mockBolna } from './mocks';

function auth(): Record<string, string> {
    return { Authorization: `Bearer ${satejConfig.bolnaApiKey}` };
}

async function fail(res: Response, what: string): Promise<never> {
    throw new Error(`Bolna ${what} ${res.status}: ${(await res.text()).slice(0, 400)}`);
}

export async function createBatch(csv: string, webhookUrl: string | null): Promise<string> {
    if (satejConfig.mockMode) return mockBolna.createBatch(csv);

    const form = new FormData();
    form.append('agent_id', satejConfig.bolnaAgentId);
    form.append('file', new Blob([csv], { type: 'text/csv' }), 'vendors.csv');
    if (webhookUrl) form.append('webhook_url', webhookUrl);
    form.append('retry_config', satejConfig.bolnaRetryConfig);
    for (const n of satejConfig.bolnaFromNumbers) form.append('from_phone_numbers', n);

    const res = await fetch(`${satejConfig.bolnaBaseUrl}/batches`, { method: 'POST', headers: auth(), body: form });
    if (!res.ok) return fail(res, 'create batch');
    const data = await res.json();
    if (!data.batch_id) throw new Error(`Bolna create batch: no batch_id in ${JSON.stringify(data).slice(0, 200)}`);
    return String(data.batch_id);
}

/** Bolna wants ISO 8601 with a numeric offset (+00:00, not Z). */
export function bolnaTime(d: Date): string {
    return d.toISOString().replace(/\.\d{3}Z$/, '+00:00');
}

export async function scheduleBatch(batchId: string, at: Date): Promise<void> {
    if (satejConfig.mockMode) return;
    const form = new FormData();
    form.append('scheduled_at', bolnaTime(at));
    const res = await fetch(`${satejConfig.bolnaBaseUrl}/batches/${batchId}/schedule`, { method: 'POST', headers: auth(), body: form });
    if (!res.ok) return fail(res, 'schedule');
}

export async function getBatch(batchId: string): Promise<{ status: string }> {
    if (satejConfig.mockMode) return mockBolna.getBatch(batchId);
    const res = await fetch(`${satejConfig.bolnaBaseUrl}/batches/${batchId}`, { headers: auth() });
    if (!res.ok) return fail(res, 'get batch');
    const raw = await res.json();
    return { status: String(raw.status ?? raw.state ?? '') };
}

/** Every call execution of a batch. The safety net for a webhook that never arrived. */
export async function listBatchExecutions(batchId: string): Promise<Record<string, unknown>[]> {
    if (satejConfig.mockMode) return mockBolna.listExecutions(batchId);
    const res = await fetch(`${satejConfig.bolnaBaseUrl}/batches/${batchId}/executions`, { headers: auth() });
    if (!res.ok) return fail(res, 'list executions');
    const data = await res.json();
    return Array.isArray(data) ? data : data.data ?? data.executions ?? [];
}

export interface BolnaAgentSummary {
    id: string;
    name: string;
    webhookUrl: string | null;
    /** Welcome message and system prompt, joined — only used to list the {variables} they reference. */
    promptText: string;
}

/** null when the agent does not exist on this Bolna account. */
export async function getAgent(agentId: string): Promise<BolnaAgentSummary | null> {
    const res = await fetch(`${satejConfig.bolnaBaseUrl}/v2/agent/${encodeURIComponent(agentId)}`, { headers: auth() });
    if (res.status === 404) return null;
    if (!res.ok) return fail(res, 'get agent');
    const a = await res.json();
    const prompts = Object.values((a.agent_prompts ?? {}) as Record<string, { system_prompt?: string }>)
        .map((p) => p?.system_prompt ?? '')
        .join('\n');
    return {
        id: String(a.id ?? agentId),
        name: String(a.agent_name ?? ''),
        webhookUrl: a.webhook_url ? String(a.webhook_url) : null,
        promptText: `${a.agent_welcome_message ?? ''}\n${prompts}`,
    };
}

/** Points the agent's per-call webhook at FMS. Only webhook_url is sent; nothing else on the agent changes. */
export async function setAgentWebhook(agentId: string, url: string): Promise<void> {
    const res = await fetch(`${satejConfig.bolnaBaseUrl}/v2/agent/${encodeURIComponent(agentId)}`, {
        method: 'PATCH',
        headers: { ...auth(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_config: { webhook_url: url } }),
    });
    if (!res.ok) return fail(res, 'update agent webhook');
}

/* ---------------------------------------------------------------------------
 * Caller script: read, publish, and the calls behind it.
 * ------------------------------------------------------------------------- */

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function bolnaJson(method: string, path: string, body?: unknown): Promise<Json> {
    const res = await fetch(`${satejConfig.bolnaBaseUrl}${path}`, {
        method,
        headers: { ...auth(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Bolna ${method} ${path.split('?')[0]} ${res.status}: ${text.slice(0, 300)}`);
    // Bolna transcripts can carry raw control characters; parse leniently.
    return text ? JSON.parse(text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')) : {};
}

export interface VoiceScript {
    agentId: string;
    name: string;
    welcome: string;
    prompt: string;
    voice: string | null;
    voiceModel: string | null;
    llm: string | null;
    updatedAt: string | null;
}

/** What Meera says right now, read from Bolna — not from the repo. */
export async function getVoiceScript(agentId: string): Promise<VoiceScript> {
    const a = await bolnaJson('GET', `/v2/agent/${encodeURIComponent(agentId)}`);
    const tools = a.tasks?.[0]?.tools_config ?? {};
    const synth = tools.multilingual_config?.languages?.hi?.synthesizer ?? tools.synthesizer;
    return {
        agentId,
        name: String(a.agent_name ?? ''),
        welcome: String(a.agent_welcome_message ?? ''),
        prompt: String(a.agent_prompts?.task_1?.system_prompt ?? ''),
        voice: synth?.provider_config?.voice ?? null,
        voiceModel: synth?.provider_config?.model ?? null,
        llm: tools.llm_agent?.llm_config?.model ?? null,
        updatedAt: a.updated_at ?? null,
    };
}

/**
 * Publish a new greeting and prompt to the agent. A full PUT built from the
 * agent as it stands, because the prompt also lives in each language slot of
 * multilingual_config, which PATCH cannot reach — a PATCH would leave the
 * Hindi and English slots speaking the old script. Re-reads to verify.
 */
export async function publishVoiceScript(agentId: string, welcome: string, prompt: string): Promise<void> {
    const a = await bolnaJson('GET', `/v2/agent/${encodeURIComponent(agentId)}`);
    const task = structuredClone(a.tasks[0]);
    const langs = task.tools_config?.multilingual_config?.languages ?? {};
    for (const k of Object.keys(langs)) langs[k].system_prompt = prompt;
    await bolnaJson('PUT', `/v2/agent/${encodeURIComponent(agentId)}`, {
        agent_config: {
            agent_name: a.agent_name,
            agent_welcome_message: welcome,
            webhook_url: a.webhook_url,
            agent_type: a.agent_type,
            tasks: [task],
            ingest_source_config: a.ingest_source_config,
            calling_guardrails: a.calling_guardrails,
            call_summary_enabled: a.call_summary_enabled,
        },
        agent_prompts: { task_1: { system_prompt: prompt } },
    });
    const after = await getVoiceScript(agentId);
    if (after.prompt !== prompt || after.welcome !== welcome) {
        throw new Error('Bolna accepted the update but the agent does not show it. Nothing else was changed; try again.');
    }
}

export interface VoiceCall {
    id: string;
    createdAt: string;
    status: string;
    durationSec: number | null;
    toNumber: string;
    hasRecording: boolean;
    transcript: string;
    variables: Record<string, string>;
}

/** The agent's calls in the last `days`, newest first. Bolna allows a 7-day window per request, so this walks back window by window. */
export async function listVoiceCalls(agentId: string, days = 30, limit = 60): Promise<VoiceCall[]> {
    const out: VoiceCall[] = [];
    const now = Date.now();
    for (let start = 0; start < days && out.length < limit; start += 7) {
        const to = new Date(now - start * 86400_000);
        const from = new Date(now - Math.min(days, start + 7) * 86400_000);
        for (let page = 1; page <= 3; page++) {
            const d = await bolnaJson('GET', `/v2/agent/${encodeURIComponent(agentId)}/executions?from=${from.toISOString()}&to=${to.toISOString()}&page_size=50&page_number=${page}`);
            for (const e of (d.data ?? []) as Json[]) {
                const ctx = (e.context_details?.recipient_data ?? {}) as Record<string, unknown>;
                out.push({
                    id: String(e.id),
                    createdAt: String(e.created_at),
                    status: String(e.status ?? ''),
                    durationSec: typeof e.conversation_duration === 'number' ? e.conversation_duration : null,
                    toNumber: String(e.telephony_data?.to_number ?? ''),
                    hasRecording: !!e.telephony_data?.recording_url,
                    transcript: String(e.transcript ?? ''),
                    variables: Object.fromEntries(Object.entries(ctx).filter(([k]) => k !== 'timezone').map(([k, v]) => [k, String(v)])),
                });
            }
            if (!d.has_more) break;
        }
    }
    const seen = new Set<string>();
    return out.filter((c) => !seen.has(c.id) && seen.add(c.id)).sort((x, y) => y.createdAt.localeCompare(x.createdAt)).slice(0, limit);
}

/** One execution's recording URL, only if it belongs to one of `agentIds`. */
export async function recordingUrlFor(agentIds: string | string[], executionId: string): Promise<string | null> {
    const e = await bolnaJson('GET', `/executions/${encodeURIComponent(executionId)}`);
    if (![agentIds].flat().filter(Boolean).includes(String(e.agent_id ?? ''))) return null;
    return e.telephony_data?.recording_url ?? null;
}

/** One outbound call outside a batch (the team's test call). Returns Bolna's execution id. */
export async function placeCall(agentId: string, to: string, userData: Record<string, string>): Promise<string> {
    if (satejConfig.mockMode) return `mock-call-${Date.now()}`;
    const body: Json = { agent_id: agentId, recipient_phone_number: to, user_data: userData, bypass_call_guardrails: true };
    if (satejConfig.bolnaFromNumbers[0]) body.from_phone_number = satejConfig.bolnaFromNumbers[0];
    const res = await bolnaJson('POST', '/call', body);
    if (!res.execution_id) throw new Error('Bolna did not return a call id');
    return String(res.execution_id);
}

/** One execution, as the webhook would have delivered it. */
export async function getExecutionRaw(executionId: string): Promise<Json> {
    return bolnaJson('GET', `/executions/${encodeURIComponent(executionId)}`);
}
