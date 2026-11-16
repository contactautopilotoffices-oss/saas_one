import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { brainGate, brainLevelFor, defaultLevel, parseBrainSettings, roleClass, scopeFingerprint } from '../../backend/lib/aiLayer/brain/config';
import { ungroundedParts } from '../../backend/lib/aiLayer/brain/loop/grounding';
import { SYSTEM_PROMPT, buildContext } from '../../backend/lib/aiLayer/brain/loop/prompt';
import { handleBook, openThread } from '../../backend/lib/aiLayer/brain/memory/thread';
import { _resetKeyPool, _setStrictTools, anthropicBrainModel, brainClaudeKeys, keyPoolStatus, restFor } from '../../backend/lib/aiLayer/brain/providers/anthropic';
import { openAiCompatBrainModel, toChatMessages } from '../../backend/lib/aiLayer/brain/providers/openaiCompat';
import { costUsd } from '../../backend/lib/aiLayer/brain/providers/pricing';
import { SKILLS, describeSkills, skillsFor, toolDefs, toolName } from '../../backend/lib/aiLayer/brain/skills/registry';
import type { ModelCall } from '../../backend/lib/aiLayer/brain/types';
import { ANDHERI, NOW, USER, actor, brainSettings, photo } from './brain-helpers';

const tenant = actor({ roles: ['tenant'], ownRecordsOnly: true, recordRule: 'raised_by_me' });
const vendor = actor({ roles: ['vendor'], ownRecordsOnly: true, recordRule: 'assigned_to_me' });

describe('brain settings', () => {
    it('everything is off until someone turns it on; a broken row also means off', () => {
        assert.equal(parseBrainSettings(undefined).mode, 'off');
        assert.equal(parseBrainSettings({ mode: 'live', surprise: true }).mode, 'off'); // unknown key → fail closed
        assert.deepEqual(parseBrainSettings({}).channels, { whatsapp: false, app_chat: false });
    });

    it('the gate: kill switch, mode, channel, blocked, pilot list', () => {
        const pilot = parseBrainSettings({ mode: 'live', channels: { whatsapp: true, app_chat: false }, pilotUserIds: [USER] });
        assert.deepEqual(brainGate({ userId: USER }, pilot, 'whatsapp', {}), { ok: true, mode: 'live' });
        assert.deepEqual(brainGate({ userId: USER }, pilot, 'whatsapp', { AI_BRAIN_DISABLED: 'true' }), { ok: false, reason: 'kill_switch' });
        assert.deepEqual(brainGate({ userId: USER }, pilot, 'app_chat', {}), { ok: false, reason: 'channel_off' });
        assert.deepEqual(brainGate({ userId: 'someone-else' }, pilot, 'whatsapp', {}), { ok: false, reason: 'not_in_pilot' });
        assert.deepEqual(brainGate({ userId: USER }, { ...pilot, blockedUserIds: [USER] }, 'whatsapp', {}), { ok: false, reason: 'blocked' });
        assert.deepEqual(brainGate({ userId: USER }, { ...pilot, mode: 'off' }, 'whatsapp', {}), { ok: false, reason: 'org_off' });
        assert.deepEqual(brainGate({ userId: USER }, { ...pilot, mode: 'shadow' }, 'whatsapp', {}), { ok: true, mode: 'shadow' });
    });

    it('role classes and their defaults: clients get no tasks, readings or wiki; vendors only read tickets', () => {
        assert.equal(roleClass(actor()), 'staff');
        assert.equal(roleClass(tenant), 'client');
        assert.equal(roleClass(vendor), 'vendor');
        assert.equal(defaultLevel('client', 'electricity'), 'off');
        assert.equal(defaultLevel('client', 'tasks'), 'off');
        assert.equal(defaultLevel('client', 'knowledge'), 'off');
        assert.equal(defaultLevel('vendor', 'tickets'), 'questions');
        assert.equal(defaultLevel('vendor', 'rooms'), 'off');
    });

    it('a grid row replaces the default for that role and module only', () => {
        const s = brainSettings({ grid: { property_admin: { tickets: 'questions' } } });
        assert.equal(brainLevelFor(actor(), s, 'tickets'), 'questions');
        assert.equal(brainLevelFor(actor(), s, 'rooms'), 'questions_actions');
        assert.equal(brainLevelFor(tenant, s, 'tickets'), 'questions_actions');
    });

    it('even a grid that grants everything cannot give a client a staff skill', () => {
        const s = brainSettings({ grid: { tenant: { tickets: 'questions_actions', rooms: 'questions_actions', tasks: 'questions_actions', electricity: 'questions_actions', knowledge: 'questions_actions', memory: 'questions_actions' } } });
        const ids = skillsFor(tenant, s).map(a => a.skill.id);
        assert.ok(!ids.some(id => /^electricity|^tasks|^task\.|^knowledge/.test(id)));
        assert.ok(ids.includes('ticket.create'));
    });

    it('the scope fingerprint changes when roles, buildings or skills change', () => {
        const base = scopeFingerprint(actor(), ['a', 'b']);
        assert.equal(base, scopeFingerprint(actor(), ['b', 'a']));
        assert.notEqual(base, scopeFingerprint(actor({ roles: ['tenant'] }), ['a', 'b']));
        assert.notEqual(base, scopeFingerprint(actor({ propertyIds: [] }), ['a', 'b']));
        assert.notEqual(base, scopeFingerprint(actor(), ['a']));
    });
});

describe('the skill registry', () => {
    it('every skill says when NOT to use it, gives three examples, and has a strict schema', () => {
        for (const s of SKILLS) {
            assert.match(s.description, /Do NOT/, `${s.id}: description needs a when-not clause`);
            assert.equal(s.examples.length, 3, `${s.id}: three examples`);
            const input = s.input as { additionalProperties?: boolean; required?: string[]; properties?: Record<string, unknown> };
            assert.equal(input.additionalProperties, false, `${s.id}: no extra properties`);
            assert.deepEqual([...(input.required ?? [])].sort(), Object.keys(input.properties ?? {}).sort(), `${s.id}: every property required`);
            assert.match(toolName(s.id), /^[a-zA-Z0-9_-]{1,64}$/);
        }
        assert.equal(new Set(SKILLS.map(s => s.id)).size, SKILLS.length);
    });

    it('nothing destructive or administrative exists as a skill', () => {
        assert.ok(!describeSkills().some(s => /delete|remove|approve|pay|role|permission|user\.|settings/.test(s.id)));
        assert.ok(SKILLS.every(s => s.risk <= 2));
    });

    it('writes start in shadow, except the memory ones and the task actions (off); the tool list is stable', () => {
        const writes = SKILLS.filter(s => s.kind === 'write');
        // The task actions (owner 2026-11-15) start OFF, which is stricter: they replace a bot people rely on.
        const tasks = new Set(['task.create', 'task.complete', 'task.hand_over', 'task.remind']);
        assert.ok(writes.filter(s => s.module !== 'memory' && !tasks.has(s.id)).every(s => s.defaultMode === 'shadow'));
        assert.ok(writes.filter(s => tasks.has(s.id)).every(s => s.defaultMode === 'off'));
        const a = toolDefs(skillsFor(actor(), brainSettings())).map(t => t.name);
        const b = toolDefs(skillsFor(actor(), brainSettings())).map(t => t.name);
        assert.deepEqual(a, b);
        assert.deepEqual(a.slice(-2), ['ask_user', 'handoff']);
    });
});

describe('grounding', () => {
    const src = 'Showing 2 of 2 ticket(s):\nT1 | TKT-101 | "AC not cooling" | status open | raised 2026-11-03\nFree on 2026-11-05, 16:00 to 17:00: Board Room';
    it('accepts an answer whose numbers and references all come from the sources', () => {
        assert.deepEqual(ungroundedParts('You have 2 tickets. TKT-101 is open since 3 Nov 2026. The Board Room is free at 4 pm (16:00).', src), []);
        assert.deepEqual(ungroundedParts('1) TKT-101\n2) Board Room', src), []);
    });
    it('rejects invented counts, references, links, emails and phone numbers', () => {
        assert.deepEqual(ungroundedParts('You have 57 tickets.', src), ['57']);
        assert.deepEqual(ungroundedParts('See TKT-999.', src), ['TKT-999', '999']);
        assert.deepEqual(ungroundedParts('Details at https://evil.example/x', src), ['https://evil.example/x']);
        assert.deepEqual(ungroundedParts('Mail boss@corp.example or call +91 98765 43210', src).slice(0, 2), ['boss@corp.example', '+91 98765 43210']);
    });
    it('dates around today are the calendar, not invented facts (found by the test set 2026-11-14)', () => {
        const said = 'book a meeting room for tomorrow';
        const q = 'Sure, a room for tomorrow (Thursday 5 Nov). What time do you need it, and for how long?';
        assert.deepEqual(ungroundedParts(q, said), ['5']); // without today's date: as before
        assert.deepEqual(ungroundedParts(q, said, '2026-11-04'), []);
        assert.deepEqual(ungroundedParts('Yesterday was Tuesday, 3 November 2026. Did you mean Nov 6th or 2026-11-07?', said, '2026-11-04'), []);
    });
    it('a date far from today, and a count or a ticket next to a date, still have to be in the sources', () => {
        assert.deepEqual(ungroundedParts('Your booking is on 5 Mar 2027.', 'nothing', '2026-11-04'), ['5', '2027']);
        assert.deepEqual(ungroundedParts('You have 57 tickets since 3 Nov.', 'nothing', '2026-11-04'), ['57']);
        assert.deepEqual(ungroundedParts('See TKT-999 from 3 Nov.', 'nothing', '2026-11-04'), ['TKT-999', '999']);
    });
    it('a clock time is accepted in the other form of the hour the person said, and not otherwise', () => {
        assert.deepEqual(ungroundedParts('Did you mean today at 15:00 to 16:00?', 'book the board room yesterday 3 to 4'), []);
        assert.deepEqual(ungroundedParts('Booked from 15:00 to 16:30.', 'book the board room 3 to 4'), ['16', '30']); // half past was never said
        assert.deepEqual(ungroundedParts('It is free at 09:00.', 'book the board room 3 to 4'), ['09', '00']);
        assert.deepEqual(ungroundedParts('You have 15 tickets.', 'book the board room 3 to 4'), ['15']);
    });
});

describe('the thread', () => {
    it('anything unparseable opens as an empty thread', () => {
        assert.deepEqual(openThread('garbage', NOW).history, []);
        assert.equal(openThread({ pending: { kind: 'confirm', opId: 'x' } }, NOW).pending, null);
    });
    it('two quiet hours drop the open proposal and the handles; a day drops the history', () => {
        const at = new Date(NOW.getTime() - 3 * 3600_000).toISOString();
        const stored = { lastActiveAt: at, handles: { T1: { kind: 'ticket', id: 'TKT-1', label: 'x' } }, pending: { kind: 'ask', question: 'Which?', options: [], at }, history: [{ role: 'user', text: 'hi', at }] };
        const s = openThread(stored, NOW);
        assert.equal(s.pending, null);
        assert.deepEqual(s.handles, {});
        assert.equal(s.history.length, 1);
        const old = new Date(NOW.getTime() - 30 * 3600_000).toISOString();
        assert.equal(openThread({ ...stored, history: [{ role: 'user', text: 'hi', at: old }] }, NOW).history.length, 0);
    });
    it('a proposal waits 30 minutes for its Yes', () => {
        const fresh = new Date(NOW.getTime() - 60_000).toISOString();
        const late = new Date(NOW.getTime() - 40 * 60_000).toISOString();
        const p = (at: string) => ({ lastActiveAt: fresh, pending: { kind: 'confirm', opId: '11111111-1111-4111-8111-111111111111', skillId: 'ticket.create', payload: {}, card: 'c', scope: 's', at } });
        assert.equal(openThread(p(fresh), NOW).pending?.kind, 'confirm');
        assert.equal(openThread(p(late), NOW).pending, null);
    });
    it('the same record keeps its handle; a handle of another kind does not resolve', () => {
        const book = handleBook({});
        assert.equal(book.issue('ticket', 'TKT-1', 'a'), 'T1');
        assert.equal(book.issue('ticket', 'TKT-2', 'b'), 'T2');
        assert.equal(book.issue('ticket', 'TKT-1', 'a again'), 'T1');
        assert.equal(book.issue('room', 'r', 'Board'), 'R1');
        assert.equal(book.resolve('t2', 'ticket')?.id, 'TKT-2');
        assert.equal(book.resolve('T2', 'room'), null);
        assert.equal(book.resolve('T9', 'ticket'), null);
    });
});

describe('the prompt', () => {
    it('the instructions are frozen text: no date, no name, no id', () => {
        assert.doesNotMatch(SYSTEM_PROMPT, /20\d\d-\d\d-\d\d|Andheri|[0-9a-f]{8}-[0-9a-f]{4}/);
        assert.match(SYSTEM_PROMPT, /Do not skip any step/);
    });
    it('the context names things, never ids or phone numbers', () => {
        const c = buildContext({ actor: actor(), lang: 'en', now: NOW, aliases: { [ANDHERI]: ['WSA'] }, attachments: [photo()], pending: null, memory: [], handles: {}, visibleImages: ['A1'] });
        assert.match(c, /Wednesday 2026-11-04, 12:00 India time/);
        assert.match(c, /Work Square Andheri \(also called WSA\)/);
        assert.match(c, /A1 photo/);
        assert.doesNotMatch(c, new RegExp(`${ANDHERI}|${USER}`));
    });
});

describe('Claude with two keys', () => {
    const req: ModelCall = { model: 'anthropic:claude-haiku-5-5', system: 'sys', tools: [{ name: 'tickets_list', description: 'd', input: { type: 'object', properties: {}, required: [], additionalProperties: false } }], messages: [{ role: 'user', blocks: [{ type: 'text', text: 'hi' }] }], maxTokens: 500, effort: 'low' };
    const ok = { content: [{ type: 'text', text: 'Hello' }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 } };
    const apiError = (status: number, message: string) => Object.assign(new Error(message), { status });
    type Sent = { key: string; body: Record<string, unknown> };
    const fake = (behaviour: (key: string, body: Record<string, unknown>) => unknown, sent: Sent[] = []) => ({
        sent,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client: (key: string) => ({ messages: { create: async (body: Record<string, unknown>) => { sent.push({ key, body }); const r = behaviour(key, body); if (r instanceof Error) throw r; return r; } } }) as any,
    });
    const keys = () => [{ slot: 1, key: 'k1' }, { slot: 2, key: 'k2' }];

    it('reads the keys by name in the chosen order and skips unset ones', () => {
        assert.deepEqual(brainClaudeKeys([2, 1], { CLAUDE_API_KEY: 'a', CLAUDE_API_KEY_2: 'b' }).map(k => k.slot), [2, 1]);
        assert.deepEqual(brainClaudeKeys([1, 2], { CLAUDE_API_KEY_2: 'b' }).map(k => k.slot), [2]);
        assert.deepEqual(brainClaudeKeys([1], { CLAUDE_API_KEY: 'a', CLAUDE_API_KEY_2: 'b' }).map(k => k.slot), [1, 2]);
    });

    it('an empty balance is a 400, and it rests the key like a rate limit does', () => {
        assert.equal(restFor(400, 'Your credit balance is too low to access the Anthropic API.')?.why, 'out of credit');
        assert.equal(restFor(429, 'slow down')?.why, 'rate limited');
        assert.equal(restFor(401, 'bad key')?.why, 'key rejected');
        assert.equal(restFor(400, 'messages: invalid'), null); // our mistake: another key would not help
    });

    it('key 1 out of credit → key 2 answers, and key 1 is rested so the next call goes straight to key 2', async () => {
        _resetKeyPool(); _setStrictTools(true);
        const f = fake(key => (key === 'k1' ? apiError(400, 'Your credit balance is too low to access the Anthropic API.') : ok));
        const model = anthropicBrainModel({ keys, client: f.client });
        const first = await model.call(req);
        assert.equal(first.keySlot, 2);
        assert.deepEqual(f.sent.map(s => s.key), ['k1', 'k2']);
        await model.call(req);
        assert.deepEqual(f.sent.map(s => s.key), ['k1', 'k2', 'k2']);
        assert.deepEqual(keyPoolStatus().map(s => [s.slot, s.why]), [[1, 'out of credit']]);
    });

    it('a bad request is not retried on the other key', async () => {
        _resetKeyPool();
        const f = fake(() => apiError(400, 'messages.0: unexpected role'));
        await assert.rejects(anthropicBrainModel({ keys, client: f.client }).call(req), /Claude 400/);
        assert.equal(f.sent.length, 1);
    });

    it('both keys failing says why, without ever printing a key', async () => {
        _resetKeyPool();
        const f = fake(() => apiError(429, 'rate limited'));
        await assert.rejects(anthropicBrainModel({ keys, client: f.client }).call(req), (e: Error) => /key 1: rate limited; key 2: rate limited/.test(e.message) && !/k1|k2/.test(e.message));
    });

    it('sends cached instructions, strict tools, effort and auto tool choice; counts cached tokens and cost', async () => {
        _resetKeyPool(); _setStrictTools(true);
        const f = fake(() => ok);
        const out = await anthropicBrainModel({ keys, client: f.client }).call(req);
        const body = f.sent[0].body as { model: string; system: Array<{ cache_control?: unknown }>; tools: Array<{ strict?: boolean }>; tool_choice: unknown; output_config: unknown; temperature?: unknown; thinking?: unknown };
        assert.equal(body.model, 'claude-haiku-5-5');
        assert.deepEqual(body.system[0].cache_control, { type: 'ephemeral' });
        assert.equal(body.tools[0].strict, true);
        assert.deepEqual(body.tool_choice, { type: 'auto' });
        assert.deepEqual(body.output_config, { effort: 'low' });
        assert.equal(body.temperature, undefined);
        assert.equal(body.thinking, undefined);
        assert.equal(out.usage.tokensIn, 1000);
        assert.equal(out.usage.cacheRead, 900);
        assert.ok(Math.abs((out.usage.costUsd ?? 0) - costUsd('claude-haiku-5-5', { uncachedIn: 100, out: 20, cacheRead: 900, cacheWrite: 0 })!) < 1e-12);
    });

    it('if strict schemas are refused, tools are resent without strict', async () => {
        _resetKeyPool(); _setStrictTools(true);
        const f = fake((_k, body) => ((body.tools as Array<{ strict?: boolean }>)[0].strict ? apiError(400, 'tools.0.input_schema: unsupported keyword in strict mode') : ok));
        const out = await anthropicBrainModel({ keys, client: f.client }).call(req);
        assert.equal(out.blocks[0].type, 'text');
        assert.equal(f.sent.length, 2);
        _setStrictTools(true);
    });

    it('the model\'s own content goes back unchanged on the next call; tool results carry their id', async () => {
        _resetKeyPool();
        const f = fake(() => ok);
        const raw = [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'tool_use', id: 'tu1', name: 'tickets_list', input: {} }];
        await anthropicBrainModel({ keys, client: f.client }).call({ ...req, messages: [
            ...req.messages,
            { role: 'assistant', blocks: [{ type: 'tool_use', id: 'tu1', name: 'tickets_list', input: {} }], raw },
            { role: 'user', blocks: [{ type: 'tool_result', toolUseId: 'tu1', text: 'No tickets', isError: true }] },
        ] });
        const sent = f.sent[0].body.messages as Array<{ role: string; content: unknown }>;
        assert.deepEqual(sent[1].content, raw);
        assert.deepEqual(sent[2].content, [{ type: 'tool_result', tool_use_id: 'tu1', content: 'No tickets', is_error: true }]);
    });

    it('unknown models have no cost estimate (null, not zero)', () => {
        assert.equal(costUsd('glm-5.3-flash', { uncachedIn: 1000, out: 10, cacheRead: 0, cacheWrite: 0 }), null);
    });
});

describe('backup models (OpenAI-style)', () => {
    it('never sends a photo; tool calls and results are translated both ways', async () => {
        const messages = toChatMessages('sys', [
            { role: 'user', blocks: [{ type: 'image', mime: 'image/jpeg', base64: 'AAAA' }, { type: 'text', text: 'what is this' }] },
            { role: 'assistant', blocks: [{ type: 'tool_use', id: 'c1', name: 'tickets_list', input: { status: 'open' } }] },
            { role: 'user', blocks: [{ type: 'tool_result', toolUseId: 'c1', text: 'No tickets' }] },
        ]);
        assert.ok(!JSON.stringify(messages).includes('AAAA'));
        assert.match(String(messages[1].content), /cannot see it/);
        assert.equal(messages[2].tool_calls?.[0].function.arguments, '{"status":"open"}');
        assert.deepEqual(messages[3], { role: 'tool', tool_call_id: 'c1', content: 'No tickets' });

        let sentBody = '';
        const fetchImpl = (async (_url: unknown, init?: { body?: unknown }) => {
            sentBody = String(init?.body);
            return new Response(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: 'x', function: { name: 'tickets_list', arguments: '{"status":"open"' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 50, completion_tokens: 5 } }), { status: 200 });
        }) as unknown as typeof fetch;
        const model = openAiCompatBrainModel({ endpoint: async m => ({ url: 'https://example.invalid/v1/chat/completions', apiKey: 'secret', model: m }), fetchImpl });
        const out = await model.call({ model: 'glm-5.3-flash', system: 'sys', tools: [{ name: 'tickets_list', description: 'd', input: {} }], messages: [{ role: 'user', blocks: [{ type: 'text', text: 'hi' }] }], maxTokens: 300, effort: 'low' });
        assert.equal(out.stopReason, 'tool_use');
        assert.deepEqual(out.blocks[0], { type: 'tool_use', id: 'x', name: 'tickets_list', input: {} }); // broken JSON → empty, the skill's own check answers
        assert.equal(out.usage.costUsd, null);
        assert.ok(!sentBody.includes('secret'));
    });
});
