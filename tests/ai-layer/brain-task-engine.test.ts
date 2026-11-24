// 2026-11-18: the task assistant as the brain's task engine (owner: "the task manager interactions must be exactly as it
// is now"). Three parts:
//   1. the brain marks the task words and hands them on (fake model);
//   2. the WhatsApp channel: a message only about tasks goes on unchanged and is remembered; a mixed one gets ONE reply;
//   3. SIDE BY SIDE with the REAL task assistant code (task-manager/brain/live.ts) in a fake world: the same messages,
//      answered directly, with the brain listening, and with the brain borrowing the reply, give the SAME words and the
//      SAME task changes.
// No database, no model key, no network and no WhatsApp: every dependency below is a fake.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fake-key-offline-test';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { claimBrain, type BrainWhatsAppDeps } from '../../backend/lib/aiLayer/brain/channels/whatsapp';
import { runTurn, ownWords, coversMessage } from '../../backend/lib/aiLayer/brain/loop/turn';
import { SYSTEM_PROMPT, SYSTEM_PROMPT_TASK_ENGINE } from '../../backend/lib/aiLayer/brain/loop/prompt';
import { skillsFor, toolDefs } from '../../backend/lib/aiLayer/brain/skills/registry';
import type { BrainSettings } from '../../backend/lib/aiLayer/brain/config';
import { FakeAudit, FakeBrainData, ORG, ScriptedModel, USER, actor, brainSettings, call, turnDeps, turnInput } from './brain-helpers';

const ON = () => brainSettings({ taskEngine: true, skillModes: { 'ticket.create': 'live', 'task.create': 'live', 'task.complete': 'live' } });
const lastSystem = (m: ScriptedModel) => String((m.calls.at(-1) as { system?: unknown } | undefined)?.system ?? '');
const toolNames = (m: ScriptedModel) => ((m.calls.at(-1) as { tools?: Array<{ name: string }> } | undefined)?.tools ?? []).map(t => t.name);

describe('the brain marks the task words', () => {
    it('switch off: no task_part, the prompt and tools exactly as before', async () => {
        const m = new ScriptedModel([call('handoff', { to: 'tasks_assistant', reason: 'tasks' })]);
        const out = await runTurn(turnDeps(new FakeBrainData(), m), turnInput('done 2'));
        assert.equal(lastSystem(m), SYSTEM_PROMPT);
        assert.ok(!toolNames(m).includes('task_part'));
        assert.equal(out.handoffTo, 'tasks_assistant');
    });

    it('switch on: task_part offered on WhatsApp only, and the brain\'s own task actions are not', async () => {
        const settings = ON();
        const names = toolDefs(skillsFor(actor(), settings), { taskPart: true }).map(t => t.name);
        assert.ok(names.includes('task_part'));
        assert.ok(!names.includes('task_create') && !names.includes('task_complete'), 'no Yes-card task actions');
        const wa = new ScriptedModel([call('task_part', { words: 'done 2' }), '']);
        await runTurn(turnDeps(new FakeBrainData(), wa), turnInput('done 2', { settings }));
        assert.equal(lastSystem(wa), SYSTEM_PROMPT_TASK_ENGINE);
        const app = new ScriptedModel(['Hello']);
        await runTurn(turnDeps(new FakeBrainData(), app), turnInput('hi', { settings, channel: 'app_chat' }));
        assert.ok(!toolNames(app).includes('task_part'), 'the in-app chat has no task assistant');
    });

    it('only about tasks: the plain hand-off, exactly as today (no task words, no brain reply)', async () => {
        const settings = ON();
        for (const steps of [[call('task_part', { words: 'done 2' }), ''], [call('task_part', { words: 'Done 2!' }), 'Sure!']]) {
            const out = await runTurn(turnDeps(new FakeBrainData(), new ScriptedModel(steps)), turnInput('Done 2!', { settings }));
            assert.equal(out.outcome, 'handoff');
            assert.equal(out.handoffTo, 'tasks_assistant');
            assert.equal(out.taskWords, undefined);
        }
    });

    it('mixed: the brain answers its part and carries the task words for the channel', async () => {
        const out = await runTurn(turnDeps(new FakeBrainData(), new ScriptedModel([call('task_part', { words: 'done 2' }), 'Your tickets are all closed.'])), turnInput('done 2, and any open tickets?', { settings: ON() }));
        assert.equal(out.outcome, 'answer');
        assert.equal(out.reply!.text, 'Your tickets are all closed.');
        assert.equal(out.taskWords, 'done 2');
    });

    it('words that are not the person\'s own are refused, so the task assistant never gets the model\'s rewording', async () => {
        const m = new ScriptedModel([call('task_part', { words: 'mark task two as complete' }), 'Your tickets are all closed.']);
        const out = await runTurn(turnDeps(new FakeBrainData(), m), turnInput('done 2, and any open tickets?', { settings: ON() }));
        assert.match(m.toolResults()[0], /Not taken: those words are not in the message/);
        assert.equal(out.taskWords, undefined);
        assert.ok(ownWords('done 2', 'Done 2, and any open tickets?'));
        assert.ok(coversMessage('done 2', 'Done 2!'));
        assert.ok(!coversMessage('done 2', 'done 2, and any open tickets?'));
    });
});

// ── the channel ──────────────────────────────────────────────────────────────────────────────────────────────────

function channel(settings: BrainSettings, model: ScriptedModel, over: Partial<BrainWhatsAppDeps> = {}) {
    const data = new FakeBrainData();
    const w = { sent: [] as string[], threads: new Map<string, unknown>(), asked: [] as string[], waiting: false };
    const deps: BrainWhatsAppDeps = {
        env: {},
        anyOrgOn: async () => true,
        findUser: async () => ({ id: USER, is_master_admin: false }),
        orgsForUser: async () => [ORG],
        loadActor: async () => actor(),
        loadSettings: async () => ({ settings, aliases: {} }),
        importBusy: async () => false,
        captionMentionsTasks: () => false,
        loadThread: async (o, u, sh) => w.threads.get(`${o}:${u}:${sh}`) ?? null,
        saveThread: async (o, u, sh, st) => { w.threads.set(`${o}:${u}:${sh}`, st); },
        listOpenFiles: async () => [],
        stage: async () => ({ ok: false, reason: 'download_failed' }),
        turnDeps: () => turnDeps(data, model, new FakeAudit()),
        record: async () => undefined,
        sendReply: async (_p, t) => { w.sent.push(t); return true; },
        taskBotWaiting: async () => w.waiting,
        askTaskAssistant: async ({ text }) => { w.asked.push(text); return { taken: true, replies: ['✅ Marked "Call the vendor" as done.'] }; },
        ...over,
    };
    return { w, deps };
}
const msg = (text: string) => ({ phone: '919876543210', text, messageId: `m-${text.length}-${Math.random()}`, mediaUrl: null, mediaType: null });
const thread = (w: { threads: Map<string, unknown> }) => w.threads.get(`${ORG}:${USER}:false`) as { history: Array<{ role: string; text: string }> } | undefined;

describe('WhatsApp with the task engine on', () => {
    it('only about tasks: passed on unchanged (the task assistant answers), and its reply is remembered', async () => {
        const { w, deps } = channel(ON(), new ScriptedModel([call('task_part', { words: 'done 2' }), '']));
        const claim = await claimBrain(deps, msg('done 2'));
        assert.equal(claim.handled, false);
        if (claim.handled) return;
        assert.equal(claim.skipAiLayer, true, 'straight to the task assistant, as today');
        assert.equal(w.sent.length, 0, 'the brain sends nothing');
        assert.ok(claim.onTaskReply);
        await claim.onTaskReply!('✅ Marked "Call the vendor" as done.');
        assert.deepEqual(thread(w)!.history.map(h => `${h.role}: ${h.text}`), ['user: done 2', 'assistant: ✅ Marked "Call the vendor" as done.']);
    });

    it('mixed: ONE reply, the task assistant\'s words untouched, in the order the person wrote them', async () => {
        const { w, deps } = channel(ON(), new ScriptedModel([call('task_part', { words: 'done 2' }), 'You have no open tickets.']));
        const claim = await claimBrain(deps, msg('done 2, and any open tickets?'));
        assert.ok(claim.handled); await claim.background();
        assert.deepEqual(w.asked, ['done 2']);
        assert.equal(w.sent.length, 1);
        assert.equal(w.sent[0], '✅ Marked "Call the vendor" as done.\n\nYou have no open tickets.');
        assert.equal(thread(w)!.history.at(-1)!.text, w.sent[0], 'the brain remembers both parts');
    });

    it('mixed, task part last: the brain\'s part first', async () => {
        const { w, deps } = channel(ON(), new ScriptedModel([call('task_part', { words: 'done 2' }), 'You have no open tickets.']));
        const claim = await claimBrain(deps, msg('any open tickets? also done 2'));
        assert.ok(claim.handled); await claim.background();
        assert.equal(w.sent[0], 'You have no open tickets.\n\n✅ Marked "Call the vendor" as done.');
    });

    it('the task assistant does not take it (or fails): the brain\'s part goes out and asks for the task part on its own', async () => {
        for (const ask of [async () => ({ taken: false, replies: [] }), async () => { throw new Error('down'); }]) {
            const { w, deps } = channel(ON(), new ScriptedModel([call('task_part', { words: 'done 2' }), 'You have no open tickets.']), { askTaskAssistant: ask });
            const claim = await claimBrain(deps, msg('done 2, and any open tickets?'));
            assert.ok(claim.handled); await claim.background();
            assert.equal(w.sent[0], 'You have no open tickets.\n\nFor the task part, please send it as its own message.');
        }
    });

    it('the task assistant is waiting for this person\'s answer: the message is its, as today', async () => {
        const { w, deps } = channel(ON(), new ScriptedModel(['x']));
        w.waiting = true;
        const claim = await claimBrain(deps, msg('yes'));
        assert.deepEqual(claim, { handled: false, why: 'task_bot_waiting' });
    });

    it('switch off: a task message is the plain hand-off and nothing listens (exactly as before)', async () => {
        const { deps } = channel(brainSettings(), new ScriptedModel([call('handoff', { to: 'tasks_assistant', reason: 'tasks' })]));
        const claim = await claimBrain(deps, msg('done 2'));
        assert.equal(claim.handled, false);
        if (!claim.handled) assert.equal(claim.onTaskReply, undefined);
    });
});

// ── side by side with the REAL task assistant ───────────────────────────────────────────────────────────────────

/** The task assistant's own offline world (as in task-manager/tests/test_brain_phase4_live.ts), trimmed. */
async function taskWorld() {
    const L = await import('../../task-manager/brain/live');
    const { world } = await import('../../task-manager/brain/eval/worlds');
    const PHONE = '918433649199';
    const interps = (m: string) => {
        const has = (s: string) => m.toLowerCase().includes(s);
        const mk = (intent: string, slots: unknown, summary: string) => ({ intent, slots, summary });
        if (has('add two things')) return mk('create_tasks', { assignee: 'me', tasks: [{ title: 'Call the vendor', details: null }, { title: 'Email the quote', details: null }], date: null }, 'Add two tasks for myself');
        if (has('show my tasks')) return mk('view_tasks', { scope: 'self', person: null, department: null }, 'Show my tasks');
        if (has('done 2')) return mk('complete_tasks', { which: { all: false, numbers: [2], hints: [] } }, 'Mark task 2 as done');
        if (has('working on the carpet')) return mk('progress_update', { state: 'working', which: { all: false, numbers: [1], hints: [] }, note: null }, 'Working on the carpet task');
        if (has('review the rfid rollout')) return mk('create_tasks', { assignee: 'Lohit', tasks: [{ title: 'Review the RFID rollout', details: null }], date: null }, 'Give Lohit a task');
        return mk('smalltalk', {}, 'Said hello');
    };
    const make = () => {
        const w = { state: null as null | { type: string; data: unknown }, sent: [] as string[], others: [] as string[], exec: [] as unknown[][], seen: new Set<string>() };
        const llm = { complete: async (req: { system: string; user: string }) => {
            const u = JSON.parse(req.user);
            if (/Reply with JSON only: \{"text"/.test(req.system)) {
                const need = (u.placeholders || []).filter((p: { required?: boolean }) => p.required).map((p: { name: string }) => p.name).join(' ');
                return { text: JSON.stringify({ text: u.mustEndWithQuestion ? `Quick check, is this right? ${need}` : `Okay, here you go: ${need}` }), tokensIn: 5, tokensOut: 5 };
            }
            return { text: JSON.stringify({ confidence: 0.95, language: 'en', ambiguities: [], clarify_question: null, ...interps(u.message) }), tokensIn: 10, tokensOut: 8 };
        } };
        const io = {
            getSmartChatDepartments: async () => new Set(['d1']), getConfig: async () => ({ enabled: true, employees: [{ name: 'Sahil', phone: '8433649199' }] }),
            getEmployee: async () => ({ id: 'u1', name: 'Priyanka Shah', department_id: 'd1', department_name: 'Procurement', role: 'employee' }), checkAccess: async () => ({ allowed: true }),
            facilityActive: async () => false,
            getState: async () => w.state,
            setState: async (_p: string, s: unknown) => { w.state = { type: L.LIVE_STATE_TYPE, data: JSON.parse(JSON.stringify(s)) }; },
            clearState: async () => { if (w.state?.type === L.LIVE_STATE_TYPE) w.state = null; },
            openPingPending: async () => null,
            buildContext: async (_e: unknown, _p: string, opts: { pending: unknown; recent: unknown }) => ({ ...world('default'), pending: opts.pending, recent: opts.recent }),
            brain: { llm },
            exec: {
                setStatus: async (a: string, id: string, s: string) => { w.exec.push(['setStatus', a, id, s]); },
                assign: async (a: string, i: { targetUserId: string; title: string; date: string }) => { w.exec.push(['assign', a, i.targetUserId, i.title, i.date]); },
                handOver: async (a: string, id: string, to: string) => { w.exec.push(['handOver', a, id, to]); return { toName: 'Vidya Nair' }; },
                readPerson: async () => '1. Chase quote (Pending)', readInsight: async () => 'Procurement: 3 open',
            },
            reply: async (p: string, t: string) => { (p.endsWith('8433649199') ? w.sent : w.others).push(t); },
            audit: async () => undefined,
            seenBefore: (id: string) => w.seen.has(id), markSeen: (id: string) => { w.seen.add(id); },
        };
        return { w, io };
    };
    const body = (text: string, id: string) => ({ topic: 'message.sender.user', data: { messages: [{ phone_number: PHONE, id, message_type: 'text', text: { body: text } }] } });
    return { L, make, body, PHONE };
}

describe('side by side: the task assistant answers exactly as today', () => {
    // A conversation, message after message, each answered by the real task assistant code.
    const CHAT = ['show my tasks', 'done 2', 'yes', 'working on the carpet one', 'add two things: call the vendor and email the quote', 'review the rfid rollout for lohit', 'yes'];

    it('directly, with the brain listening, and with the brain borrowing the reply: the same words, the same task changes', async () => {
        const { L, make, body, PHONE } = await taskWorld();
        const direct = make(), listened = make(), borrowed = make();
        const heard: string[] = [], captured: string[][] = [];
        for (const [i, text] of CHAT.entries()) {
            const id = `x${i}`;
            // 1. Today: the webhook gives the message to the task assistant.
            const a = await L.claimSmartChat(body(text, id), direct.io as never); await a.background?.();
            // 2. Task engine, a message only about tasks: the same call with the brain listening.
            const b = await L.claimSmartChat(body(text, id), listened.io as never, { onReply: t => { heard.push(t); } }); await b.background?.();
            // 3. Task engine, the task words of a mixed message: the brain borrows the reply and sends it itself.
            const got: string[] = [];
            const c = await L.claimSmartChat(L.bodyWithText(null, PHONE, id, text), borrowed.io as never, { noBatch: true, capture: t => { got.push(t); } }); await c.background?.();
            captured.push(got);
            assert.equal(a.handled, b.handled, `taken the same way: "${text}"`);
            assert.equal(a.handled, c.handled, `taken the same way: "${text}"`);
        }
        assert.ok(direct.w.sent.length >= CHAT.length - 1, 'the task assistant answered the chat');
        assert.deepEqual(listened.w.sent, direct.w.sent, 'listening changes nothing that is sent');
        assert.deepEqual(heard, direct.w.sent, 'and the brain heard every reply');
        assert.deepEqual(borrowed.w.sent, [], 'borrowed: the task assistant itself sends nothing to the person');
        assert.deepEqual(captured.flat(), direct.w.sent, 'borrowed: the very same words come back to the brain');
        assert.deepEqual(listened.w.exec, direct.w.exec, 'the same task changes');
        assert.deepEqual(borrowed.w.exec, direct.w.exec, 'the same task changes');
        assert.deepEqual(borrowed.w.others, direct.w.others, 'messages to other people are sent exactly as always');
        assert.ok(direct.w.exec.length > 0, 'the chat really changed tasks');
    });
});
