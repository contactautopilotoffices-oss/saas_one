/**
 * In-memory Postgres for the Candidate Search tests. pgvector is not installed for PGlite here, so
 * `extensions.vector` is stubbed as a text domain holding "[x,y,...]" (the format the app sends) with a cosine
 * `<=>` operator. Everything else is the migration's own SQL.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";

export const MIGRATION = readFileSync(path.join("supabase", "migrations", "20261102000003_candidate_search.sql"), "utf8")
  .replace(/create extension if not exists vector with schema extensions;/i, "")
  .replace(/extensions\.vector\(768\)/g, "extensions.vector");

const STUBS = `
  create schema if not exists extensions;
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key);
  create table if not exists public.organizations (id uuid primary key);
  do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
  do $$ begin create role anon; exception when duplicate_object then null; end $$;
  create domain extensions.vector as text;
  create function extensions.cosine_distance(a text, b text) returns float8 language sql immutable as $$
    with v as (select translate(a, '[]', '{}')::float8[] as x, translate(b, '[]', '{}')::float8[] as y)
    select 1 - (select sum(p * q) from v, unnest(v.x, v.y) as t(p, q))
             / nullif(sqrt((select sum(p * p) from v, unnest(v.x) p)) * sqrt((select sum(q * q) from v, unnest(v.y) q)), 0)
    from v
  $$;
  create operator extensions.<=> (leftarg = text, rightarg = text, function = extensions.cosine_distance);
`;

/** The Task Manager's model-settings table (20261028140001) and the follow-up that adds the Candidate Search jobs. */
export const TASK_AI_MODELS_MIGRATION = readFileSync(path.join("supabase", "migrations", "20261028140001_task_manager_ai_models.sql"), "utf8");
export const AI_MODELS_MIGRATION = readFileSync(path.join("supabase", "migrations", "20261102000004_candidate_search_ai_models.sql"), "utf8");

export async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(STUBS);
  await db.exec(MIGRATION);
  await db.exec(TASK_AI_MODELS_MIGRATION);
  await db.exec(AI_MODELS_MIGRATION);
  return db;
}

/** A 3-dim vector pointing mostly along `axis`, in the app's "[...]" format. */
export const vec = (axis: number) => `[${[0, 1, 2].map((i) => (i === axis ? 1 : 0.05)).join(",")}]`;
