/**
 * Ticket sorting that learns (owner 2026-11-19, Phase 4): the old way and the new way on the same tickets, before the
 * setting is switched on (doctrine L2: build both and test them on the same dataset `[BAA pp.94–95, 99]`).
 *
 * READ ONLY. Nothing is written and no message is sent. Ticket text goes to the AI providers, as creating a ticket does.
 *
 * Honest by time: the tickets whose right category is known (judged in Review, or re-sorted with Override) are replayed
 * oldest first. Each is sorted
 *   the old way: the newest 30 corrections made BEFORE that ticket came in, and the AI's own rating;
 *   the new way: only examples made before that ticket (never its own), the repeat shortcut, and confidence measured
 *                from the track record known at that time (earlier judgements, plus the new way's own earlier results
 *                in this run).
 * Similar tickets are found by words (meaning search needs stored embeddings and is measured in watch-only mode).
 *
 * Run:  npx tsx --env-file=.env.local scripts/tickets/backtest_learning.ts [--limit=150] [--org=<id>] [--model=<id>]
 *       --limit = how many of the newest known tickets are tested (all earlier ones still count as memory)
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { categoryOptionsFrom, classifyWithAi, CONFIDENCE_HIGH, MAX_CORRECTIONS, type CategoryOption, type Correction } from '@/backend/lib/ticketing/aiClassifier';
import { calibrationFrom, type Example } from '@/backend/lib/ticketing/sortLearning';
import { calibration, type Calibration } from '@/backend/lib/ticketing/sortLearningStats';
import { sortNewWay } from '@/backend/lib/ticketing/sortLearningRun';
import { ticketText } from '@/backend/lib/ticketing/sortReview';
import { maskIdentity } from '@/backend/lib/aiLayer/brain/console/view';
import type { SkillGroup } from '@/backend/lib/ticketing/classifyTicket';

type Row = Record<string, unknown>;
const PAGE = 1000;
const IN_CHUNK = 100;
const args = process.argv.slice(2);
const opt = (n: string) => args.find(a => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const LIMIT = Number(opt('limit') ?? 150) || 150;
const ORG = opt('org') ?? null;
const MODEL = opt('model') ?? null;
const TEAMS = ['technical', 'plumbing', 'vendor', 'soft_services'];
const asTeam = (x: unknown) => (TEAMS.includes(String(x)) ? (x as SkillGroup) : null);
const str = (x: unknown): string | null => (typeof x === 'string' && x.trim() ? x : null);
const one = <T,>(x: T | T[] | null | undefined): T | null => (Array.isArray(x) ? x[0] ?? null : x ?? null);
const short = (s: string, n = 60) => s.replace(/\s+/g, ' ').trim().slice(0, n);

async function all(build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<Row[]> {
    const rows: Row[] = [];
    for (let from = 0; ; from += PAGE) {
        const { data, error } = await build(from, from + PAGE - 1);
        if (error) throw new Error(error.message);
        rows.push(...((data ?? []) as Row[]));
        if (!data || data.length < PAGE) return rows;
    }
}
async function byIds(db: SupabaseClient, table: string, cols: string, ids: string[]): Promise<Row[]> {
    const out: Row[] = [];
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
        const { data, error } = await db.from(table).select(cols).in('id', ids.slice(i, i + IN_CHUNK));
        if (error) throw new Error(`${table}: ${error.message}`);
        out.push(...((data ?? []) as unknown as Row[]));
    }
    return out;
}

/** A ticket whose right category is known, and when that became known (`learnedAt`). */
interface Known { ticketId: string; org: string; property: string | null; sortedAt: string; learnedAt: string; text: string; truth: string; team: SkillGroup | null; source: Example['source']; review: Row | null }

function printCal(title: string, c: Calibration) {
    console.log(`\n  ${title}: accuracy ${c.accuracy ?? '-'}%, sent to Review ${c.toReview} of ${c.tickets}, wrong but rated High ${c.wrongButHigh}, average gap said-vs-real ${c.averageGap ?? '-'} points`);
    for (const b of c.bands.filter(x => x.tickets)) console.log(`    ${b.band.padEnd(8)} ${String(b.tickets).padStart(4)} tickets  said ${String(b.saidAvg).padStart(3)}%  right ${b.actuallyRight === null ? '  -' : String(b.actuallyRight).padStart(3)}%`);
}

(async () => {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const cats = await all((a, b) => db.from('issue_categories').select('id, code, name, priority, is_active, property_id, skill_group:skill_groups(code)').range(a, b));
    const catById = new Map(cats.map(c => [String(c.id), c]));
    const reviews = await all((a, b) => { let q = db.from('ticket_sort_reviews').select('organization_id, ticket_id, ticket_text, sorted_by, verdict, chosen_code, chosen_team, chosen_confidence, right_code, right_team, created_at'); if (ORG) q = q.eq('organization_id', ORG); return q.range(a, b); });
    const reviewed = new Set(reviews.map(r => str(r.ticket_id)).filter(Boolean) as string[]);
    const logs = await all((a, b) => db.from('ticket_activity_log').select('ticket_id, old_value, new_value, created_at').eq('action', 'classification_override').order('created_at', { ascending: true }).range(a, b));
    const latest = new Map<string, Row>();
    for (const l of logs) if (str(l.ticket_id) && !reviewed.has(String(l.ticket_id)) && str(l.old_value) !== str(l.new_value)) latest.set(String(l.ticket_id), l);
    const tickets = new Map((await byIds(db, 'tickets', 'id, organization_id, property_id, created_at, title, description', [...reviewed, ...latest.keys()])).map(t => [String(t.id), t]));

    const known: Known[] = [];
    for (const r of reviews) {
        const t = tickets.get(String(r.ticket_id ?? ''));
        const wrong = r.verdict === 'wrong';
        const truth = wrong ? str(r.right_code) : str(r.chosen_code);
        if (!t || !truth || !str(r.ticket_text)) continue;
        known.push({ ticketId: String(t.id), org: String(r.organization_id), property: str(t.property_id), sortedAt: String(t.created_at), learnedAt: String(r.created_at), text: String(r.ticket_text), truth, team: asTeam(wrong ? r.right_team : r.chosen_team), source: wrong ? 'judged_wrong' : 'judged_right', review: r });
    }
    for (const [id, l] of latest) {
        const t = tickets.get(id);
        const cat = catById.get(String(l.new_value ?? ''));
        const truth = str(cat?.code);
        const text = t ? maskIdentity(ticketText(t), 1000) ?? '' : '';
        if (!t || !truth || !text.trim() || (ORG && t.organization_id !== ORG)) continue;
        known.push({ ticketId: id, org: String(t.organization_id), property: str(t.property_id), sortedAt: String(t.created_at), learnedAt: String(l.created_at), text, truth, team: asTeam(one(cat?.skill_group as Row | Row[] | null)?.code), source: 'override', review: null });
    }
    known.sort((a, b) => a.sortedAt.localeCompare(b.sortedAt));
    const tests = known.slice(-LIMIT);
    console.log(`${known.length} tickets with a known right category; testing the newest ${tests.length}, oldest first. READ ONLY.`);

    const optionsFor = new Map<string, CategoryOption[]>();
    const options = (p: string | null) => { const k = p ?? '*'; if (!optionsFor.has(k)) optionsFor.set(k, categoryOptionsFrom(cats as never, p)); return optionsFor.get(k)!; };
    const deps = MODEL ? { chain: [MODEL] } : {};
    const results = { old: [] as Array<{ confidence: number; right: boolean }>, now: [] as Array<{ confidence: number; right: boolean }> };
    const newOwn: Array<{ org: string; at: string; confidence: number; right: boolean }> = [];
    let shortcuts = 0, shortcutRight = 0, failed = 0, newHelped = 0, newHurt = 0;
    const changes: string[] = [];

    for (let i = 0; i < tests.length; i++) {
        const c = tests[i];
        const before = known.filter(k => k.org === c.org && k.learnedAt < c.sortedAt && k.ticketId !== c.ticketId);
        const corrections: Correction[] = before.filter(k => k.source === 'judged_wrong').sort((a, b) => b.learnedAt.localeCompare(a.learnedAt)).slice(0, MAX_CORRECTIONS).map(k => ({ text: k.text, code: k.truth, team: k.team }));
        const examples: Example[] = before.map(k => ({ id: k.ticketId, ticketId: k.ticketId, propertyId: k.property, text: k.text, code: k.truth, team: k.team, source: k.source, at: k.learnedAt }));
        const history = [
            ...before.filter(k => k.review && k.review.sorted_by === 'ai' && typeof k.review.chosen_confidence === 'number').map(k => ({ confidence: k.review!.chosen_confidence as number, right: k.review!.verdict === 'right' })),
            ...newOwn.filter(n => n.org === c.org && n.at < c.sortedAt).map(n => ({ confidence: n.confidence, right: n.right })),
        ];
        const opts = options(c.property);
        try {
            // As in production: with no examples yet the new way is the old way.
            const [old, learned] = await Promise.all([
                classifyWithAi(c.text, opts, deps, corrections),
                examples.length ? sortNewWay(c.text, opts, c.org, { mode: 'live', meaning: false }, deps, { examples, calibration: calibrationFrom(history) }) : Promise.resolve(null),
            ]);
            const nw = learned ?? { verdict: old.verdict, method: 'old' as const, modelConfidence: null };
            const oldOk = old.verdict.code === c.truth, newOk = nw.verdict.code === c.truth;
            results.old.push({ confidence: old.verdict.confidence, right: oldOk });
            results.now.push({ confidence: nw.verdict.confidence, right: newOk });
            if (nw.method === 'shortcut') { shortcuts++; if (newOk) shortcutRight++; }
            else if (nw.modelConfidence !== null) newOwn.push({ org: c.org, at: c.learnedAt, confidence: nw.modelConfidence, right: newOk });
            if (newOk && !oldOk) newHelped++;
            if (!newOk && oldOk) newHurt++;
            if (newOk !== oldOk && changes.length < 15) changes.push(`   ${newOk ? 'fixed' : 'BROKE'}: "${short(c.text)}" right ${c.truth}; old ${old.verdict.code ?? 'other'} ${old.verdict.confidence}%, new ${nw.verdict.code ?? 'other'} ${nw.verdict.confidence}%${nw.method === 'shortcut' ? ' (shortcut)' : ''}`);
        } catch (err) {
            if (!failed) console.log(`  a sorting failed: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`);
            failed++;
        }
        process.stdout.write(`\r  ${i + 1} of ${tests.length}`);
    }
    console.log(failed ? `\n  ${failed} could not be sorted (left out).` : '');
    printCal('OLD way (newest 30 corrections, the AI\'s own rating)', calibration(results.old, CONFIDENCE_HIGH));
    printCal('NEW way (similar examples, measured confidence, repeats)', calibration(results.now, CONFIDENCE_HIGH));
    console.log(`\n  The new way fixed ${newHelped} tickets the old way got wrong, and got ${newHurt} wrong that the old way got right.`);
    console.log(`  Repeat shortcut used ${shortcuts} times, right ${shortcutRight} of them.`);
    if (changes.length) { console.log('  Where they differ (first 15):'); for (const x of changes) console.log(x); }
    console.log('\n  Switch "Ticket sorting learns" to On only if the new way is at least as accurate, has fewer "wrong but rated High", and its gap is smaller.');
})().catch(err => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
