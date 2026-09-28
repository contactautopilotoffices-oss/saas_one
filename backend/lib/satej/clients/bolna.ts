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
