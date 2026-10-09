/**
 * Measures the language brain against real models on the labelled English cases.
 *
 *   npx tsx task-manager/brain/eval/run_eval.ts --models qwen3.8-27b,glm-5.3-flash --out <folder> [--concurrency 6] [--only group] [--limit 20]
 *
 * MANUAL tool — it calls the AI provider (the key is read from .env and never printed), so it is NOT part of the normal
 * test run. It sends no WhatsApp message and touches no database: every case runs against a fake in-memory world.
 * Each model is tested ALONE (no fallback) so its numbers are its own.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');
for (const f of ['.env', '.env.local']) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
}

// USD per million tokens, from backend/lib/council/llm.ts (the provider's own published rates)
const PRICE: Record<string, [number, number]> = {
    'deepseek-v4-flash-0731': [0.045, 0.09], 'qwen3.6-35b-a3b': [0.045, 0.3], 'qwen3.8-27b': [0.045, 0.32],
    'glm-5.3-flash': [0.135, 0.45], 'glm-5.2': [0.68, 1.5], 'glm-5.3': [0.98, 3.08], 'kimi-k3': [1.95, 9.75],
};

const arg = (name: string, fallback?: string) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : fallback; };
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const pctl = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0; };

async function main() {
    const models = (arg('models', 'qwen3.8-27b') as string).split(',').map(s => s.trim()).filter(Boolean);
    const outDir = arg('out', path.join(ROOT, 'task-manager', 'brain', 'eval', 'results')) as string;
    const concurrency = Number(arg('concurrency', '6'));
    const only = arg('only');
    const limit = Number(arg('limit', '0'));
    const thinking = (arg('thinking', 'off') === 'default' ? 'default' : 'off') as 'off' | 'default';
    const replyModel = arg('reply-model'); // optional: a different model for writing the reply (default: same as understanding)
    fs.mkdirSync(outDir, { recursive: true });

    const { EVAL_CASES } = await import('./cases');
    const { world } = await import('./worlds');
    const { scoreCase, summarize } = await import('./score');
    const { runBrain } = await import('../index');
    const { engyBrainLlm } = await import('../llm');

    let cases = EVAL_CASES.filter(c => !only || c.group === only);
    if (limit) cases = cases.slice(0, limit);
    const llm = engyBrainLlm({ thinking });
    console.log(`Running ${cases.length} cases × ${models.length} model(s), concurrency ${concurrency}, thinking ${thinking}\n`);

    const all: Record<string, unknown> = {};
    for (const model of models) {
        const t0 = Date.now();
        const rows: any[] = new Array(cases.length);
        let next = 0;
        const worker = async () => {
            for (;;) {
                const i = next++;
                if (i >= cases.length) return;
                const c = cases[i];
                const ctx = world(c.world || 'default', c.pending ?? null);
                const started = Date.now();
                const warn = console.warn; console.warn = () => undefined;
                let result;
                try { result = await runBrain(c.message, ctx, { llm, interpretModels: [model], replyModels: [replyModel || model] }); }
                catch (err) { result = { status: 'ai_unavailable' as const, interpretation: null, decision: null, reply: null, trace: { fastPath: false, interpretModel: null, replyModel: null, interpretMs: 0, replyMs: 0, tokensIn: 0, tokensOut: 0, failures: [String(err)] } }; }
                console.warn = warn;
                const score = scoreCase(c, result as any);
                rows[i] = {
                    id: c.id, group: c.group, message: c.message, pass: score.pass, score,
                    intent: result.interpretation?.intent ?? null, confidence: result.interpretation?.confidence ?? null,
                    outcome: result.decision?.outcome ?? null, reason: (result.decision as any)?.reason ?? null,
                    reply: result.reply ? { text: result.reply.text, source: result.reply.source, problems: result.reply.problems } : null,
                    ms: Date.now() - started, interpretMs: result.trace.interpretMs, replyMs: result.trace.replyMs,
                    tokensIn: result.trace.tokensIn, tokensOut: result.trace.tokensOut, failures: result.trace.failures, fastPath: result.trace.fastPath,
                };
            }
        };
        await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));

        const scores = rows.map(r => r.score);
        const sum = summarize(scores);
        const llmRows = rows.filter(r => !r.fastPath && r.outcome);
        const replies = rows.filter(r => r.reply);
        const price = PRICE[model] || [0, 0];
        const tin = rows.reduce((s, r) => s + r.tokensIn, 0), tout = rows.reduce((s, r) => s + r.tokensOut, 0);
        const usd = (tin * price[0] + tout * price[1]) / 1e6;
        const byGroup: Record<string, string> = {};
        for (const g of [...new Set(rows.map(r => r.group))]) {
            const gr = rows.filter(r => r.group === g);
            byGroup[g] = `${gr.filter(r => r.pass).length}/${gr.length}`;
        }
        const stats = {
            model, replyModel: replyModel || model, thinking, ...sum,
            replyFallbackRate: replies.length ? Math.round((replies.filter(r => r.reply.source === 'fallback').length / replies.length) * 1000) / 10 : 0,
            medianMs: median(rows.map(r => r.ms)), p90Ms: pctl(rows.map(r => r.ms), 0.9),
            medianInterpretMs: median(llmRows.map(r => r.interpretMs)),
            tokensIn: tin, tokensOut: tout, usdPer1000Messages: Math.round((usd / cases.length) * 1000 * 1000) / 1000,
            wallSeconds: Math.round((Date.now() - t0) / 100) / 10, byGroup,
        };
        all[model] = { stats, rows };
        fs.writeFileSync(path.join(outDir, `eval_${model.replace(/[^a-z0-9.-]/gi, '_')}${replyModel ? '__reply_' + replyModel.replace(/[^a-z0-9.-]/gi, '_') : ''}_${thinking}.json`), JSON.stringify({ stats, rows }, null, 2));
        console.log(JSON.stringify(stats));
    }
    fs.writeFileSync(path.join(outDir, 'eval_all.json'), JSON.stringify(all, null, 2));
}
main().catch(e => { console.error('FAILED:', e?.message || e); process.exit(1); });
