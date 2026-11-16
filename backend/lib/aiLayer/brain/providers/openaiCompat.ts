/**
 * Backup models for the brain: anything that speaks the OpenAI chat-completions format with tools (Engy's GLM / Qwen
 * through the council provider, Groq with the WhatsApp bot's own keys). Used only when Claude cannot answer, or when
 * the Control Center puts one of these first. They are never shown a photo: images are sent to Claude only.
 */
import type { Block, BrainModel, ModelCall, ModelReply, Msg } from '../types';

const TIMEOUT_MS = 30_000;
export const GROQ_PREFIX = 'groq:';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

export interface Endpoint { url: string; apiKey: string; model: string; extra?: Record<string, unknown> }

type ChatMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>; tool_call_id?: string };

export function toChatMessages(system: string, messages: Msg[]): ChatMessage[] {
    const out: ChatMessage[] = [{ role: 'system', content: system }];
    for (const m of messages) {
        if (m.role === 'assistant') {
            const text = m.blocks.filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text').map(b => b.text).join('\n');
            const calls = m.blocks.filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use');
            out.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls.map(c => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) } })) } : {}) });
            continue;
        }
        const parts: string[] = [];
        for (const b of m.blocks) {
            if (b.type === 'tool_result') out.push({ role: 'tool', tool_call_id: b.toolUseId, content: b.text });
            else if (b.type === 'text') parts.push(b.text);
            else if (b.type === 'image') parts.push('(The person sent a photo. You cannot see it. Do not describe it; ask what it shows if you need to know.)');
        }
        if (parts.length) out.push({ role: 'user', content: parts.join('\n') });
    }
    return out;
}

export interface OpenAiCompatDeps {
    /** Where a model id is sent, or an error when its key is missing. */
    endpoint(model: string): Promise<Endpoint>;
    fetchImpl?: typeof fetch;
}

export function openAiCompatBrainModel(deps: OpenAiCompatDeps): BrainModel {
    const doFetch = deps.fetchImpl ?? fetch;
    return {
        async call(req: ModelCall): Promise<ModelReply> {
            const ep = await deps.endpoint(req.model);
            const res = await doFetch(ep.url, {
                method: 'POST',
                headers: { Authorization: `Bearer ${ep.apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: ep.model,
                    max_tokens: req.maxTokens,
                    temperature: 0,
                    messages: toChatMessages(req.system, req.messages),
                    tools: req.tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input } })),
                    tool_choice: 'auto',
                    ...(ep.extra ?? {}),
                }),
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const j = await res.json() as { choices?: Array<{ message?: { content?: unknown; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> }; finish_reason?: string }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
            const msg = j?.choices?.[0]?.message;
            const blocks: Block[] = [];
            if (typeof msg?.content === 'string' && msg.content.trim()) blocks.push({ type: 'text', text: msg.content });
            for (const [i, c] of (msg?.tool_calls ?? []).entries()) {
                if (!c?.function?.name) continue;
                let input: unknown = {};
                // Arguments arrive as a JSON string; a broken one is passed on as empty so the skill's own check answers.
                try { input = JSON.parse(c.function.arguments || '{}'); } catch { input = {}; }
                blocks.push({ type: 'tool_use', id: c.id || `call_${i}`, name: c.function.name, input });
            }
            if (!blocks.length) throw new Error(`the model returned nothing (finish_reason=${j?.choices?.[0]?.finish_reason ?? 'unknown'})`);
            const finish = j?.choices?.[0]?.finish_reason;
            return {
                blocks, raw: null, model: req.model, keySlot: null,
                stopReason: blocks.some(b => b.type === 'tool_use') ? 'tool_use' : finish === 'length' ? 'max_tokens' : 'end_turn',
                usage: { tokensIn: j?.usage?.prompt_tokens ?? 0, tokensOut: j?.usage?.completion_tokens ?? 0, cacheRead: 0, cacheWrite: 0, costUsd: null },
            };
        },
    };
}

/** The live endpoints: Groq with the shared Groq keys (the first that is not resting), everything else through the council provider (Engy). */
export async function liveEndpoint(model: string): Promise<Endpoint> {
    if (model.startsWith(GROQ_PREFIX)) {
        const { groqKeys } = await import('@/backend/lib/llm/providerKeys');
        const [apiKey] = groqKeys();
        if (!apiKey) throw new Error('no Groq key is configured (GROQ_API_KEY, GROQ_API_KEY_2, GROQ_API_KEY_3)');
        const id = model.slice(GROQ_PREFIX.length);
        return { url: GROQ_URL, apiKey, model: id, ...(/gpt-oss/.test(id) ? { extra: { reasoning_effort: 'low' } } : {}) };
    }
    if (model.startsWith('gemini-')) throw new Error('Gemini models cannot run the brain yet (no tool adapter)');
    const { resolveProvider } = await import('@/backend/lib/council/llm');
    const { provider, spec, apiKey } = resolveProvider();
    if (!apiKey) throw new Error('no AI key is configured for the backup models');
    // Engy's models think silently unless told not to, which can use up the whole budget before any answer.
    return { url: `${spec.baseUrl.replace(/\/+$/, '')}/chat/completions`, apiKey, model, ...(provider === 'custom' ? { extra: { reasoning_effort: 'none' } } : {}) };
}
