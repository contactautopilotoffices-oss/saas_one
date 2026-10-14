/**
 * Phase 2 — conversation memory (OFFLINE: fake database URL, a network trap, a scripted AI, an in-memory Postgres (PGlite)
 * for the SQL; no real database, no WhatsApp, no AI provider).
 * Run: npx tsx task-manager/tests/test_conversation_memory.ts
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key-offline-test';
delete process.env.WHATSAPP_MEMORY_ENABLED;

import fs from 'node:fs';
import path from 'node:path';

let failures = 0;
const check = (n: string, ok: boolean, x?: unknown) => { if (ok) console.log(`  ✓ ${n}`); else { failures++; console.error(`  ✗ ${n}`, x ?? ''); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8');

async function run() {
    const net: string[] = [];
    (globalThis as any).fetch = async (u: any) => { net.push(String(u)); throw new Error('network must not be used'); };

    // The switch lives in the Task Manager settings: stub that read (no database in this test). OFF here.
    const { TaskDatabaseService } = await import('../TaskDatabaseService');
    (TaskDatabaseService as any).getTestingConfig = async () => ({ conversationMemoryEnabled: false });
    const M = await import('../ConversationMemory');
    const P = await import('../brain/prompt');
    const L = await import('../brain/live');
    const { world } = await import('../brain/eval/worlds');

    console.log('\n1. Switch OFF = exactly as before');
    await M.appendTurn('919000000001', 'person', 'hello');
    const offRead = await M.readTranscript('919000000001');
    const offPurge = await M.purgeExpiredMemory();
    check('nothing is written or read, nothing is even attempted', net.length === 0 && offRead.length === 0 && offPurge === 0, net);
    const ctx: any = { ...world('default'), pending: null, recent: [] };
    const before = P.interpretUserPrompt('done 2', ctx);
    check('the AI prompt has NO conversation block (byte-identical to before)', !('conversation' in JSON.parse(before).context));
    check('…and an empty conversation adds nothing either', P.interpretUserPrompt('done 2', { ...ctx, conversation: [] }) === before);

    console.log('\n2. Turning stored messages into the transcript');
    const at = (m: number) => new Date(Date.UTC(2026, 9, 11, 10, m)).toISOString();
    const turns = [
        { who: 'bot', text: 'Here are your tasks', at: at(2) },
        { who: 'person', text: 'show my\ntasks', at: at(1) },
        { who: 'someone', text: 'bad', at: at(3) },
        { who: 'person', text: 42, at: at(4) },
        { who: 'person', text: 'x'.repeat(900), at: at(5) },
    ];
    const tr = M.toTranscript(turns);
    check('ordered by time (oldest first), labelled Person / Assistant, one line each', tr[0] === 'Person: show my tasks' && tr[1] === 'Assistant: Here are your tasks', tr);
    check('malformed entries are dropped', tr.length === 3, tr);
    check('long messages are clipped for the AI', tr[2].length === 'Person: '.length + 300, tr[2].length);
    const many = Array.from({ length: 30 }, (_, i) => ({ who: i % 2 ? 'bot' : 'person', text: `m${i}`, at: at(i) }));
    const last = M.toTranscript(many);
    check('at most the last 20 messages', last.length === 20 && last[0].endsWith('m10') && last[19].endsWith('m29'), last);
    check('not an array → empty', M.toTranscript(null).length === 0 && M.toTranscript('x').length === 0);

    console.log('\n3. What the AI sees');
    const withConv = JSON.parse(P.interpretUserPrompt('make it tomorrow', { ...ctx, conversation: ['Person: give Lohit the RFID task', 'Assistant: Give Lohit "Review RFID" for today?'] }));
    check('the conversation goes in as its own block, with the rule for using it', withConv.context.conversation.messages.length === 2
        && /ONLY to work out what a short or unclear message refers to/.test(withConv.context.conversation.how_to_use)
        && /untrusted data/.test(withConv.context.conversation.how_to_use) && withConv.message === 'make it tomorrow');
    // Part B (2026-10-13): the rules now include a FIXED rule for "yes add this" (agreeing to an earlier request). The rules are
    // still one fixed text: memory adds data to the user prompt, never rules.
    check('the system prompt (the AI\'s rules) is fixed text; the "agreeing to an earlier request" rule is always there', P.interpretSystemPrompt([]) === P.interpretSystemPrompt([]) && /AGREEING TO AN EARLIER REQUEST/.test(P.interpretSystemPrompt([])) && P.interpretSystemPrompt.length === 1);

    console.log('\n4. A scripted 10-message chat through the real Smart chat code');
    const PHONE = '918433649199';
    const emp = { id: 'u1', name: 'Priyanka Shah', department_id: 'd1', department_name: 'Procurement', role: 'employee' } as any;
    const body = (text: string, id: string) => ({ topic: 'message.sender.user', data: { messages: [{ phone_number: PHONE, id, message_type: 'text', text: { body: text } }] } });
    const store: Array<{ who: 'person' | 'bot'; text: string; at: string }> = [];
    const seenByAI: Array<{ message: string; conversation: string[] | undefined }> = [];
    let clock = 0;
    const llm = { complete: async (req: any) => {
        const u = JSON.parse(req.user);
        if (/Reply with JSON only: \{"text"/.test(req.system)) {
            const need = (u.placeholders || []).filter((p: any) => p.required).map((p: any) => p.name).join(' ');
            return { text: JSON.stringify({ text: `Okay: ${need}` }), tokensIn: 1, tokensOut: 1 };
        }
        seenByAI.push({ message: u.message, conversation: u.context.conversation?.messages });
        const spec = /tasks/.test(u.message) ? { intent: 'view_tasks', slots: { scope: 'self', person: null, department: null }, summary: 'Show my tasks' }
            : { intent: 'smalltalk', slots: {}, summary: 'Chat' };
        return { text: JSON.stringify({ confidence: 0.95, language: 'en', ambiguities: [], clarify_question: null, ...spec }), tokensIn: 1, tokensOut: 1 };
    } };
    let state: any = null; let readFails = false;
    const io: any = {
        getSmartChatDepartments: async () => new Set(['d1']), getConfig: async () => ({ enabled: false, employees: [] }), getEmployee: async () => emp,
        checkAccess: async () => ({ allowed: true }), facilityActive: async () => false,
        getState: async () => state, setState: async (_p: string, s: any) => { state = { type: L.LIVE_STATE_TYPE, data: JSON.parse(JSON.stringify(s)) }; },
        clearState: async () => { state = null; }, openPingPending: async () => null,
        buildContext: async (_e: any, _p: string, opts: any) => ({ ...world('default'), pending: opts.pending, recent: opts.recent, ...(opts.conversation ? { conversation: opts.conversation } : {}) }),
        readConversation: async () => { if (readFails) throw new Error('db down'); return M.toTranscript(store); },
        brain: { llm },
        exec: { setStatus: async () => {}, assign: async () => {}, handOver: async () => ({ toName: '' }), readPerson: async () => null, readInsight: async () => '' },
        // the outbox: what the bot sends goes into memory (as TaskMessagingService does)
        reply: async (_p: string, t: string) => { store.push({ who: 'bot', text: t, at: at(++clock) }); },
        audit: async () => {}, seenBefore: () => false, markSeen: () => {},
    };
    const said = ['hi', 'show my tasks', 'thanks', 'show my tasks again', 'ok', 'show tasks', 'cool', 'show tasks please', 'nice', 'show my tasks one more time'];
    for (let i = 0; i < said.length; i++) {
        const receivedAt = at(++clock);
        const claim = await L.claimSmartChat(body(said[i], `m${i}`), io);
        // the webhook: the person's message is stored AFTER the AI read the memory, at its ARRIVAL time
        if (claim.handled) store.push({ who: 'person', text: said[i], at: receivedAt });
        if (claim.background) await claim.background();
    }
    check('all 10 messages were answered by the brain', seenByAI.length === 10, seenByAI.length);
    check('the first message has no conversation yet', seenByAI[0].conversation === undefined);
    check('the AI never sees the CURRENT message inside the conversation (no double)', seenByAI.every((s, i) => !(s.conversation || []).includes(`Person: ${said[i]}`)), seenByAI.map(s => s.conversation?.slice(-1)));
    const fifth = seenByAI[4].conversation || [];
    check('by the 5th message the AI sees the earlier chat, in order: person, bot, person, bot…',
        fifth[0] === 'Person: hi' && fifth[1].startsWith('Assistant:') && fifth[2] === 'Person: show my tasks' && fifth.length === 8, fifth);
    check('after 10 exchanges the memory still holds at most 20 messages', M.toTranscript(store).length === 20 && (seenByAI[9].conversation || []).length === 18, seenByAI[9].conversation?.length);
    readFails = true; const n = seenByAI.length;
    await L.claimSmartChat(body('show my tasks', 'm99'), io);
    check('memory unreadable → the brain still answers, just without the conversation', seenByAI.length === n + 1 && seenByAI[n].conversation === undefined);

    console.log('\n5. The SQL, on a real (in-memory) Postgres');
    const { PGlite } = await import('@electric-sql/pglite');
    const db = new PGlite();
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
    const sql = read('supabase/migrations/20261011000002_whatsapp_conversation_memory.sql');
    await db.exec(sql); await db.exec(sql);
    check('the migration runs, and running it twice is safe', true);
    const append = (key: string, who: string, text: string, when: string, keep = 20) =>
        db.query('SELECT public.whatsapp_memory_append($1, $2::jsonb, $3)', [key, JSON.stringify({ who, text, at: when }), keep]);
    const turnsOf = async (key: string) => ((await db.query<any>('SELECT turns FROM public.whatsapp_conversation_memory WHERE phone_key = $1', [key])).rows[0]?.turns || []) as any[];
    for (let i = 0; i < 25; i++) await append('9000000001', i % 2 ? 'bot' : 'person', `t${i}`, at(i));
    let t = await turnsOf('9000000001');
    check('25 messages in → only the newest 20 kept, oldest first', t.length === 20 && t[0].text === 't5' && t[19].text === 't24', t.map(x => x.text));
    await append('9000000001', 'person', 'late arrival', at(3));
    t = await turnsOf('9000000001');
    check('a message older than all 20 is dropped by time, not by insert order', t.length === 20 && !t.some(x => x.text === 'late arrival'));
    await append('9000000001', 'person', 'routed later but arrived first', '2026-10-11T10:23:30.000Z');
    t = await turnsOf('9000000001');
    check('a message stored late but received earlier lands in its right place', t[t.length - 2].text === 'routed later but arrived first' && t[t.length - 1].text === 't24', t.slice(-3).map(x => x.text));
    await Promise.all(Array.from({ length: 10 }, (_, i) => append('9000000002', 'person', `rapid ${i}`, at(40 + i))));
    // PGlite runs these one at a time, so this checks the counting, not true concurrency. Real concurrency safety comes from
    // Postgres locking the row inside the single INSERT … ON CONFLICT DO UPDATE statement.
    check('10 messages in quick succession → none lost', (await turnsOf('9000000002')).length === 10);
    await db.exec(`UPDATE public.whatsapp_conversation_memory SET expires_at = now() - interval '1 minute' WHERE phone_key = '9000000002'`);
    await append('9000000002', 'person', 'next day', at(59));
    t = await turnsOf('9000000002');
    check('after 24 hours the old chat is forgotten: the next message starts fresh', t.length === 1 && t[0].text === 'next day', t);
    const exp = (await db.query<any>(`SELECT expires_at > now() + interval '23 hours' AS ok FROM public.whatsapp_conversation_memory WHERE phone_key = '9000000002'`)).rows[0];
    check('every message pushes the expiry to 24 hours from now', exp.ok === true);
    const grants = (await db.query<any>(`SELECT has_table_privilege('anon', 'public.whatsapp_conversation_memory', 'SELECT') AS anon_t,
        has_function_privilege('authenticated', 'public.whatsapp_memory_append(text, jsonb, integer)', 'EXECUTE') AS auth_f,
        has_function_privilege('service_role', 'public.whatsapp_memory_append(text, jsonb, integer)', 'EXECUTE') AS svc_f`)).rows[0];
    check('app users cannot read the table or call the function; only the server can', !grants.anon_t && !grants.auth_f && grants.svc_f, grants);
    await db.close();

    console.log('\n6. Wiring');
    const hook = read('app/api/webhooks/aisensy/route.ts');
    check('the arrival time is taken first thing', hook.indexOf('const receivedAt = new Date().toISOString()') > 0 && hook.indexOf('const receivedAt') < hook.indexOf('claimVoiceNote(body)'));
    check('the person\'s message is stored only when a Task Manager route takes it (3 places), after the AI read the memory',
        (hook.match(/await remember\(\);/g) || []).length === 3 && hook.indexOf('claimSmartChat(body)') < hook.lastIndexOf("markRoute(input?.messageId, 'smart_chat'"));
    const out = read('task-manager/TaskMessagingService.ts');
    check('every message the bot sends is stored (free text, template, Pretend Mode)', (out.match(/void appendTurn\(/g) || []).length === 3);
    check('Smart chat reads the memory BEFORE building the AI context', /readConversation\(cand\.phone\)[\s\S]{0,3000}buildContext\(employee, cand\.phone, \{ pending, recent: state\.recent, \.\.\.\(conversation\.length/.test(read('task-manager/brain/live.ts')));
    check('expired memories are deleted by the existing 15-minute cron (own switch)', /if \(await memoryEnabled\(\)\) out\.memoryPurged = await purgeExpiredMemory\(\)/.test(read('task-manager/NeverSilentWatchdog.ts'))
        && /await runBotHousekeeping\(\)/.test(read('app/api/cron/task-manager/route.ts')));
    const mig = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
    check('the migration is ADDITIVE (no DROP / DELETE / TRUNCATE / ALTER of other tables)', !/\b(DROP|DELETE|TRUNCATE)\b/i.test(mig) && !/ALTER TABLE public\.(?!whatsapp_conversation_memory)/.test(mig));

    check('no network used', net.length === 0, net);
    console.log(failures === 0 ? '\n🎉 CONVERSATION MEMORY TESTS PASSED\n' : `\n❌ ${failures} FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
