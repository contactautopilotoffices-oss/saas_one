/**
 * Ticket sorting that learns (owner 2026-11-19): turns the judgements and overrides made so far into learning examples.
 * Run once after migration 20261119000001; safe to run again (a ticket that already has an example is skipped).
 *
 * WRITES to the database (only the new table ticket_sort_examples), so per CLAUDE.md a person runs it, never an agent.
 * Without --write it only counts what it would add.
 *
 * Run:  npx tsx --env-file=.env.local scripts/tickets/build_learning_examples.ts            (count only)
 *       npx tsx --env-file=.env.local scripts/tickets/build_learning_examples.ts --write    (add the examples)
 *       npx tsx --env-file=.env.local scripts/tickets/build_learning_examples.ts --write --embed
 *            also adds embeddings to examples without one (only needed when "find similar tickets by meaning" is on;
 *            uses the embedding service's quota, EMBEDDING_PROVIDER as for candidate search)
 * Options: --org=<organisation id>
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ticketText } from '@/backend/lib/ticketing/sortReview';
import { maskIdentity } from '@/backend/lib/aiLayer/brain/console/view';
import { embedExample } from '@/backend/lib/ticketing/sortLearningStore';

type Row = Record<string, unknown>;
const PAGE = 1000;
const IN_CHUNK = 100;
const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const EMBED = args.includes('--embed');
const ORG = args.find(a => a.startsWith('--org='))?.split('=')[1] ?? null;
const TEAMS = ['technical', 'plumbing', 'vendor', 'soft_services'];
const team = (x: unknown) => (TEAMS.includes(String(x)) ? String(x) : null);
const str = (x: unknown): string | null => (typeof x === 'string' && x.trim() ? x : null);
const one = <T,>(x: T | T[] | null | undefined): T | null => (Array.isArray(x) ? x[0] ?? null : x ?? null);

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

(async () => {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    console.log(WRITE ? 'Adding learning examples.' : 'Counting only (add --write to add them).');

    const existing = await all((a, b) => { let q = db.from('ticket_sort_examples').select('ticket_id'); if (ORG) q = q.eq('organization_id', ORG); return q.range(a, b); });
    const have = new Set(existing.map(r => str(r.ticket_id)).filter(Boolean) as string[]);

    const reviews = await all((a, b) => { let q = db.from('ticket_sort_reviews').select('organization_id, ticket_id, ticket_text, verdict, chosen_code, chosen_team, right_code, right_team, created_at'); if (ORG) q = q.eq('organization_id', ORG); return q.range(a, b); });
    const reviewed = new Set(reviews.map(r => str(r.ticket_id)).filter(Boolean) as string[]);
    const cats = await all((a, b) => db.from('issue_categories').select('id, code, skill_group:skill_groups(code)').range(a, b));
    const catById = new Map(cats.map(c => [String(c.id), c]));

    const rows: Row[] = [];
    const reviewTickets = new Map((await byIds(db, 'tickets', 'id, property_id', [...reviewed])).map(t => [String(t.id), t]));
    for (const r of reviews) {
        const tid = str(r.ticket_id);
        if (!tid || have.has(tid)) continue;
        const wrong = r.verdict === 'wrong';
        const code = wrong ? str(r.right_code) : str(r.chosen_code);
        if (!code || !str(r.ticket_text)) continue;
        rows.push({ organization_id: r.organization_id, property_id: str(reviewTickets.get(tid)?.property_id), ticket_id: tid, ticket_text: String(r.ticket_text), code, team: team(wrong ? r.right_team : r.chosen_team), source: wrong ? 'judged_wrong' : 'judged_right', created_at: r.created_at });
    }

    // Overrides on the ticket page, latest per ticket, where the category changed and the ticket was not judged.
    const logs = await all((a, b) => db.from('ticket_activity_log').select('ticket_id, old_value, new_value, created_at').eq('action', 'classification_override').order('created_at', { ascending: true }).range(a, b));
    const latest = new Map<string, Row>();
    for (const l of logs) if (str(l.ticket_id) && str(l.old_value) !== str(l.new_value)) latest.set(String(l.ticket_id), l);
    const overrideIds = [...latest.keys()].filter(id => !reviewed.has(id) && !have.has(id));
    for (const t of await byIds(db, 'tickets', 'id, organization_id, property_id, title, description', overrideIds)) {
        if (ORG && t.organization_id !== ORG) continue;
        const cat = catById.get(String(latest.get(String(t.id))?.new_value ?? ''));
        const code = str(cat?.code);
        const text = maskIdentity(ticketText(t), 1000) ?? '';
        if (!code || !text.trim()) continue;
        rows.push({ organization_id: t.organization_id, property_id: str(t.property_id), ticket_id: t.id, ticket_text: text, code, team: team(one(cat?.skill_group as Row | Row[] | null)?.code), source: 'override', created_at: latest.get(String(t.id))!.created_at });
    }

    const count = (s: string) => rows.filter(r => r.source === s).length;
    console.log(`Already examples: ${have.size}. To add: ${rows.length} (${count('judged_right')} judged right, ${count('judged_wrong')} judged wrong, ${count('override')} overrides).`);

    if (WRITE && rows.length) {
        let added = 0;
        for (let i = 0; i < rows.length; i += 200) {
            const { data, error } = await db.from('ticket_sort_examples').upsert(rows.slice(i, i + 200), { onConflict: 'ticket_id', ignoreDuplicates: true }).select('id');
            if (error) throw new Error(`adding examples: ${error.message}`);
            added += (data ?? []).length;
        }
        console.log(`Added ${added}.`);
    }

    if (WRITE && EMBED) {
        const { EMBEDDING_MODEL, EMBED_CALL_GAP_MS } = await import('@/backend/lib/candidates/config');
        const waiting = await all((a, b) => { let q = db.from('ticket_sort_examples').select('id, ticket_text, embedding_model').is('retired_at', null); if (ORG) q = q.eq('organization_id', ORG); return q.range(a, b); });
        const todo = waiting.filter(w => w.embedding_model !== EMBEDDING_MODEL);
        console.log(`Embedding ${todo.length} examples with ${EMBEDDING_MODEL}...`);
        let ok = 0;
        for (const w of todo) {
            if (await embedExample(db, String(w.id), String(w.ticket_text ?? ''))) ok++;
            else { console.log('The embedding service said no; stopping here. Run again later to continue.'); break; }
            await new Promise(r => setTimeout(r, EMBED_CALL_GAP_MS));
        }
        console.log(`Embedded ${ok}.`);
    }
})().catch(err => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
