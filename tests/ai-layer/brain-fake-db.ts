/**
 * A tiny in-memory stand-in for the Supabase client, for the brain's console and learning tests. No database, no network.
 * It supports only what those modules use: select / insert / update / upsert / delete with eq, gte, lt, in, order,
 * range, limit and maybeSingle, plus "this table or column does not exist yet" (a migration not applied).
 */
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export type Row = Record<string, unknown>;
export class FakeDb {
    tables: Record<string, Row[]> = {};
    missingTables = new Set<string>();
    /** Columns that "do not exist yet" (a migration not applied): selecting or writing them fails like Postgres does. */
    missingColumns = new Set<string>();
    /** Tables where an update finds no row to change (someone else saved a moment earlier). */
    lostRace = new Set<string>();
    writes: Array<{ table: string; op: string }> = [];
    rows(t: string) { return (this.tables[t] ??= []); }
}
class Q implements PromiseLike<{ data: unknown; error: { code: string; message: string } | null }> {
    private filters: Array<(r: Row) => boolean> = [];
    private op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
    private payload: Row | null = null;
    private cols = '';
    private sort: Array<{ col: string; asc: boolean }> = [];
    private window: [number, number] | null = null;
    private one = false;
    private conflict: string | null = null;
    private filterCols: string[] = [];
    constructor(private db: FakeDb, private table: string) {}
    select(cols = '*') { if (this.op === 'select') this.cols = cols; return this; }
    insert(row: Row) { this.op = 'insert'; this.payload = row; return this; }
    update(patch: Row) { this.op = 'update'; this.payload = patch; return this; }
    upsert(row: Row, o: { onConflict?: string } = {}) { this.op = 'upsert'; this.payload = row; this.conflict = o.onConflict ?? null; return this; }
    delete() { this.op = 'delete'; return this; }
    eq(c: string, v: unknown) { this.filterCols.push(c); this.filters.push(r => r[c] === v); return this; }
    gte(c: string, v: string) { this.filters.push(r => String(r[c]) >= v); return this; }
    lt(c: string, v: string) { this.filters.push(r => String(r[c]) < v); return this; }
    in(c: string, vs: unknown[]) { this.filters.push(r => vs.includes(r[c])); return this; }
    order(col: string, o: { ascending?: boolean } = {}) { this.sort.push({ col, asc: o.ascending !== false }); return this; }
    range(a: number, b: number) { this.window = [a, b]; return this; }
    limit(n: number) { this.window = [0, n - 1]; return this; }
    maybeSingle() { this.one = true; return this; }
    private run(): { data: unknown; error: { code: string; message: string } | null } {
        if (this.db.missingTables.has(this.table)) return { data: null, error: { code: '42P01', message: `relation "${this.table}" does not exist` } };
        const named = `${this.cols} ${Object.keys(this.payload ?? {}).join(' ')} ${this.filterCols.join(' ')}`;
        for (const col of this.db.missingColumns) if (new RegExp(`\\b${col}\\b`).test(named)) return { data: null, error: { code: '42703', message: `column ${this.table}.${col} does not exist` } };
        const all = this.db.rows(this.table);
        const hit = () => all.filter(r => this.filters.every(f => f(r)));
        if (this.op === 'insert') { this.db.writes.push({ table: this.table, op: 'insert' }); all.push({ id: randomUUID(), created_at: new Date().toISOString(), ...this.payload }); return { data: null, error: null }; }
        if (this.op === 'update') { const rows = this.db.lostRace.has(this.table) ? [] : hit(); this.db.writes.push({ table: this.table, op: 'update' }); rows.forEach(r => Object.assign(r, this.payload)); return { data: rows, error: null }; }
        if (this.op === 'delete') { const gone = new Set(hit()); this.db.writes.push({ table: this.table, op: 'delete' }); this.db.tables[this.table] = all.filter(r => !gone.has(r)); return { data: null, error: null }; }
        if (this.op === 'upsert') {
            this.db.writes.push({ table: this.table, op: 'upsert' });
            const old = this.conflict ? all.find(r => r[this.conflict!] === this.payload![this.conflict!]) : undefined;
            if (old) Object.assign(old, this.payload); else all.push({ id: randomUUID(), created_at: new Date().toISOString(), ...this.payload });
            return { data: null, error: null };
        }
        let rows = hit();
        if (this.sort.length) rows = [...rows].sort((a, b) => this.sort.reduce((d, { col, asc }) => d || String(a[col]).localeCompare(String(b[col])) * (asc ? 1 : -1), 0));
        if (this.window) rows = rows.slice(this.window[0], this.window[1] + 1);
        return { data: this.one ? rows[0] ?? null : rows, error: null };
    }
    then<A, B>(ok?: ((v: { data: unknown; error: { code: string; message: string } | null }) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
        return Promise.resolve(this.run()).then(ok, bad);
    }
}
export const admin = (db: FakeDb) => ({ from: (t: string) => new Q(db, t) }) as unknown as SupabaseClient;
