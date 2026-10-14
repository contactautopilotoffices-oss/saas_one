/**
 * Group 2 — faster replies (OFFLINE: fake models with timers, fake data reads; no network, no database, no WhatsApp).
 * Checks: (1) a slow AI no longer holds the reply — the backup starts after a short wait and the first good answer wins;
 * (2) independent data reads run side by side; (3) each step's time is recorded (times only).
 * Run: npx tsx task-manager/tests/test_speed_group2.ts
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key-offline-test';

let failures = 0;
const check = (n: string, ok: boolean, x?: unknown) => { if (ok) console.log(`  ✓ ${n}`); else { failures++; console.error(`  ✗ ${n}`, x ?? ''); } };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function run() {
    const net: string[] = [];
    (globalThis as any).fetch = async (u: any) => { net.push(String(u)); throw new Error('network must not be used'); };
    const { withModelFallback, HEDGE_UNDERSTAND_MS, HEDGE_REPLY_MS } = await import('../brain/llm');
    const L = await import('../brain/live');
    const { world } = await import('../brain/eval/worlds');
    const quiet = console.warn; console.warn = () => {};

    console.log('\n1. A slow AI no longer holds the reply');
    const models = ['main', 'backup'];
    const fake = (timing: Record<string, { ms: number; fail?: boolean }>, calls: string[]) => async (m: string) => {
        calls.push(m); await sleep(timing[m].ms); if (timing[m].fail) throw new Error(`${m} down`); return `answer from ${m}`;
    };
    let calls: string[] = []; let t = Date.now();
    let r = await withModelFallback(models, fake({ main: { ms: 400 }, backup: { ms: 30 } }, calls), 'x', { hedgeMs: 60 });
    check('main stalls → backup starts after the short wait and its answer is used (not after the full stall)', r.value === 'answer from backup' && Date.now() - t < 250, { v: r.value, ms: Date.now() - t });
    calls = []; t = Date.now();
    r = await withModelFallback(models, fake({ main: { ms: 20 }, backup: { ms: 20 } }, calls), 'x', { hedgeMs: 60 });
    check('main answers quickly → the backup is never called (no extra cost)', r.value === 'answer from main' && JSON.stringify(calls) === '["main"]', calls);
    calls = []; t = Date.now();
    r = await withModelFallback(models, fake({ main: { ms: 5, fail: true }, backup: { ms: 20 } }, calls), 'x', { hedgeMs: 500 });
    check('main errors → backup starts at once (no waiting)', r.value === 'answer from backup' && Date.now() - t < 200 && r.trace.failures.length === 1, { ms: Date.now() - t, f: r.trace.failures });
    calls = [];
    r = await withModelFallback(models, fake({ main: { ms: 90 }, backup: { ms: 400 } }, calls), 'x', { hedgeMs: 40 });
    check('main is a bit slow but still first → main\'s answer is used', r.value === 'answer from main' && JSON.stringify(calls) === '["main","backup"]', calls);
    let err = '';
    try { await withModelFallback(models, fake({ main: { ms: 5, fail: true }, backup: { ms: 5, fail: true } }, []), 'x', { hedgeMs: 40 }); } catch (e) { err = String(e); }
    check('both fail → one clear error naming both (the caller falls back as before)', /every model failed/.test(err) && /main down/.test(err) && /backup down/.test(err), err);
    calls = [];
    r = await withModelFallback(models, fake({ main: { ms: 80 }, backup: { ms: 5 } }, calls), 'x');
    check('without a wait set → strictly one after another, exactly as before', r.value === 'answer from main' && JSON.stringify(calls) === '["main"]', calls);
    check('the waits: understand 5 s, reply 4 s (the AI normally answers in 1–4 s)', HEDGE_UNDERSTAND_MS === 5000 && HEDGE_REPLY_MS === 4000);

    console.log('\n2. Data is loaded side by side, and every step is timed');
    const emp = { id: 'u1', name: 'Priyanka Shah', department_id: 'd1', department_name: 'Procurement', role: 'employee' } as any;
    const DELAY = 60;
    const slow = async <T>(v: T) => { await sleep(DELAY); return v; };
    const audits: any[] = []; const sent: string[] = [];
    const llm = { complete: async (req: any) => {
        if (/Reply with JSON only: \{"text"/.test(req.system)) return { text: JSON.stringify({ text: 'Hi there.' }), tokensIn: 1, tokensOut: 1 };
        return { text: JSON.stringify({ intent: 'smalltalk', slots: {}, summary: 'Hi', confidence: 0.95, language: 'en', ambiguities: [], clarify_question: null }), tokensIn: 1, tokensOut: 1 };
    } };
    const io: any = {
        getSmartChatDepartments: () => slow(new Set(['d1'])), getEmployee: () => slow(emp),
        checkAccess: () => slow({ allowed: true }), getConfig: () => slow({ enabled: false, employees: [] }),
        getState: () => slow(null), facilityActive: () => slow(false), readConversation: () => slow([] as string[]),
        frontDoorOn: () => slow(false), teamReportsOn: () => slow(false), openPingPending: async () => null,
        buildContext: async (_e: any, _p: string, o: any) => ({ ...world('default'), pending: o.pending, recent: o.recent }),
        setState: async () => {}, clearState: async () => {}, brain: { llm },
        exec: { setStatus: async () => {}, assign: async () => {}, handOver: async () => ({ toName: '' }), readPerson: async () => null, readInsight: async () => '' },
        reply: async (_p: string, x: string) => { sent.push(x); }, audit: async (d: any) => { audits.push(d); }, seenBefore: () => false, markSeen: () => {},
    };
    const body = { topic: 'message.sender.user', data: { messages: [{ phone_number: '919999900002', id: 'sp1', message_type: 'text', text: { body: 'hello there' } }] } };
    t = Date.now();
    const claim = await L.claimSmartChat(body, io);
    const took = Date.now() - t;
    // 9 reads of 60 ms: one after another ≈ 540 ms; side by side in 3 rounds ≈ 180 ms.
    check('9 reads that used to run one by one now take ~3 rounds, not 9', claim.handled && took < DELAY * 6, { took });
    await claim.background!();
    const steps = audits[0]?.steps;
    check('the audit row records each step\'s time (load, understand, act, reply, save, send) — times only', steps && ['load', 'understand', 'act', 'reply', 'save', 'send'].every(k => k in steps) && typeof steps.load === 'number' && steps.load >= DELAY, steps);
    check('…and no message text in it', !JSON.stringify(audits[0]).includes('hello there'));
    const io2 = { ...io, getSmartChatDepartments: () => slow(new Set<string>()) };
    check('no department with Smart chat ON → still not handled (the old bot answers, as before)', !(await L.claimSmartChat(body, io2)).handled);
    const io3 = { ...io, facilityActive: () => slow(true) };
    check('a room / ticket conversation open → still left to the facility assistant', !(await L.claimSmartChat(body, io3)).handled);

    console.warn = quiet;
    check('no network used', net.length === 0, net);
    console.log(failures === 0 ? '\n🎉 GROUP 2 SPEED TESTS PASSED\n' : `\n❌ ${failures} FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
