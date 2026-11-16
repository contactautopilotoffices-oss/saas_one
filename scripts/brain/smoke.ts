/**
 * Unified Brain: a real-model smoke test. Proves that the Claude connection, the tool schemas and the turn loop work
 * with a live model. It uses FAKE ticket and room data (the test fakes), so it reads and writes no database, and it
 * has no sender, so it cannot send a WhatsApp message. It spends a few cents of model credit.
 *
 *   npx tsx --env-file=.env scripts/brain/smoke.ts [model ...]
 *
 * Keys are read from the environment by name and are never printed.
 */
import { runTurn } from '../../backend/lib/aiLayer/brain/loop/turn';
import { anthropicBrainModel, brainClaudeKeys, keyPoolStatus } from '../../backend/lib/aiLayer/brain/providers/anthropic';
import { FakeAudit, FakeBrainData, ScriptedModel, actor, brainSettings, ticket, turnInput } from '../../tests/ai-layer/brain-helpers';

void ScriptedModel;

const MODELS = process.argv.slice(2).length ? process.argv.slice(2) : ['anthropic:claude-haiku-5-5', 'anthropic:claude-sonnet-5-5', 'anthropic:claude-opus-5-5'];

const CASES: Array<{ name: string; text: string; expect: string }> = [
    { name: 'read then answer', text: 'what happened to my AC complaint?', expect: 'answer after tickets_list' },
    { name: 'propose a ticket', text: 'the washroom tap is leaking on the 2nd floor, please raise a ticket', expect: 'propose ticket.create' },
    { name: 'tasks are handed over', text: 'mark my DG set task as done', expect: 'handoff to tasks_assistant' },
];

async function main() {
    const keys = brainClaudeKeys();
    console.log(`Claude keys set: ${keys.map(k => `key ${k.slot}`).join(', ') || 'none'}`);
    if (!keys.length) { console.error('No Claude key in the environment. Nothing was called.'); process.exit(1); }
    const model = anthropicBrainModel({ keys: () => brainClaudeKeys() });
    let failed = 0;
    for (const id of MODELS) {
        console.log(`\n=== ${id} ===`);
        for (const c of CASES) {
            const data = new FakeBrainData(); data.tickets = [ticket()];
            const started = Date.now();
            try {
                const out = await runTurn(
                    { data, model, audit: new FakeAudit(), chain: async () => [id], now: () => new Date(), allowMessage: () => true },
                    turnInput(c.text, { actor: actor(), settings: brainSettings(), channel: 'app_chat' }),
                );
                const t = out.trace;
                const hop = t.hops.map(h => h.error).join(' | ');
                if (out.outcome === 'error') failed++;
                console.log(`- ${c.name}: outcome=${out.outcome}${out.handoffTo ? `(${out.handoffTo})` : ''} skill=${t.skillId ?? '-'} tools=[${t.toolCalls.map(x => `${x.skillId}${x.ok ? '' : '!'}`).join(', ')}]`
                    + ` calls=${t.modelCalls.length} in=${t.tokensIn} out=${t.tokensOut} cacheRead=${t.modelCalls.reduce((n, m) => n + m.cacheRead, 0)} cost=$${(t.costUsd ?? 0).toFixed(4)} grounded=${t.grounded} ${Date.now() - started}ms`);
                console.log(`  expected: ${c.expect}`);
                console.log(`  reply: ${(out.reply?.text ?? '(none)').replace(/\n/g, ' / ').slice(0, 260)}`);
                if (hop) console.log(`  problem: ${hop}`);
                if (data.created.length) console.log('  !! a ticket was created without a Yes');
            } catch (err) {
                failed++;
                console.log(`- ${c.name}: FAILED ${(err instanceof Error ? err.message : String(err)).slice(0, 300)}`);
            }
        }
    }
    const resting = keyPoolStatus();
    if (resting.length) console.log(`\nKeys resting: ${resting.map(r => `key ${r.slot} (${r.why})`).join(', ')}`);
    console.log(failed ? `\n${failed} case(s) did not get a model answer.` : '\nEvery case got a model answer.');
    process.exit(failed ? 1 : 0);
}

void main();
