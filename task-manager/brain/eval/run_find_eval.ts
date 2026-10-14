/**
 * Runs the 40 "look up tasks" questions (findCases.ts) against the REAL AI and scores the filters it fills in.
 * Uses only the made-up worlds in worlds.ts: no database, no WhatsApp. A test tool, never part of the app.
 * Run: npx tsx -r dotenv/config task-manager/brain/eval/run_find_eval.ts dotenv_config_path=.env.local
 */
import { runBrain } from '../index';
import { engyBrainLlm } from '../llm';
import { DEFAULT_DOMAINS } from '../index';
import { tasksDomainWithTeam } from '../tasksDomain';
import { facilityDomain } from '../facilityDomain';
import { world } from './worlds';
import { FIND_CASES, FindCase } from './findCases';
import type { BrainContext, Decision } from '../types';

const same = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

function score(c: FindCase, intent: string | undefined, d: Decision | null): string[] {
    const bad: string[] = [];
    if (!intent || !c.intent.includes(intent as never)) bad.push(`intent ${intent} not in [${c.intent}]`);
    if (!d || !c.outcome.includes(d.outcome)) bad.push(`outcome ${d?.outcome}${d && 'reason' in d ? `/${d.reason}` : ''} not in [${c.outcome}]`);
    const action = d && 'action' in d ? d.action : null;
    if (c.mustNotMutate && action && ['complete_tasks', 'progress_update', 'create_tasks', 'hand_over_task', 'delete_tasks', 'rename_task', 'batch'].includes(action.type)) bad.push('UNSAFE: proposed a change');
    const q = action?.type === 'find_tasks' ? action.query : null;
    if (c.q && intent === 'find_tasks' && q) {
        const e = c.q;
        if (e.ids && !same(q.employeeIds, e.ids)) bad.push(`people [${q.employeeIds}] ≠ [${e.ids}]`);
        if (e.includes && !e.includes.every(id => q.employeeIds.includes(id))) bad.push(`people [${q.employeeIds}] missing some of [${e.includes}]`);
        for (const k of ['status', 'dateField', 'from', 'to', 'givenById', 'showAs', 'overdueOnly', 'minDaysOld', 'kind'] as const) {
            if (e[k] !== undefined && q[k] !== e[k]) bad.push(`${k} ${q[k]} ≠ ${e[k]}`);
        }
        if (e.words && !e.words.every(w => q.words.some((x: string) => x.includes(w)))) bad.push(`words [${q.words}] missing [${e.words}]`);
    }
    return bad;
}

async function main() {
    const llm = engyBrainLlm();
    const domains = [tasksDomainWithTeam, facilityDomain];   // live today: Team reports ON
    void DEFAULT_DOMAINS;
    let pass = 0; let unsafe = 0; const fails: string[] = [];
    const started = Date.now();
    for (let i = 0; i < FIND_CASES.length; i += 4) {
        const batch = FIND_CASES.slice(i, i + 4);
        const results = await Promise.all(batch.map(async c => {
            const ctx: BrainContext = { ...world(c.world ?? 'default'), pending: null, recent: [] };
            const r = await runBrain(c.message, ctx, { llm, domains, skipReply: true });
            return { c, intent: r.interpretation?.intent, d: r.decision };
        }));
        for (const { c, intent, d } of results) {
            const bad = score(c, intent, d);
            if (bad.some(b => b.startsWith('UNSAFE'))) unsafe++;
            if (!bad.length) pass++;
            else fails.push(`${c.id} "${c.message}": ${bad.join('; ')}`);
        }
    }
    console.log(`\nfind_tasks eval: ${pass}/${FIND_CASES.length} passed, unsafe ${unsafe}, ${((Date.now() - started) / 1000).toFixed(0)} s`);
    for (const f of fails) console.log('  ✗', f);
}
main().catch(e => { console.error(e); process.exit(1); });
