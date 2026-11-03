/**
 * Test helper: the small subset of the supabase-js query builder that backend/lib/candidates uses, executed as real
 * SQL on PGlite, so the import / CRUD code runs against the real migration. Column lists come from our own code
 * (trusted); values are always bound as parameters. Not a general-purpose client.
 */
import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string; code?: string } | null; count?: number | null };

/** Same as supabase-js: missing keys in a multi-row write become NULL, so callers must send uniform rows. */
function columnsOf(rows: Row[]): string[] {
  return [...new Set(rows.flatMap((row) => Object.keys(row)))];
}

function bind(value: unknown): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) return JSON.stringify(value);
  return value;
}

class Query implements PromiseLike<Result> {
  private op: "select" | "insert" | "upsert" | "update" = "select";
  private columns = "*";
  private countMode = false;
  private head = false;
  private rows: Row[] = [];
  private values: Row = {};
  private where: string[] = [];
  private params: unknown[] = [];
  private orderBy: string[] = [];
  private limitN: number | null = null;
  private offsetN: number | null = null;
  private returning: string | null = null;
  private mode: "many" | "single" | "maybe" = "many";

  constructor(
    private readonly db: PGlite,
    private readonly table: string,
  ) {}

  private p(value: unknown): string {
    this.params.push(bind(value));
    return `$${this.params.length}`;
  }

  select(columns = "*", options?: { count?: string; head?: boolean }) {
    if (this.op === "select") {
      this.columns = columns;
      this.countMode = Boolean(options?.count);
      this.head = Boolean(options?.head);
    } else this.returning = columns;
    return this;
  }
  insert(rows: Row | Row[]) {
    this.op = "insert";
    this.rows = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  upsert(rows: Row | Row[]) {
    this.op = "upsert";
    this.rows = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  update(values: Row) {
    this.op = "update";
    this.values = values;
    return this;
  }
  eq(column: string, value: unknown) {
    this.where.push(`${column} = ${this.p(value)}`);
    return this;
  }
  neq(column: string, value: unknown) {
    this.where.push(`${column} <> ${this.p(value)}`);
    return this;
  }
  in(column: string, values: unknown[]) {
    this.where.push(values.length ? `${column} = any(${this.p(values)})` : "false");
    return this;
  }
  is(column: string, value: null) {
    void value;
    this.where.push(`${column} is null`);
    return this;
  }
  not(column: string, operator: "is", value: null) {
    void operator;
    void value;
    this.where.push(`${column} is not null`);
    return this;
  }
  ilike(column: string, pattern: string) {
    this.where.push(`${column} ilike ${this.p(pattern)}`);
    return this;
  }
  order(column: string, options?: { ascending?: boolean }) {
    this.orderBy.push(`${column} ${options?.ascending === false ? "desc" : "asc"}`);
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  range(from: number, to: number) {
    this.offsetN = from;
    this.limitN = to - from + 1;
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }
  maybeSingle() {
    this.mode = "maybe";
    return this;
  }

  private whereSql(): string {
    return this.where.length ? ` where ${this.where.join(" and ")}` : "";
  }

  private async run(): Promise<Result> {
    const table = `public.${this.table}`;
    let sql: string;
    let count: number | null = null;
    if (this.op === "select") {
      if (this.countMode) {
        const [{ n }] = (await this.db.query<{ n: number }>(`select count(*)::int as n from ${table}${this.whereSql()}`, this.params)).rows;
        count = n;
        if (this.head) return { data: null, error: null, count };
      }
      sql = `select ${this.columns} from ${table}${this.whereSql()}`;
      if (this.orderBy.length) sql += ` order by ${this.orderBy.join(", ")}`;
      if (this.limitN !== null) sql += ` limit ${this.limitN}`;
      if (this.offsetN !== null) sql += ` offset ${this.offsetN}`;
    } else if (this.op === "update") {
      const sets = Object.entries(this.values).map(([k, v]) => `${k} = ${this.p(v)}`);
      sql = `update ${table} set ${sets.join(", ")}${this.whereSql()} returning ${this.returning ?? "*"}`;
    } else {
      if (!this.rows.length) return { data: [], error: null };
      const cols = columnsOf(this.rows);
      const tuples = this.rows.map((row) => `(${cols.map((c) => this.p(row[c] ?? null)).join(", ")})`);
      sql = `insert into ${table} (${cols.join(", ")}) values ${tuples.join(", ")}`;
      if (this.op === "upsert") {
        const updates = cols.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`);
        sql += ` on conflict (id) do update set ${updates.join(", ")}`;
      }
      sql += ` returning ${this.returning ?? "*"}`;
    }
    const rows = (await this.db.query<Row>(sql, this.params)).rows;
    if (this.mode === "single") {
      return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: `expected 1 row, got ${rows.length}` } };
    }
    if (this.mode === "maybe") return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null, count };
  }

  then<A = Result, B = never>(resolve?: ((value: Result) => A | PromiseLike<A>) | null, reject?: ((reason: unknown) => B | PromiseLike<B>) | null) {
    return this.run()
      .catch((error: { message?: string; code?: string }) => ({ data: null, error: { message: error.message ?? String(error), code: error.code } }))
      .then(resolve, reject);
  }
}

export function pgliteSupabase(db: PGlite): SupabaseClient {
  return {
    from: (table: string) => new Query(db, table),
    rpc: async (name: string, args: Row) => {
      try {
        const keys = Object.keys(args);
        const params = keys.map((k) => bind(args[k]));
        const rows = (await db.query<Row>(`select * from public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`, params)).rows;
        if (rows.length === 1 && Object.keys(rows[0]).length === 1 && name in rows[0]) return { data: rows[0][name], error: null };
        return { data: rows, error: null };
      } catch (error) {
        const e = error as { message?: string; code?: string };
        return { data: null, error: { message: e.message ?? String(error), code: e.code } };
      }
    },
  } as unknown as SupabaseClient;
}
