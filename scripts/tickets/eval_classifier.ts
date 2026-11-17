/**
 * Ticket sorting: which model sorts best? (owner 2026-11-15; doctrine L2: test against the old path on the same cases)
 *
 * READ ONLY. Takes the tickets a person re-sorted by hand (classification_source = 'manual'), so the right answer is
 * known, and sorts each one again with the old keyword rules and with each model given. Nothing is written to the
 * database and no message is sent to anyone. Ticket text goes to the AI providers, as it does when a ticket is created.
 *
 * Run:  npx tsx --env-file=.env.local scripts/tickets/eval_classifier.ts [model ...] [--limit=N]
 * e.g.  npx tsx --env-file=.env.local scripts/tickets/eval_classifier.ts anthropic:claude-haiku-5-5 glm-5.3-flash
 */
import { createClient } from '@supabase/supabase-js';
import { classifyTicketEnhanced } from '@/backend/lib/ticketing/classifyTicket';
import { categoryOptionsFrom, classifyWithAi, type CategoryOption } from '@/backend/lib/ticketing/aiClassifier';

const DEFAULT_MODELS = ['anthropic:claude-haiku-5-5', 'glm-5.3-flash', 'kimi-k3.1-pro'];
const PARALLEL = 4;

interface Case { text: string; property: string | null; code: string | null; team: string | null }

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : '-');

(async () => {
    const args = process.argv.slice(2);
    const limit = Number(args.find(a => a.startsWith('--limit='))?.split('=')[1] ?? 0) || 0;
    const models = args.filter(a => !a.startsWith('--'));
    const chain = models.length ? models : DEFAULT_MODELS;

    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const cats = await db.from('issue_categories').select('code, name, priority, is_active, property_id, skill_group:skill_groups(code)');
    if (cats.error) throw new Error(`category list: ${cats.error.message}`);
    let q = db.from('tickets')
        .select('title, description, property_id, category:issue_categories(code), skill_group:skill_groups(code)')
        .eq('classification_source', 'manual')
        .order('created_at', { ascending: false });
    if (limit) q = q.limit(limit);
    const t = await q;
    if (t.error) throw new Error(`tickets: ${t.error.message}`);

    const one = <T,>(x: T | T[] | null | undefined): T | null => (Array.isArray(x) ? x[0] ?? null : x ?? null);
    type TicketRow = { title: unknown; description: unknown; property_id: string | null; category: unknown; skill_group: unknown };
    const cases: Case[] = ((t.data ?? []) as unknown as TicketRow[]).map(r => ({
        text: [r.title, r.description].map((s: unknown) => String(s ?? '').trim()).filter(Boolean).filter((s: string, i: number, all: string[]) => all.indexOf(s) === i).join('\n'),
        property: r.property_id ?? null,
        code: one<{ code: string }>(r.category)?.code ?? null,
        team: one<{ code: string }>(r.skill_group)?.code ?? null,
    })).filter(c => c.text && (c.code || c.team));
    const optionsFor = new Map<string, CategoryOption[]>();
    const options = (p: string | null) => {
        const k = p ?? '*';
        if (!optionsFor.has(k)) optionsFor.set(k, categoryOptionsFrom((cats.data ?? []) as never, p));
        return optionsFor.get(k)!;
    };
    console.log(`${cases.length} hand-sorted tickets (${cases.filter(c => c.code).length} with a category, ${cases.filter(c => c.team).length} with a team)`);
    // How the hand-sorted answers are spread: one category for most tickets means a default, not real corrections.
    const spread = new Map<string, number>();
    for (const c of cases) spread.set(c.code ?? '(none)', (spread.get(c.code ?? '(none)') ?? 0) + 1);
    console.log('their categories:', [...spread].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '), '\n');

    // The old keyword rules
    let rc = 0, rt = 0;
    for (const c of cases) {
        const r = classifyTicketEnhanced(c.text);
        if (c.code && r.issue_code === c.code) rc++;
        if (c.team && r.skill_group === c.team) rt++;
    }
    const withCode = cases.filter(c => c.code).length, withTeam = cases.filter(c => c.team).length;
    const rows: string[][] = [['keyword rules (old)', pct(rc, withCode), pct(rt, withTeam), '-', '0 ms', '-']];

    for (const model of chain) {
        let okCode = 0, okTeam = 0, failed = 0, tokens = 0;
        const ms: number[] = [];
        const misses: string[] = [];
        for (let i = 0; i < cases.length; i += PARALLEL) {
            await Promise.all(cases.slice(i, i + PARALLEL).map(async c => {
                try {
                    const out = await classifyWithAi(c.text, options(c.property), { chain: [model] });
                    ms.push(out.latencyMs); tokens += out.tokensIn + out.tokensOut;
                    if (c.code && out.verdict.code === c.code) okCode++;
                    else if (c.code) misses.push(`  wanted ${c.code} (${c.team ?? '?'}), got ${out.verdict.code ?? 'other'} (${out.verdict.team}): "${c.text.replace(/\s+/g, ' ').slice(0, 70)}"`);
                    if (c.team && out.verdict.team === c.team) okTeam++;
                } catch (err) {
                    if (!failed) console.log(`  ${model} failed: ${(err instanceof Error ? err.message : String(err)).slice(0, 300)}`);
                    failed++;
                }
            }));
        }
        rows.push([model, pct(okCode, withCode), pct(okTeam, withTeam), String(failed), `${median(ms)} ms`, ms.length ? String(Math.round(tokens / ms.length)) : '-']);
        console.log(`${model}: ${misses.length} wrong categories${misses.length ? ' (first 10):' : ''}`);
        for (const m of misses.slice(0, 10)) console.log(m);
        console.log('');
    }

    const head = ['', 'right category', 'right team', 'failed', 'median time', 'tokens / ticket'];
    const width = head.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length)));
    for (const r of [head, ...rows]) console.log(r.map((x, i) => x.padEnd(width[i])).join('  '));
})().catch(err => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
