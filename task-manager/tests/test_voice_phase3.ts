/**
 * Voice Note Intake — Phase 3: one YES through the brain (100% OFFLINE: the REAL voice intake and the REAL brain, with a scripted
 * AI, a fake world and a RECORDER in place of WhatsApp and of the task functions; no network, no real database).
 * Run: npx tsx task-manager/tests/test_voice_phase3.ts
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key-offline-test';

import type { LiveIO } from '../brain/live';
import type { ExecIO } from '../brain/execute';
import type { LlmRequest } from '../brain/llm';
import type { VoiceIO, VoiceState } from '../voice/VoiceIntake';
import type { CleanupResult } from '../voice/VoiceCleanup';

let failures = 0;
const check = (n: string, ok: boolean, x?: unknown) => { if (ok) console.log(`  ✓ ${n}`); else { failures++; console.error(`  ✗ ${n}`, x ?? ''); } };

const PHONE = '918433649199';
const T0 = Date.parse('2026-10-08T06:00:00Z');
const voiceBody = (id: string) => ({ topic: 'message.sender.user', data: { message: { phone_number: PHONE, message_type: 'AUDIO', messageId: id,
    message_content: { url: 'https://cdn.aisensy.example/v.ogg', mimeType: 'audio/ogg; codecs=opus' } } } });
const textBody = (text: string, id: string) => ({ topic: 'message.sender.user', data: { messages: [{ phone_number: PHONE, id, message_type: 'text', text: { body: text } }] } });

async function run() {
    const net: string[] = [];
    globalThis.fetch = (async (u: RequestInfo | URL) => { net.push(String(u)); throw new Error('network must not be used'); }) as typeof fetch;
    const warned: string[] = [];
    const warn = console.warn; console.warn = (...a: unknown[]) => { warned.push(a.map(String).join(' ')); };

    const L = await import('../brain/live');
    const V = await import('../voice/VoiceIntake');
    const { world } = await import('../brain/eval/worlds');

    // ── the brain's fake world (same shape as test_brain_phase4_live) ───────
    const intentFor = (msg: string): Record<string, unknown> => {
        const has = (s: string) => msg.toLowerCase().includes(s);
        if (has('review the rfid rollout')) return { intent: 'create_tasks', slots: { assignee: 'Lohit', tasks: [{ title: 'Review the RFID rollout', details: null }], date: null }, summary: 'Give Lohit a task to review the RFID rollout' };
        if (has('show my tasks')) return { intent: 'view_tasks', slots: { scope: 'self', person: null, department: null }, summary: 'Show my tasks' };
        if (has('book the boardroom')) return { intent: 'facility_request', slots: { service: 'room' }, summary: 'Book the boardroom' };
        return { intent: 'smalltalk', slots: {}, summary: 'Said hello' };
    };
    /* eslint-disable @typescript-eslint/no-explicit-any -- the fake world mirrors the brain's own untyped test fakes */
    const brainWorld = (over: Record<string, unknown> = {}) => {
        const w: any = { depts: new Set(['d1']), aiDown: false, facility: false, state: null, sent: [] as string[], audits: [] as any[], exec: [] as any[], seen: new Set<string>(), understand: 0, ...over };
        const llm = { complete: async (req: LlmRequest) => {
            if (w.aiDown) throw new Error('HTTP 503');
            const u = JSON.parse(req.user);
            if (/Reply with JSON only: \{"text"/.test(req.system)) {
                const need = (u.placeholders || []).filter((p: any) => p.required).map((p: any) => p.name).join(' ');
                return { text: JSON.stringify({ text: u.mustEndWithQuestion ? `Quick check, is this right? ${need}` : `Okay, here you go: ${need}` }), tokensIn: 5, tokensOut: 5 };
            }
            w.understand++;
            return { text: JSON.stringify({ confidence: 0.95, language: 'en', ambiguities: [], clarify_question: null, ...intentFor(u.message) }), tokensIn: 10, tokensOut: 8 };
        } };
        const exec: ExecIO = {
            setStatus: async (a, id, s) => { w.exec.push(['setStatus', a, id, s]); },
            assign: async (a, i) => { w.exec.push(['assign', a, i.targetUserId, i.title, i.date]); },
            handOver: async (a, id, to) => { w.exec.push(['handOver', a, id, to]); return { toName: 'Vidya Nair' }; },
            readPerson: async () => '1. Chase quote (Pending)', readInsight: async () => 'Procurement: 3 open',
            relay: async () => ({ told: [], couldNot: [] }),
        };
        const io: LiveIO = {
            getSmartChatDepartments: async () => w.depts, getConfig: async () => ({ enabled: true, employees: [{ name: 'Sahil', phone: '8433649199' }] } as any),
            getEmployee: async () => ({ id: 'u1', name: 'Priyanka Shah', department_id: 'd1', department_name: 'Procurement', role: 'employee' } as any),
            checkAccess: async () => ({ allowed: true } as any), facilityActive: async () => w.facility,
            getState: async () => w.state,
            setState: async (_p, s) => { w.state = { type: L.LIVE_STATE_TYPE, data: JSON.parse(JSON.stringify(s)) }; },
            clearState: async () => { if (w.state?.type === L.LIVE_STATE_TYPE) w.state = null; },
            openPingPending: async () => null,
            buildContext: async (_e, _p, opts) => ({ ...world('default'), pending: opts.pending, recent: opts.recent } as any),
            brain: { llm },
            exec,
            reply: async (_p, t) => { w.sent.push(t); },
            audit: async d => { w.audits.push(d); },
            seenBefore: id => w.seen.has(id), markSeen: id => { w.seen.add(id); },
        };
        w.io = io;
        return w;
    };
    /* eslint-enable @typescript-eslint/no-explicit-any */

    // ── the voice side: real intake, fake download / Whisper / tidy-up, real hand-off to the brain ──
    const voiceSide = (w: ReturnType<typeof brainWorld>, heardText: string, o: { tidy?: Partial<CleanupResult>; brainThrows?: boolean; state?: VoiceState; slowMs?: number } = {}) => {
        const rec = { replies: [] as string[], audits: [] as Array<Record<string, unknown>>, brainTries: 0 };
        let stored: unknown = o.state ?? null;
        let clock = T0;
        const io: VoiceIO = {
            enabled: () => true,
            recognise: async () => ({ employeeId: 'u1', userId: null }),
            download: async () => ({ ok: true, buffer: Buffer.from('OggS'), contentType: 'audio/ogg' }),
            transcribe: async () => ({ ok: true, text: `um ${heardText}`, language: 'english', durationSec: 4, model: 'whisper-large-v3', failures: [] }),
            cleanup: async () => (clock += o.slowMs ?? 0, { text: heardText, cleaned: true, language: 'en', unclear: false, model: 'qwen3.8-27b', failures: [], tokensIn: 1, tokensOut: 1, ...o.tidy }),
            tryBrain: async i => { rec.brainTries++; if (o.brainThrows) throw new Error('brain exploded'); return V.handToBrain(i, w.io); },
            getState: async () => stored,
            setState: async (_p, s) => { stored = JSON.parse(JSON.stringify(s)); },
            // Voice replies and brain replies land in the same chat, in order.
            reply: async (_p, t) => { rec.replies.push(t); w.sent.push(t); return true; },
            audit: async d => { rec.audits.push(d); },
            now: () => clock,
        };
        return { io, rec, stored: () => stored as VoiceState | null };
    };
    /** The webhook, as Phase 4 will wire it: voice first, then the brain for text (a YES that is not the voice note's). */
    const webhook = async (body: unknown, vio: VoiceIO, w: ReturnType<typeof brainWorld>) => {
        const v = await V.claimVoiceNote(body, vio);
        if (v.kind === 'handled') { await v.background?.(); return 'voice'; }
        const textBody2 = v.kind === 'rewrite' ? v.body : body;
        const b = await L.claimSmartChat(textBody2, w.io);
        if (b.handled) { await b.background?.(); return v.kind === 'rewrite' ? 'voice-yes→brain' : 'brain'; }
        return v.kind === 'rewrite' ? 'voice-yes→old flow' : 'old flow';
    };

    console.log('\n1. The brain option on its own');
    let w = brainWorld();
    let c = await L.claimSmartChat(textBody('show my tasks', 't1'), w.io);
    await c.background?.();
    check('no option → reply exactly as before (no prefix), no "via" in the audit', w.sent.length === 1 && w.sent[0].startsWith('Okay, here you go') && !('via' in w.audits[0]), w.sent);
    w = brainWorld();
    c = await L.claimSmartChat(textBody('show my tasks', 't2'), w.io, { replyPrefix: '🎙️ I heard: "Show my tasks."', via: 'voice' });
    await c.background?.();
    check('with a prefix → "<prefix>\\n\\n<the same reply>", audit says via: voice', w.sent.length === 1 && w.sent[0].startsWith('🎙️ I heard: "Show my tasks."\n\nOkay, here you go') && w.audits[0].via === 'voice', w.sent);
    check('the prefix is not kept in the brain\'s short memory', !JSON.stringify(w.state).includes('I heard'), w.state);

    console.log('\n2. A read-only question by voice → answered straight away, no YES');
    w = brainWorld();
    let v = voiceSide(w, 'Show my tasks.');
    let route = await webhook(voiceBody('v1'), v.io, w);
    check('one message: "I heard …" + the answer', route === 'voice' && w.sent.length === 1 && w.sent[0].startsWith('🎙️ I heard: "Show my tasks."\n\nOkay, here you go') && !/Reply \*YES\*/.test(w.sent[0]), w.sent);
    check('nothing waits for a YES (no voice pending, no brain confirm)', !v.stored()?.pending && !w.state?.data?.pending, { v: v.stored(), b: w.state });
    check('audit: transcribed via the brain', v.rec.audits[0]?.outcome === 'transcribed' && v.rec.audits[0]?.route === 'brain' && w.audits[0]?.via === 'voice', v.rec.audits);

    console.log('\n3. A change by voice → ONE YES does both');
    w = brainWorld();
    v = voiceSide(w, 'Give Lohit a task to review the RFID rollout.');
    route = await webhook(voiceBody('v2'), v.io, w);
    check('one message: "I heard …" + the brain\'s own confirm question; nothing changed yet', route === 'voice' && w.sent.length === 1
        && w.sent[0].startsWith('🎙️ I heard: "Give Lohit a task to review the RFID rollout."\n\nQuick check, is this right?') && w.exec.length === 0, { sent: w.sent, exec: w.exec });
    check('the brain holds the confirm; the voice side holds nothing', w.state?.data?.pending?.kind === 'confirm' && !v.stored()?.pending, { b: w.state, v: v.stored() });
    route = await webhook(textBody('yes', 't3'), v.io, w);
    check('a single "yes" → the task is created (no second YES)', route === 'brain' && JSON.stringify(w.exec) === JSON.stringify([['assign', 'u1', 'u3', 'Review the RFID rollout', '2026-10-08']]), { route, exec: w.exec });
    check('the "done" reply has no "I heard" line (that was the previous turn)', w.sent.length === 2 && !w.sent[1].includes('I heard'), w.sent);
    w = brainWorld();
    v = voiceSide(w, 'Give Lohit a task to review the RFID rollout.');
    await webhook(voiceBody('v3'), v.io, w);
    route = await webhook(textBody('no', 't4'), v.io, w);
    check('"no" instead → nothing changed', route === 'brain' && w.exec.length === 0 && w.state === null, { route, exec: w.exec });

    console.log('\n4. Not the brain\'s → "I heard … YES?" first (the Phase 2 path)');
    const fallsBack = async (label: string, over: Record<string, unknown>, said: string, o: Parameters<typeof voiceSide>[2] = {}) => {
        const w2 = brainWorld(over);
        const v2 = voiceSide(w2, said, o);
        await webhook(voiceBody('vf'), v2.io, w2);
        check(label, w2.sent.length === 1 && w2.sent[0].includes(`I heard: "${said}"`) && /Reply \*YES\*/.test(w2.sent[0]) && v2.stored()?.pending?.text === said && v2.rec.audits[0]?.route === 'confirm' && w2.exec.length === 0,
            { sent: w2.sent, pending: v2.stored()?.pending, audit: v2.rec.audits[0] });
        return { w2, v2 };
    };
    await fallsBack('a room request (brain hands off) → YES? first', {}, 'Book the boardroom for tomorrow.');
    await fallsBack('the AI is down → YES? first', { aiDown: true }, 'Show my tasks.');
    await fallsBack('Smart chat is OFF for their department → YES? first', { depts: new Set(['d9']) }, 'Show my tasks.');
    await fallsBack('a room / ticket conversation is open → YES? first', { facility: true }, 'Show my tasks.');
    let r = await fallsBack('the brain hand-off throws → YES? first, no crash', {}, 'Show my tasks.', { brainThrows: true });
    r = await fallsBack('some words unclear → the brain is NOT tried; YES? first', {}, 'Give [unclear] a task.', { tidy: { unclear: true } });
    check('…and the brain really was not asked', r.v2.rec.brainTries === 0 && r.w2.understand === 0);
    r = await fallsBack('tidy-up failed (raw text) → the brain is NOT tried; YES? first', {}, 'um give lohit task', { tidy: { cleaned: false } });
    check('…and the brain really was not asked', r.v2.rec.brainTries === 0);

    r = await fallsBack(`download + Whisper + tidy-up already took over ${V.BRAIN_BUDGET_MS / 1000} s → the brain is skipped; YES? first (stays inside the 120 s limit)`, {}, 'Show my tasks.', { slowMs: V.BRAIN_BUDGET_MS + 1 });
    check('…and the brain really was not asked', r.v2.rec.brainTries === 0);
    r = await fallsBack(`(control) just under ${V.BRAIN_BUDGET_MS / 1000} s → the brain is still tried`, { depts: new Set(['d9']) }, 'Show my tasks.', { slowMs: V.BRAIN_BUDGET_MS - 1 });
    check('…and the brain was asked', r.v2.rec.brainTries === 1);

    const yesFlow = await fallsBack('(setup) brain down at voice time', { aiDown: true }, 'Show my tasks.');
    yesFlow.w2.aiDown = false;
    route = await webhook(textBody('haan', 't5'), yesFlow.v2.io, yesFlow.w2);
    check('YES on the fallback → the tidy text goes on as typed (here the brain, now back up, answers)', route === 'voice-yes→brain' && yesFlow.w2.sent.length === 2 && yesFlow.w2.sent[1].startsWith('Okay, here you go') && !yesFlow.v2.stored()?.pending, { route, sent: yesFlow.w2.sent });

    console.log('\n5. A newer voice note replaces an older waiting one');
    w = brainWorld();
    v = voiceSide(w, 'Show my tasks.', { state: { pending: { text: 'old note', voiceMessageId: 'v0', expiresAt: T0 + 60_000 }, recentAt: [], recentIds: [], answered: null } });
    await webhook(voiceBody('v9'), v.io, w);
    check('brain took the new one → the old waiting note is cleared', v.stored()?.pending === null && w.sent.length === 1, v.stored());

    console.log('\n6. Isolation');
    check('nothing reached the real network', net.length === 0, net);
    check('no log line contains what was said', !warned.some(w2 => /lohit|rfid|boardroom|show my tasks/i.test(w2)), warned.filter(w2 => /lohit|rfid|boardroom|show my tasks/i.test(w2)));

    console.warn = warn;
    console.log(failures === 0 ? '\nALL VOICE PHASE 3 CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
}

run().catch(err => { console.error(err); process.exit(1); });
