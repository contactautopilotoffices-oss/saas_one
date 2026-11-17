/**
 * A tiny in-memory stand-in for the parts of the Supabase client that
 * lib/hr-assistant/ingest.ts uses. Not a general-purpose fake.
 */
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null };

class Query implements PromiseLike<Result> {
  private op: "select" | "insert" | "update" | "delete" = "select";
  private payload: Row | Row[] | undefined;
  private filters: ((row: Row) => boolean)[] = [];
  private returning = false;
  private wantSingle = false;

  constructor(
    private readonly db: FakeSupabase,
    private readonly table: string,
  ) {}

  insert(rows: Row | Row[]) {
    this.op = "insert";
    this.payload = rows;
    return this;
  }
  update(values: Row) {
    this.op = "update";
    this.payload = values;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  select() {
    if (this.op !== "select") this.returning = true;
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  neq(column: string, value: unknown) {
    this.filters.push((row) => row[column] !== value);
    return this;
  }
  lt(column: string, value: string) {
    this.filters.push((row) => String(row[column]) < value);
    return this;
  }
  in(column: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }
  order() {
    return this;
  }
  single() {
    this.wantSingle = true;
    return this;
  }
  maybeSingle() {
    return this.single();
  }
  then<A = Result, B = never>(
    onFulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve()
      .then(() => this.execute())
      .then(onFulfilled, onRejected);
  }

  private execute(): Result {
    if (this.db.failOn?.(this.table, this.op)) {
      return { data: null, error: { message: `forced ${this.op} failure on ${this.table}` } };
    }
    const rows = (this.db.tables[this.table] ??= []);
    const matches = () => rows.filter((row) => this.filters.every((filter) => filter(row)));
    let result: Row[];

    switch (this.op) {
      case "insert": {
        const now = new Date().toISOString();
        result = (Array.isArray(this.payload) ? this.payload : [this.payload!]).map((row) => ({
          id: randomUUID(),
          created_at: now,
          updated_at: now,
          ...row,
        }));
        rows.push(...result);
        if (!this.returning) return { data: null, error: null };
        break;
      }
      case "update":
        result = matches();
        for (const row of result) Object.assign(row, this.payload);
        if (!this.returning) return { data: null, error: null };
        break;
      case "delete":
        result = matches();
        this.db.tables[this.table] = rows.filter((row) => !result.includes(row));
        this.db.cascade(this.table, result);
        if (!this.returning) return { data: null, error: null };
        break;
      default:
        result = matches();
    }
    return { data: this.wantSingle ? (result[0] ?? null) : result, error: null };
  }
}

type RpcHandler = (args: Record<string, unknown>, db: FakeSupabase) => Result | Promise<Result>;

export class FakeSupabase {
  tables: Record<string, Row[]> = {};
  removedFiles: string[] = [];
  rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  failOn?: (table: string, op: string) => boolean;

  constructor(private readonly rpcHandlers: Record<string, RpcHandler> = {}) {}

  from(table: string) {
    return new Query(this, table);
  }

  async rpc(name: string, args: Record<string, unknown>): Promise<Result> {
    this.rpcCalls.push({ name, args });
    const handler = this.rpcHandlers[name];
    if (!handler) return { data: null, error: { message: `no fake for rpc ${name}` } };
    return handler(args, this);
  }

  /** ON DELETE CASCADE: hr_policies -> hr_documents -> hr_policy_chunks. */
  cascade(table: string, deleted: Row[]) {
    const ids = new Set(deleted.map((row) => row.id));
    const child =
      table === "hr_policies"
        ? { table: "hr_documents", key: "policy_id" }
        : table === "hr_documents"
          ? { table: "hr_policy_chunks", key: "document_id" }
          : null;
    if (!child) return;
    const rows = this.tables[child.table] ?? [];
    const removed = rows.filter((row) => ids.has(row[child.key]));
    this.tables[child.table] = rows.filter((row) => !ids.has(row[child.key]));
    this.cascade(child.table, removed);
  }

  storage = {
    from: () => ({
      remove: async (paths: string[]) => {
        this.removedFiles.push(...paths);
        return { data: [], error: null };
      },
    }),
  };

  asClient(): SupabaseClient {
    return this as unknown as SupabaseClient;
  }
}
