/**
 * Ticket sorting: how well does it learn today? (owner 2026-11-19, Phase 0: "measure before changing", doctrine L2:
 * test the new path against the old one on the same cases `[BAA pp.94–95, 99]`).
 *
 * READ ONLY. Nothing is written to the database and no message is sent to anyone.
 *
 * Part 1 (always, free, no AI): from what is already saved.
 *   - tickets of the last --days (default 30) per organisation: sorted by AI, by keyword rules, re-sorted by hand
 *   - judgements made in Brain → Review → Tickets, week by week
 *   - confidence honesty of the live system: "when it said 70%, how often was it right?"
 *   - repeat mistakes: judged wrong although a similar ticket had already been corrected to the same category
 *   - contradictions: near-identical tickets corrected to different categories
 *   - how many learning examples exist, and how many the AI is shown today
 *
 * Part 2 (only with --replay; sends ticket text to the AI providers, as creating a ticket does): sorts every judged or
 * hand-re-sorted ticket again, twice: as today (the organisation's newest MAX_CORRECTIONS corrections made BEFORE that
 * ticket, never its own) and with no corrections at all. Prints accuracy and confidence honesty for both. These are the
 * numbers the later phases must beat.
 *
 * Run:  npx tsx --env-file=.env.local scripts/tickets/learning_baseline.ts
 *       npx tsx --env-file=.env.local scripts/tickets/learning_baseline.ts --replay --limit=150
 * Options: --days=N  --org=<organisation id>  --replay  --limit=N (replay cases, newest first, default 150)  --model=<id>
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { categoryOptionsFrom, classifyWithAi, MAX_CORRECTIONS, CONFIDENCE_HIGH, type CategoryOption, type Correction } from '@/backend/lib/ticketing/aiClassifier';
import { calibration, contradictions, repeatMistakes, type Calibration, type Judgement } from '@/backend/lib/ticketing/sortLearningStats';
import { ticketText } from '@/backend/lib/ticketing/sortReview';
import { maskIdentity } from '@/backend/lib/aiLayer/brain/console/view';
import type { SkillGroup } from '@/backend/lib/ticketing/classifyTicket';

type Row = Record<string, unknown>;
const PAGE = 1000;
const IN_CHUNK = 100;
const PARALLEL = 4;
const DAY_MS = 86_400_000;
const MISSING = new Set(['42P01', 'PGRST205', '42703', 'PGRST204']);

const args = process.argv.slice(2);
const opt = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const DAYS = Number(opt('days') ?? 30) || 30;
const ORG = opt('org') ?? null;
const REPLAY = args.includes('--replay');
const LIMIT = Number(opt('limit') ?? 150) || 150;
const MODEL = opt('model') ?? null;

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : '-');
const short = (s: string, n = 80) => s.replace(/\s+/g, ' ').trim().slice(0, n);
const str = (x: unknown): string | null => (typeof x === 'string' && x.trim() ? x : null);

function table(head: string[], rows: string[][]) {
    const width = head.map((h, i) => Math.max(h.length, ...rows.map(r => (r[i] ?? '').length)));
    for (const r of [head, ...rows]) console.log('  ' + r.map((x, i) => (x ?? '').padEnd(width[i])).join('  '));
}

function heading(s: string) { console.log(`\n=== ${s} ===`); }

/** Reads every row of a query, a page at a time (the database returns at most 1000 at once). */
async function all(build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { code?: string; message: string } | null }>): Promise<{ rows: Row[]; missing: boolean }> {
    const rows: Row[] = [];
    for (let from = 0; ; from += PAGE) {
        const { data, error } = await build(from, from + PAGE - 1);
        if (error) { if (MISSING.has(String(error.code ?? ''))) return { rows, missing: true }; throw new Error(error.message); }
        rows.push(...((data ?? []) as Row[]));
        if (!data || data.length < PAGE) return { rows, missing: false };
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

function printCalibration(c: Calibration) {
    table(['confidence given', 'tickets', 'said (avg)', 'actually right', 'gap'],
        c.bands.filter(b => b.tickets).map(b => [b.band, String(b.tickets), `${b.saidAvg}%`, b.actuallyRight === null ? '-' : `${b.actuallyRight}%`, b.gap === null ? '-' : `${b.gap > 0 ? '+' : ''}${b.gap}`]));
    console.log(`  accuracy ${c.accuracy ?? '-'}%  |  average gap between said and real: ${c.averageGap ?? '-'} points  |  wrong but rated High (skipped Review): ${c.wrongButHigh}  |  sent to Review: ${c.toReview} of ${c.tickets}`);
}

/** A ticket whose right category is known: judged in Review, or re-sorted by hand with the Override button. */
interface Case { ticketId: string | null; org: string; property: string | null; at: string; text: string; truth: string | null; from: 'judged right' | 'judged wrong' | 'override' }

(async () => {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const since = new Date(Date.now() - DAYS * DAY_MS).toISOString();
    console.log(`Ticket sorting learning baseline, ${new Date().toISOString().slice(0, 10)}. READ ONLY.${ORG ? ` Organisation ${ORG} only.` : ''}`);

    // ── what is saved ───────────────────────────────────────────────────────────────────────────────────────────────
    const orgs = new Map<string, string>();
    for (const o of (await all((a, b) => db.from('organizations').select('id, name').range(a, b))).rows) orgs.set(String(o.id), String(o.name ?? o.id));
    const orgName = (id: string) => orgs.get(id) ?? id.slice(0, 8);

    const tickets = (await all((a, b) => {
        let q = db.from('tickets').select('id, organization_id, classification_source, confidence_score').gte('created_at', since).order('created_at', { ascending: false });
        if (ORG) q = q.eq('organization_id', ORG);
        return q.range(a, b);
    })).rows;

    const rv = await all((a, b) => {
        let q = db.from('ticket_sort_reviews').select('organization_id, ticket_id, ticket_text, sorted_by, chosen_code, chosen_team, chosen_confidence, verdict, right_code, right_team, created_at').order('created_at', { ascending: true });
        if (ORG) q = q.eq('organization_id', ORG);
        return q.range(a, b);
    });
    const reviews = rv.rows;

    const cats = (await all((a, b) => db.from('issue_categories').select('id, code, name, priority, is_active, property_id, skill_group:skill_groups(code)').range(a, b))).rows;
    const codeOfCategory = new Map(cats.map(c => [String(c.id), String(c.code)]));

    // Overrides on the ticket page (the Review screen also writes this log line when it moves a ticket: those are left out).
    const judgedIds = new Set(reviews.map(r => str(r.ticket_id)).filter(Boolean) as string[]);
    const overrideLog = (await all((a, b) => db.from('ticket_activity_log').select('ticket_id, old_value, new_value, created_at').eq('action', 'classification_override').order('created_at', { ascending: true }).range(a, b))).rows
        .filter(r => str(r.ticket_id) && !judgedIds.has(String(r.ticket_id)) && str(r.old_value) !== str(r.new_value));
    const lastOverride = new Map<string, Row>();
    for (const r of overrideLog) lastOverride.set(String(r.ticket_id), r);
    const overriddenTickets = await byIds(db, 'tickets', 'id, organization_id, property_id, created_at, title, description', [...lastOverride.keys()]);

    // ── 1. volume ───────────────────────────────────────────────────────────────────────────────────────────────────
    heading(`1. Tickets of the last ${DAYS} days`);
    const perOrg = new Map<string, Row[]>();
    for (const t of tickets) { const k = String(t.organization_id); perOrg.set(k, [...(perOrg.get(k) ?? []), t]); }
    table(['organisation', 'tickets', 'by AI', 'AI rated High', 'by keyword rules', 're-sorted by hand'],
        [...perOrg].sort((a, b) => b[1].length - a[1].length).map(([org, ts]) => {
            const ai = ts.filter(t => t.classification_source === 'llm');
            const high = ai.filter(t => typeof t.confidence_score === 'number' && (t.confidence_score as number) >= CONFIDENCE_HIGH).length;
            return [orgName(org), String(ts.length), String(ai.length), `${high} (${pct(high, ai.length)})`, String(ts.filter(t => t.classification_source === 'rule').length), String(ts.filter(t => t.classification_source === 'manual').length)];
        }));

    // ── 2. judgements ───────────────────────────────────────────────────────────────────────────────────────────────
    heading('2. Judgements in Brain → Review → Tickets');
    if (rv.missing) console.log('  The review table (migration 20261115000003) is not applied, so there are no judgements yet.');
    else {
        const right = reviews.filter(r => r.verdict === 'right').length;
        console.log(`  ${reviews.length} judged: ${right} right, ${reviews.length - right} wrong. Plus ${lastOverride.size} tickets re-sorted with the Override button on the ticket page.`);
        const week = (iso: string) => { const d = new Date(iso); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
        const weeks = new Map<string, { right: number; wrong: number }>();
        for (const r of reviews) { const w = week(String(r.created_at)); const x = weeks.get(w) ?? { right: 0, wrong: 0 }; if (r.verdict === 'right') x.right++; else x.wrong++; weeks.set(w, x); }
        if (weeks.size) table(['week from', 'judged', 'right', 'wrong', 'share right'], [...weeks].slice(-8).map(([w, x]) => [w, String(x.right + x.wrong), String(x.right), String(x.wrong), pct(x.right, x.right + x.wrong)]));
    }

    // ── 3. confidence honesty, live ─────────────────────────────────────────────────────────────────────────────────
    heading('3. Confidence honesty of the live system (AI sortings that were judged)');
    const liveItems = reviews.filter(r => r.sorted_by === 'ai' && typeof r.chosen_confidence === 'number').map(r => ({ confidence: r.chosen_confidence as number, right: r.verdict === 'right' }));
    if (liveItems.length) {
        printCalibration(calibration(liveItems, CONFIDENCE_HIGH));
        console.log(`  Note: only sortings below ${CONFIDENCE_HIGH}% reach Review, so the High bands are only measured by --replay.`);
        console.log(`  Overrides on the ticket page (${lastOverride.size}) are mistakes that did NOT come through Review, most likely rated High.`);
    } else console.log('  No judged AI sortings yet.');

    // ── 4. memory that did not help ─────────────────────────────────────────────────────────────────────────────────
    const judgements: Judgement[] = reviews.map(r => ({
        org: String(r.organization_id), at: String(r.created_at), text: String(r.ticket_text ?? ''),
        verdict: r.verdict === 'wrong' ? 'wrong' : 'right', chosen: str(r.chosen_code), right: str(r.right_code),
    }));
    const wrongCount = judgements.filter(j => j.verdict === 'wrong').length;
    heading('4. Repeat mistakes (a similar ticket had already been corrected to the same category)');
    const repeats = repeatMistakes(judgements, MAX_CORRECTIONS);
    console.log(`  ${repeats.length} of ${wrongCount} wrong judgements (${pct(repeats.length, wrongCount)}) were repeats.`);
    console.log(`  Of those, the earlier correction WAS among the ${MAX_CORRECTIONS} the AI was shown: ${repeats.filter(r => r.wasShown).length}; had already dropped out of the newest ${MAX_CORRECTIONS}: ${repeats.filter(r => !r.wasShown).length}.`);
    for (const r of repeats.slice(-5)) console.log(`   - "${short(r.text, 60)}" chose ${r.chosen ?? 'other'}, right ${r.right}; earlier: "${short(r.earlierText, 50)}" (alike ${r.similarity})`);

    heading('5. Contradictions (near-identical tickets, different right category)');
    const clashes = contradictions(judgements);
    console.log(`  ${clashes.length} pairs.`);
    for (const c of clashes.slice(0, 5)) console.log(`   - "${short(c.a, 45)}" → ${c.aCode}  vs  "${short(c.b, 45)}" → ${c.bCode}`);

    heading('6. Learning examples');
    console.log(`  Corrections (judged wrong): ${wrongCount}. Confirmed right: ${judgements.length - wrongCount}. Override button: ${lastOverride.size}.`);
    console.log(`  Today the AI is shown only the newest ${MAX_CORRECTIONS} corrections of the organisation, whatever the ticket is about; confirmed-right tickets and overrides are not used.`);
    const orgWrong = new Map<string, number>();
    for (const j of judgements) if (j.verdict === 'wrong') orgWrong.set(j.org, (orgWrong.get(j.org) ?? 0) + 1);
    for (const [org, n] of orgWrong) console.log(`   - ${orgName(org)}: ${n} corrections, ${Math.max(0, n - MAX_CORRECTIONS)} no longer shown to the AI`);

    if (!REPLAY) { console.log('\nRun again with --replay to sort the known tickets again and measure accuracy and confidence across all bands.'); return; }

    // ── replay ──────────────────────────────────────────────────────────────────────────────────────────────────────
    heading(`7. Replay: the known tickets sorted again (newest ${LIMIT})`);
    const ticketOf = new Map<string, Row>();
    for (const t of await byIds(db, 'tickets', 'id, property_id, created_at', [...judgedIds])) ticketOf.set(String(t.id), t);
    const cases: Case[] = [];
    for (const r of reviews) {
        const t = ticketOf.get(String(r.ticket_id ?? ''));
        cases.push({
            ticketId: str(r.ticket_id), org: String(r.organization_id), property: str(t?.property_id), at: String(t?.created_at ?? r.created_at),
            text: String(r.ticket_text ?? ''), truth: r.verdict === 'wrong' ? str(r.right_code) : str(r.chosen_code), from: r.verdict === 'wrong' ? 'judged wrong' : 'judged right',
        });
    }
    for (const t of overriddenTickets) {
        if (ORG && t.organization_id !== ORG) continue;
        const log = lastOverride.get(String(t.id))!;
        const truth = codeOfCategory.get(String(log.new_value ?? '')) ?? null;
        if (!truth) continue;
        cases.push({ ticketId: String(t.id), org: String(t.organization_id), property: str(t.property_id), at: String(t.created_at), text: maskIdentity(ticketText(t), 1000) ?? '', truth, from: 'override' });
    }
    const chosen = cases.filter(c => c.text.trim()).sort((a, b) => b.at.localeCompare(a.at)).slice(0, LIMIT);
    console.log(`  ${chosen.length} tickets: ${chosen.filter(c => c.from === 'judged right').length} judged right, ${chosen.filter(c => c.from === 'judged wrong').length} judged wrong, ${chosen.filter(c => c.from === 'override').length} overrides.`);

    const optionsFor = new Map<string, CategoryOption[]>();
    const options = (p: string | null) => {
        const k = p ?? '*';
        if (!optionsFor.has(k)) optionsFor.set(k, categoryOptionsFrom(cats as never, p));
        return optionsFor.get(k)!;
    };
    const asTeam = (x: unknown) => (['technical', 'plumbing', 'vendor', 'soft_services'].includes(String(x)) ? (x as SkillGroup) : null);
    // As today: the organisation's newest corrections made before this ticket came in, never its own.
    const correctionsBefore = (c: Case): Correction[] => reviews
        .filter(r => r.verdict === 'wrong' && r.right_code && String(r.organization_id) === c.org && String(r.created_at) < c.at && (!c.ticketId || r.ticket_id !== c.ticketId))
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        .slice(0, MAX_CORRECTIONS)
        .map(r => ({ text: String(r.ticket_text ?? ''), code: String(r.right_code), team: asTeam(r.right_team) }));

    const deps = MODEL ? { chain: [MODEL] } : {};
    const runs: Record<'today' | 'none', Array<{ confidence: number; right: boolean }>> = { today: [], none: [] };
    const misses: string[] = [];
    let failed = 0;
    for (let i = 0; i < chosen.length; i += PARALLEL) {
        await Promise.all(chosen.slice(i, i + PARALLEL).map(async c => {
            const opts = options(c.property);
            try {
                const [today, none] = await Promise.all([classifyWithAi(c.text, opts, deps, correctionsBefore(c)), classifyWithAi(c.text, opts, deps, [])]);
                runs.today.push({ confidence: today.verdict.confidence, right: today.verdict.code === c.truth });
                runs.none.push({ confidence: none.verdict.confidence, right: none.verdict.code === c.truth });
                if (today.verdict.code !== c.truth) misses.push(`   - wanted ${c.truth ?? 'other'}, got ${today.verdict.code ?? 'other'} at ${today.verdict.confidence}% (${c.from}): "${short(c.text, 60)}"`);
            } catch (err) {
                if (!failed) console.log(`  a sorting failed: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`);
                failed++;
            }
        }));
        process.stdout.write(`\r  sorted ${Math.min(i + PARALLEL, chosen.length)} of ${chosen.length}`);
    }
    console.log(failed ? `\n  ${failed} could not be sorted (left out).` : '');
    console.log('\n  As today (newest corrections shown):');
    printCalibration(calibration(runs.today, CONFIDENCE_HIGH));
    console.log('\n  With no corrections at all:');
    printCalibration(calibration(runs.none, CONFIDENCE_HIGH));
    const a = calibration(runs.today).accuracy ?? 0, b = calibration(runs.none).accuracy ?? 0;
    console.log(`\n  Today's corrections add ${a - b >= 0 ? '+' : ''}${a - b} points of accuracy.`);
    console.log(`  Still wrong as today (${misses.length}, first 15):`);
    for (const m of misses.slice(0, 15)) console.log(m);
})().catch(err => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
