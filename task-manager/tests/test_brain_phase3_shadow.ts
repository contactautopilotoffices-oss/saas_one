/**
 * Phase 3 — shadow mode (100% OFFLINE: fake data, a scripted fake AI, a recorder for the one audit row; no network, no database,
 * no WhatsApp). Run: npx tsx task-manager/tests/test_brain_phase3_shadow.ts
 */
import fs from 'node:fs';
import path from 'node:path';

let failures = 0;
const check = (n: string, ok: boolean, x?: unknown) => { if (ok) console.log(`  ✓ ${n}`); else { failures++; console.error(`  ✗ ${n}`, x ?? ''); } };

async function run() {
    const net: string[] = [];
    (globalThis as any).fetch = async (u: any) => { net.push(String(u)); throw new Error('network must not be used'); };

    const S = await import('../brain/shadow');
    const { runBrain } = await import('../brain/index');
    const { world } = await import('../brain/eval/worlds');

    const PHONE = '918433649199';
    const config = (over: any = {}) => ({ enabled: true, employees: [{ name: 'Sahil', phone: '8433649199' }], ...over }) as any;
    const emp = { id: 'u1', name: 'Priyanka Shah', department_id: 'd1', department_name: 'Procurement', role: 'employee' } as any;

    // ── a fake world + a scripted AI that answers like the real one would ───
    const mk = (over: any = {}) => {
        const w: any = { audits: [] as any[], aiCalls: 0, builds: 0, switchOn: true, cfg: config(), employee: emp, access: { allowed: true }, ...over };
        const llm = { complete: async (req: any) => {
            w.aiCalls++;
            if (/Reply with JSON only: \{"text"/.test(req.system)) return { text: JSON.stringify({ text: 'Here you go: [[list]]' }), tokensIn: 5, tokensOut: 5 };
            return { text: JSON.stringify({ intent: 'view_tasks', confidence: 0.95, language: 'en', slots: { scope: 'self', person: null, department: null }, ambiguities: [], clarify_question: null, summary: 'Show my tasks.' }), tokensIn: 10, tokensOut: 8 };
        } };
        w.io = {
            enabled: () => w.switchOn,
            getConfig: async () => w.cfg,
            getEmployee: async () => w.employee,
            checkAccess: async () => w.access,
            buildContext: async () => { w.builds++; return world('default'); },
            runBrain: (text: string, ctx: any) => runBrain(text, ctx, { llm }),
            audit: async (details: any, e: any) => { w.audits.push({ details, e }); },
        };
        return w;
    };

    console.log('\n1. Who may be watched (pure rule)');
    const D = (over: any = {}) => S.decideShadow({ enabled: true, text: 'show my tasks', phone: PHONE, config: config(), employee: emp, access: { allowed: true }, ...over });
    check('the environment switch is OFF → not watched', D({ enabled: false }).skip === 'switch_off');
    check('an empty message → not watched', D({ text: '   ' }).skip === 'empty_message');
    check('not a registered employee → not watched', D({ employee: null, access: null }).skip === 'not_employee');
    check('Task Manager locked for them → not watched', D({ access: { allowed: false } }).skip === 'locked');
    check('sandbox OFF → NOT watched (shadow only ever runs inside the sandbox)', D({ config: config({ enabled: false }) }).skip === 'sandbox_off');
    check('sandbox ON but a stranger → not watched', D({ phone: '919999999999' }).skip === 'outside_sandbox');
    check('sandbox ON + your number (12 vs 10 digits) → watched', D().run === true);
    check('sandbox ON + the sandbox manager number → watched', D({ config: config({ employees: [], manager: { name: 'm', phone: '+91 84336 49199' } }) }).run === true);

    console.log('\n2. What the old bot is waiting on, in the brain\'s terms');
    check('a pending confirmation → confirm, with its summary', JSON.stringify(S.mapPending({ context_type: 'NL_CONFIRM', context_data: { summary: 'mark 2 as done' } })) === '{"kind":"confirm","summary":"mark 2 as done"}');
    check('a pending confirmation with no summary still works', (S.mapPending({ context_type: 'NL_CONFIRM', context_data: {} }) as any).kind === 'confirm');
    check('a pending "which one?" → pick, with the option labels', JSON.stringify(S.mapPending({ context_type: 'NL_PICK', context_data: { options: [{ label: 'Lohit Kumar (Tech)' }, { label: 'Lohit Mehta' }] } })) === '{"kind":"pick","options":["Lohit Kumar (Tech)","Lohit Mehta"]}');
    check('a pending import preview → preview, with the count', JSON.stringify(S.mapPending({ context_type: 'IMPORT_PREVIEW', context_data: { tasks: [1, 2, 3] } })) === '{"kind":"preview","count":3}');
    check('anything else, or nothing, or a broken shape → nothing pending', S.mapPending(null) === null && S.mapPending({ context_type: 'DISAMBIGUATION', context_data: {} }) === null && S.mapPending({ context_type: 'NL_PICK', context_data: { options: 'x' } }) === null && S.mapPending({ context_type: 'NL_PICK', context_data: { options: [] } }) === null);

    console.log('\n3. Watching a message');
    let w = mk();
    let r = await S.observeInShadow({ phone: PHONE, text: 'whats pending today', messageId: 'wamid.1' }, w.io);
    check('an eligible message is watched: the brain runs and exactly ONE audit row is written', r === 'logged' && w.audits.length === 1 && w.aiCalls === 2, { r, audits: w.audits.length, ai: w.aiCalls });
    const row = w.audits[0].details;
    check('the row says what the brain understood and would do', row.intent === 'view_tasks' && row.outcome === 'ACT' && row.actionType === 'view_tasks' && row.summary === 'Show my tasks.' && row.status === 'ok', row);
    check('the row carries the messageId so it can be matched with the old bot\'s decision', row.messageId === 'wamid.1');
    check('the row holds the brain\'s drafted reply, with the real task list in it', /1\. Carpet Installation PO \(Pending\)/.test(row.replyText) && row.replySource === 'ai', row.replyText);
    check('PRIVACY: the original words are NOT in the row (only their length)', !JSON.stringify(row).includes('whats pending today') && row.messageChars === 'whats pending today'.length);
    check('the phone number is masked', row.phoneMasked === '****9199' && !JSON.stringify(row).includes('8433649199'));
    check('the row records models, speed and tokens for the evaluation', typeof row.ms === 'number' && row.tokensIn === 15 && row.tokensOut === 13 && row.models.understand === 'glm-5.3-flash');
    check('the audit row is attributed to the sender', w.audits[0].e.id === 'u1');

    console.log('\n4. When it must do nothing at all');
    const skipCase = async (label: string, over: any, text = 'show my tasks') => {
        const x = mk(over); const out = await S.observeInShadow({ phone: PHONE, text }, x.io);
        check(label, out.startsWith('skipped') && x.audits.length === 0 && x.aiCalls === 0 && x.builds === 0, { out, a: x.audits.length, ai: x.aiCalls });
    };
    await skipCase('switch OFF (the default) → nothing read, nothing asked of the AI, nothing logged', { switchOn: false });
    await skipCase('sandbox OFF → nothing happens, not even a brain call', { cfg: config({ enabled: false }) });
    await skipCase('a stranger inside a sandbox-ON system → nothing', { cfg: config({ employees: [{ name: 'x', phone: '9000000000' }] }) });
    await skipCase('an unregistered number → nothing', { employee: null });
    await skipCase('a locked person → nothing', { access: { allowed: false } });
    await skipCase('an empty message → nothing', {}, '  ');
    w = mk({ switchOn: false });
    let touched = 0; for (const k of ['getConfig', 'getEmployee', 'checkAccess', 'buildContext', 'runBrain', 'audit']) { const f = w.io[k]; w.io[k] = (...a: any[]) => { touched++; return f(...a); }; }
    await S.observeInShadow({ phone: PHONE, text: 'hi' }, w.io);
    check('with the switch OFF no data access of any kind is even attempted (zero cost for everyone)', touched === 0);

    console.log('\n5. It can never hurt the old bot');
    w = mk(); w.io.runBrain = async () => { throw new Error('AI exploded'); };
    r = await S.observeInShadow({ phone: PHONE, text: 'show my tasks' }, w.io);
    check('the brain crashing → swallowed, returns "error", no row, no exception', r === 'error' && w.audits.length === 0);
    w = mk(); w.io.audit = async () => { throw new Error('db down'); };
    r = await S.observeInShadow({ phone: PHONE, text: 'show my tasks' }, w.io);
    check('the log write failing → swallowed', r === 'error');
    w = mk(); w.io.buildContext = async () => { throw new Error('db down'); };
    r = await S.observeInShadow({ phone: PHONE, text: 'show my tasks' }, w.io);
    check('building the context failing → swallowed', r === 'error' && w.audits.length === 0);
    w = mk(); w.io.getConfig = async () => { throw new Error('db down'); };
    check('reading the settings failing → swallowed', (await S.observeInShadow({ phone: PHONE, text: 'x' }, w.io)) === 'error');
    w = mk(); w.io.runBrain = async (t: string, c: any) => runBrain(t, c, { llm: { complete: async () => { throw new Error('HTTP 503'); } } });
    r = await S.observeInShadow({ phone: PHONE, text: 'show my tasks' }, w.io);
    check('the AI being unavailable is LOGGED as such (useful to see), still no reply and no error', r === 'logged' && w.audits[0].details.status === 'ai_unavailable' && w.audits[0].details.outcome === null);
    check('real environment switch: unset → skipped without any wiring being loaded', (await S.observeInShadow({ phone: PHONE, text: 'hi' })) === 'skipped:switch_off');

    console.log('\n6. It cannot send, by construction (source checks)');
    const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');
    const src = read('task-manager/brain/shadow.ts');
    const imports = [...src.matchAll(/import\(['"]([^'"]+)['"]\)|from ['"]([^'"]+)['"]/g)].map(m => m[1] || m[2]);
    check('shadow.ts imports nothing that can send a message (no messaging service, no AiSensy, no WhatsApp module)', !imports.some(i => /Messaging|AiSensy|whatsapp|processMessage/i.test(i)) && !/sendMessage|sendFreeform|sendTemplate/.test(src), imports);
    check('it writes through the audit log only (logAudit), nothing else that changes data', /logAudit/.test(src) && !/createTaskAssignment|updateAssignmentStatus|setConversationContext|clearConversationContext|\.insert\(|\.update\(|\.delete\(|\.upsert\(/.test(src));
    const route = read('app/api/webhooks/aisensy/route.ts');
    check('the webhook makes ONE plain call, only for messages that carry text; the module itself schedules it for AFTER the answer (after())', /if \(input\?\.text\) scheduleShadow\(/.test(route) && /after\(async \(\) => \{ await observeInShadow\(input\)/.test(src));
    check('…and AFTER the import claim, so a claimed file is never double-handled', route.indexOf('claimTaskImport(body)') < route.indexOf('scheduleShadow('));
    check('…and nothing from it is awaited or returned, so it cannot change the route\'s response or flow', !/await scheduleShadow|=\s*scheduleShadow|return .*scheduleShadow/.test(route));
    check('outside a web request, scheduling is silently a no-op (never throws)', (() => { try { S.scheduleShadow({ phone: PHONE, text: 'hi' }); return true; } catch { return false; } })());
    const report = read('task-manager/brain/shadow_report.ts');
    check('the report script is read-only (SELECTs only, no writes, no sending)', !/\.insert\(|\.update\(|\.delete\(|\.upsert\(|sendMessage/.test(report) && /\.select\(/.test(report));
    check('nothing in this test touched the network', net.length === 0, net);

    console.log(failures === 0 ? '\n🎉 PHASE 3 SHADOW TESTS PASSED\n' : `\n❌ ${failures} FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
