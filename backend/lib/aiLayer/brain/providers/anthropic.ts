/**
 * Claude, through the official SDK, with the brain's own pool of keys.
 *
 * Owner 2026-11-13: two Claude plans, each with its own monthly API credit, used one after the other. The keys are
 * CLAUDE_API_KEY and CLAUDE_API_KEY_2 (two Console organisations, so they do NOT share a prompt cache: the pool stays
 * on one key and only moves when that key cannot answer). A key is rested when it is rate limited, rejected, or out
 * of credit; an empty balance is reported by Anthropic as a 400 with "credit balance is too low", not as a 429.
 * Keys are never logged, printed or returned.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { Block, BrainModel, ModelCall, ModelReply, Msg } from '../types';
import { costUsd } from './pricing';

export const BRAIN_CLAUDE_KEY_NAMES = ['CLAUDE_API_KEY', 'CLAUDE_API_KEY_2'] as const;
export const ANTHROPIC_PREFIX = 'anthropic:';
const TIMEOUT_MS = 45_000;

export interface KeySlot { slot: number; key: string }

/** The keys that are set, in the order the org chose (default: key 1, then key 2). */
export function brainClaudeKeys(order: readonly number[] = [1, 2], env: Record<string, string | undefined> = process.env): KeySlot[] {
    const seen = new Set<number>();
    const out: KeySlot[] = [];
    for (const slot of [...order, 1, 2]) {
        if (seen.has(slot) || slot < 1 || slot > BRAIN_CLAUDE_KEY_NAMES.length) continue;
        seen.add(slot);
        const key = String(env[BRAIN_CLAUDE_KEY_NAMES[slot - 1]] ?? '').trim();
        if (key) out.push({ slot, key });
    }
    return out;
}

type Rest = { until: number; why: string };
/** slot → resting until. Per server instance: a rested key is simply tried again later. */
const resting = new Map<number, Rest>();
export const _resetKeyPool = () => resting.clear();
export const keyPoolStatus = () => [...resting.entries()].filter(([, r]) => r.until > Date.now()).map(([slot, r]) => ({ slot, why: r.why, minutesLeft: Math.ceil((r.until - Date.now()) / 60_000) }));

/** How long a key rests after a failure, or null when the failure is not the key's fault (a bad request). */
export function restFor(status: number | undefined, message: string): { ms: number; why: string } | null {
    if (status === 400 && /credit balance is too low/i.test(message)) return { ms: 60 * 60_000, why: 'out of credit' };
    if (status === 429) return { ms: 60_000, why: 'rate limited' };
    if (status === 401 || status === 403) return { ms: 60 * 60_000, why: 'key rejected' };
    if (status !== undefined && status >= 500) return { ms: 20_000, why: `Claude error ${status}` };
    if (status === undefined) return { ms: 0, why: 'no answer (network or timeout)' };
    return null;
}

type Content = Anthropic.Messages.ContentBlockParam;

function toContent(blocks: Block[]): Content[] {
    return blocks.map((b): Content => {
        if (b.type === 'text') return { type: 'text', text: b.text };
        if (b.type === 'image') return { type: 'image', source: { type: 'base64', media_type: b.mime as 'image/jpeg', data: b.base64 } };
        if (b.type === 'tool_use') return { type: 'tool_use', id: b.id, name: b.name, input: b.input as Record<string, unknown> };
        return { type: 'tool_result', tool_use_id: b.toolUseId, content: b.text, ...(b.isError ? { is_error: true } : {}) };
    });
}

function toMessages(messages: Msg[]): Anthropic.Messages.MessageParam[] {
    return messages.map(m => ({
        role: m.role,
        // The model's own content goes back exactly as it came (thinking blocks included); anything else is rebuilt.
        content: m.role === 'assistant' && Array.isArray(m.raw) ? m.raw as Content[] : toContent(m.blocks),
    }));
}

export interface AnthropicDeps {
    keys(): KeySlot[];
    /** One SDK client per key. Injected in tests. */
    client?(key: string): Pick<Anthropic, 'messages'>;
    now?(): number;
}

const clients = new Map<string, Anthropic>();
const defaultClient = (key: string) => {
    let c = clients.get(key);
    if (!c) { c = new Anthropic({ apiKey: key, maxRetries: 0, timeout: TIMEOUT_MS }); clients.set(key, c); }
    return c;
};

/** Some schema keywords are refused in strict mode. If that ever happens, tools are sent without `strict` from then on. */
let strictTools = true;
export const _setStrictTools = (on: boolean) => { strictTools = on; };

export function anthropicBrainModel(deps: AnthropicDeps): BrainModel {
    const now = deps.now ?? Date.now;
    const client = deps.client ?? defaultClient;
    return {
        async call(req: ModelCall): Promise<ModelReply> {
            const model = req.model.startsWith(ANTHROPIC_PREFIX) ? req.model.slice(ANTHROPIC_PREFIX.length) : req.model;
            const keys = deps.keys();
            if (!keys.length) throw new Error('no Claude key is set (CLAUDE_API_KEY)');
            const ready = keys.filter(k => (resting.get(k.slot)?.until ?? 0) <= now());
            // Every key resting: try them anyway rather than fail without asking.
            const order = ready.length ? ready : keys;
            const problems: string[] = [];
            for (const { slot, key } of order) {
                const send = (strict: boolean) => client(key).messages.create({
                    model,
                    max_tokens: req.maxTokens,
                    // The instructions and the tool list are identical on every call, so they are cached together.
                    system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
                    tools: req.tools.map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.input as Anthropic.Messages.Tool.InputSchema, ...(strict ? { strict: true } : {}) })),
                    tool_choice: { type: 'auto' },
                    output_config: { effort: req.effort },
                    messages: toMessages(req.messages),
                }, { timeout: TIMEOUT_MS, maxRetries: 0 });
                try {
                    let res: Anthropic.Messages.Message;
                    try { res = await send(strictTools); }
                    catch (err) {
                        const e = err as { status?: number; message?: string };
                        if (!(strictTools && e.status === 400 && /strict|schema|input_schema/i.test(e.message ?? ''))) throw err;
                        console.warn(`[Brain] Claude refused the strict tool schemas; sending them without strict from now on (${(e.message ?? '').slice(0, 300)})`);
                        strictTools = false;
                        res = await send(false);
                    }
                    resting.delete(slot);
                    const blocks: Block[] = [];
                    for (const b of res.content) {
                        if (b.type === 'text' && b.text.trim()) blocks.push({ type: 'text', text: b.text });
                        else if (b.type === 'tool_use') blocks.push({ type: 'tool_use', id: b.id, name: b.name, input: b.input });
                    }
                    const u = res.usage;
                    const cacheRead = u.cache_read_input_tokens ?? 0;
                    const cacheWrite = u.cache_creation_input_tokens ?? 0;
                    return {
                        blocks, raw: res.content, stopReason: String(res.stop_reason ?? 'unknown'), model: `${ANTHROPIC_PREFIX}${model}`, keySlot: slot,
                        usage: {
                            // input_tokens counts only the uncached part: the cached parts are added back so totals compare.
                            tokensIn: u.input_tokens + cacheRead + cacheWrite, tokensOut: u.output_tokens, cacheRead, cacheWrite,
                            costUsd: costUsd(model, { uncachedIn: u.input_tokens, out: u.output_tokens, cacheRead, cacheWrite }),
                        },
                    };
                } catch (err) {
                    const e = err as { status?: number; message?: string };
                    const rest = restFor(e.status, e.message ?? '');
                    // A bad request is our mistake: another key would get the same answer.
                    if (!rest) throw new Error(`Claude ${e.status ?? ''} ${(e.message ?? 'request failed').slice(0, 160)}`.trim());
                    if (rest.ms) resting.set(slot, { until: now() + rest.ms, why: rest.why });
                    problems.push(`key ${slot}: ${rest.why}`);
                }
            }
            throw new Error(`Claude could not answer (${problems.join('; ')})`);
        },
    };
}
