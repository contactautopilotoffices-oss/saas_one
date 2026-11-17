/**
 * Otto's rewrite step (task-manager/brain/rewrite.ts). 100% OFFLINE: a scripted fake AI; no network, no database, no WhatsApp.
 * Run: npx tsx task-manager/tests/test_brain_rewrite.ts
 */
export {};
let failures = 0;
const check = (n: string, ok: boolean, x?: unknown) => { if (ok) console.log(`  ✓ ${n}`); else { failures++; console.error(`  ✗ ${n}`, x ?? ''); } };

async function run() {
    const net: string[] = [];
    (globalThis as any).fetch = async (u: any) => { net.push(String(u)); throw new Error('network must not be used'); };
    const RW = await import('../brain/rewrite');
    const { runBrain } = await import('../brain/index');
    const { interpretUserPrompt } = await import('../brain/prompt');
    type Ctx = import('../brain/types').BrainContext;

    const P = (id: string, name: string, department: string) => ({ id, name, department, role: 'employee' });
    const sender = P('u1', 'Sanil Desai', 'HR');
    const people = [sender, P('u2', 'Neeti Shah', 'HR'), P('u3', 'Rushabh Shah', 'HR'), P('u4', 'Sailee Joshi', 'HR'), P('u5', 'Srushti Rao', 'HR')];
    const tasks = [{ n: 1, id: 't1', title: 'Checklist review', status: 'pending' }] as any[];
    const mkCtx = (over: Partial<Ctx> = {}): Ctx => ({ today: '2026-10-21', sender: sender as any, people: people as any, assignableIds: ['u2', 'u3', 'u4', 'u5'], tasks, departments: ['HR'], pending: null, ...over });
    const chat = ['Person: add task call vendor for Rushabh', 'Assistant: Add "call vendor" for Rushabh Shah today?', 'Person: yes', 'Assistant: Done.'];

    /** A fake AI: answers the rewrite with `rewrite`, the understand step with a smalltalk reading, and records what it saw. */
    const fake = (rewrite: string | Error | (() => Promise<string>)) => {
        const seen = { rewriteCalls: 0, understandUser: [] as any[] };
        const llm = { complete: async (req: any) => {
            if (req.system === RW.REWRITE_SYSTEM) {
                seen.rewriteCalls++;
                if (rewrite instanceof Error) throw rewrite;
                const text = typeof rewrite === 'function' ? await rewrite() : rewrite;
                return { text: JSON.stringify({ request: text }), tokensIn: 5, tokensOut: 5 };
            }
            if (/Reply with JSON only: \{"text"/.test(req.system)) return { text: JSON.stringify({ text: 'Okay.' }), tokensIn: 1, tokensOut: 1 };
            seen.understandUser.push(JSON.parse(req.user));
            return { text: JSON.stringify({ intent: 'smalltalk', confidence: 0.9, language: 'en', slots: {}, ambiguities: [], clarify_question: null, summary: 'Chat' }), tokensIn: 1, tokensOut: 1 };
        } };
        return { llm, seen };
    };

    console.log('\n1. The checks on a rewrite (pure)');
    const ctx = mkCtx({ conversation: chat });
    check('"same for Neeti" -> full request is accepted', RW.acceptRewrite('add task call vendor for Neeti', 'same for Neeti', ctx, chat) === 'add task call vendor for Neeti');
    check('a name that is not in the chat is rejected (Srushti never mentioned)', RW.acceptRewrite('add task call vendor for Srushti', 'same for Neeti', ctx, chat) === null);
    check('a number that is not in the chat is rejected', RW.acceptRewrite('add task call vendor for Neeti by 25', 'same for Neeti', ctx, chat) === null);
    check('the same message back is ignored (nothing added)', RW.acceptRewrite('Same for Neeti ', 'same for Neeti', ctx, chat) === null);
    check('empty / not text / too long are rejected', RW.acceptRewrite('', 'x', ctx, chat) === null && RW.acceptRewrite(42, 'x', ctx, chat) === null && RW.acceptRewrite('a'.repeat(400), 'x', ctx, chat) === null);
    check('a task title the sender owns may be used ("that one" -> "Checklist review")', RW.acceptRewrite('mark Checklist review done', 'mark that one done', ctx, ['Person: show my tasks', 'Assistant: 1. Checklist review']) === 'mark Checklist review done');

    console.log('\n2. When the rewrite runs');
    {
        const f = fake('add task call vendor for Neeti');
        const r = await RW.rewriteMessage({ llm: f.llm, message: 'hello there', ctx: mkCtx() });
        check('first message (no earlier chat) -> no AI call at all', r.rewritten === null && f.seen.rewriteCalls === 0);
    }
    for (const kind of ['confirm', 'pick', 'preview'] as const) {
        const f = fake('something');
        const pending: any = kind === 'confirm' ? { kind, summary: 'x' } : kind === 'pick' ? { kind, options: ['a', 'b'] } : { kind, count: 2 };
        const r = await RW.rewriteMessage({ llm: f.llm, message: 'yes', ctx: mkCtx({ conversation: chat, pending }) });
        check(`a question is waiting (${kind}) -> the answer is left alone, no AI call`, r.rewritten === null && f.seen.rewriteCalls === 0);
    }
    {
        const f = fake(new Error('provider down'));
        const r = await RW.rewriteMessage({ llm: f.llm, message: 'same for Neeti', ctx: mkCtx({ conversation: chat }) });
        check('AI fails -> null (bot carries on with the original), never throws', r.rewritten === null && !!r.failure);
    }
    {
        const f = fake(() => new Promise(res => setTimeout(() => res('add task call vendor for Neeti'), 200)));
        const r = await RW.rewriteMessage({ llm: f.llm, message: 'same for Neeti', ctx: mkCtx({ conversation: chat }), timeoutMs: 50 });
        check('AI too slow -> null after the time limit', r.rewritten === null && r.failure === 'rewrite too slow');
    }

    console.log('\n3. Through the real brain');
    {
        const f = fake('add task call vendor for Neeti');
        const res = await runBrain('same for Neeti', mkCtx({ conversation: chat }), { llm: f.llm });
        const u = f.seen.understandUser[0];
        check('the understand step sees the rewrite as a helper', u?.rewritten_request?.text === 'add task call vendor for Neeti' && /trust "message"/.test(u.rewritten_request.how_to_use));
        check('…and the person\'s own words are still the "message"', u?.message === 'same for Neeti');
        check('the trace records the rewrite', res.trace.rewritten === 'add task call vendor for Neeti');
    }
    {
        const f = fake('add task call vendor for Srushti'); // invents a person
        const res = await runBrain('same for Neeti', mkCtx({ conversation: chat }), { llm: f.llm });
        check('a rejected rewrite is never shown to the understand step', f.seen.understandUser[0] && !('rewritten_request' in f.seen.understandUser[0]) && !res.trace.rewritten);
    }
    {
        const f = fake('add task call vendor for Neeti');
        await runBrain('same for Neeti', mkCtx({ conversation: chat }), { llm: f.llm, rewrite: false });
        check('rewrite: false turns it off completely', f.seen.rewriteCalls === 0);
    }
    {
        const c = mkCtx({ conversation: chat });
        check('without a rewrite the understand prompt is byte-identical to before', interpretUserPrompt('same for Neeti', c) === interpretUserPrompt('same for Neeti', c, null));
    }
    check('no network used', net.length === 0, net);

    if (failures) { console.error(`\n❌ ${failures} REWRITE TEST(S) FAILED`); process.exit(1); }
    console.log('\n🎉 REWRITE TESTS PASSED');
}
run().catch(e => { console.error(e); process.exit(1); });
