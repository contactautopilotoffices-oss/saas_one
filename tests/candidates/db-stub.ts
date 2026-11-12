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
/** Permanent delete, clear all, the AI fix log and the 'candidate_fix' job (owner 2026-11-03). */
export const PURGE_AI_FIX_MIGRATION = readFileSync(path.join("supabase", "migrations", "20261103000001_candidate_search_purge_and_ai_fix.sql"), "utf8");
/** Automatic background indexing with Jina (owner 2026-11-03); same vector stub as MIGRATION. */
export const AUTO_INDEXING_MIGRATION = readFileSync(path.join("supabase", "migrations", "20261103000002_candidate_search_auto_indexing.sql"), "utf8")
  .replace(/extensions\.vector\(768\)/g, "extensions.vector");

/** The fields resumes will fill (owner 2026-11-07); the filter panel must also work before it is applied. */
export const RESUME_FIELDS_MIGRATION = readFileSync(path.join("supabase", "migrations", "20261107000001_candidate_search_resume_fields.sql"), "utf8");

/** Resume files (owner 2026-11-07, phase 1). PGlite has no storage schema, so the bucket row is left out. */
export const RESUME_FILES_MIGRATION = readFileSync(path.join("supabase", "migrations", "20261107000002_candidate_resume_files.sql"), "utf8")
  .replace(/insert into storage\.buckets[\s\S]*?on conflict \(id\) do nothing;/i, "");
/** Resume text, contacts and the link to a candidate (owner 2026-11-10, phase 2); recreates the filter view with has_resume. */
export const RESUME_LINKS_MIGRATION = readFileSync(path.join("supabase", "migrations", "20261110000001_candidate_resume_links.sql"), "utf8");
/** Files removed as not resumes keep a row with status 'rejected' (owner 2026-11-10). */
export const RESUME_REJECTS_MIGRATION = readFileSync(path.join("supabase", "migrations", "20261110000002_candidate_resume_rejects.sql"), "utf8");
/** Details read from resumes by a model (owner 2026-11-11, phase 4): candidate columns, file columns, the view again. */
export const RESUME_EXTRACTION_MIGRATION = readFileSync(path.join("supabase", "migrations", "20261111000002_candidate_resume_extraction.sql"), "utf8");
/** Scanned resumes typed out by a model (owner 2026-11-11): two more text statuses and the scan's cost columns. */
export const RESUME_SCANS_MIGRATION = readFileSync(path.join("supabase", "migrations", "20261111000003_candidate_resume_scans.sql"), "utf8");
/** Which of a person's fields were worked out from the resume's employers (owner 2026-11-11). */
export const INFERRED_FIELDS_MIGRATION = readFileSync(path.join("supabase", "migrations", "20261111000004_candidate_inferred_fields.sql"), "utf8");

export async function freshDb(options: { resumeFields?: boolean } = {}): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(STUBS);
  await db.exec(MIGRATION);
  await db.exec(TASK_AI_MODELS_MIGRATION);
  await db.exec(AI_MODELS_MIGRATION);
  await db.exec(PURGE_AI_FIX_MIGRATION);
  await db.exec(AUTO_INDEXING_MIGRATION);
  if (options.resumeFields !== false) await db.exec(RESUME_FIELDS_MIGRATION);
  await db.exec(RESUME_FILES_MIGRATION);
  if (options.resumeFields !== false) await db.exec(RESUME_LINKS_MIGRATION);
  await db.exec(RESUME_REJECTS_MIGRATION);
  if (options.resumeFields !== false) await db.exec(RESUME_EXTRACTION_MIGRATION);
  if (options.resumeFields !== false) await db.exec(RESUME_SCANS_MIGRATION);
  if (options.resumeFields !== false) await db.exec(INFERRED_FIELDS_MIGRATION);
  return db;
}

/** A 3-dim vector pointing mostly along `axis`, in the app's "[...]" format. */
export const vec = (axis: number) => `[${[0, 1, 2].map((i) => (i === axis ? 1 : 0.05)).join(",")}]`;
