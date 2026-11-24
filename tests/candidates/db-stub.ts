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
/** Recruitment step 4 (owner 2026-11-15): positions, insert-only history, blacklist, the "Others" status, the view again. */
export const RECRUITMENT_MIGRATION = readFileSync(path.join("supabase", "migrations", "20261115000002_recruitment_positions_actions_blacklist.sql"), "utf8")
  .replace(/extensions\.vector\(768\)/g, "extensions.vector");
/** Calls (owner 2026-11-16, plan P3 + P7): call_analyses. PGlite has no storage schema, so the bucket row is left out. */
export const CALLS_MIGRATION = readFileSync(path.join("supabase", "migrations", "20261116000001_call_analyses.sql"), "utf8")
  .replace(/insert into storage\.buckets[\s\S]*?on conflict \(id\) do nothing;/i, "");
/** Outreach on WhatsApp (owner 2026-11-16): candidate_outreach and the 'outreach_sent' history action. */
export const OUTREACH_MIGRATION = readFileSync(path.join("supabase", "migrations", "20261116000003_candidate_outreach.sql"), "utf8");
/** "Already in the database" (owner 2026-11-16): where an upload came from, and the 'duplicate_flagged' history action. */
export const SOURCING_MIGRATION = readFileSync(path.join("supabase", "migrations", "20261116000004_sourcing_duplicates.sql"), "utf8");
/** A position as a job record (owner 2026-11-16): designation, employment type, openings, hiring manager, priority, education, budget, summary. */
export const POSITION_DETAILS_MIGRATION = readFileSync(path.join("supabase", "migrations", "20261116000005_position_details.sql"), "utf8");
/** Which round a call was for (owner 2026-11-17): call_analyses.call_round. */
export const CALL_ROUNDS_MIGRATION = readFileSync(path.join("supabase", "migrations", "20261117000001_call_rounds.sql"), "utf8");
/** The JD library (owner 2026-11-17): JDs, their versions, and the version each position was opened from. */
export const JD_LIBRARY_MIGRATION = readFileSync(path.join("supabase", "migrations", "20261117000002_jd_library.sql"), "utf8");
/**
 * Manpower requisitions (owner 2026-11-17). The tables it needs that no candidate migration creates (the app has them
 * from older migrations): users, organization_memberships, organization_settings, email_action_tokens.
 */
export const REQUISITIONS_STUBS = `
  create table if not exists public.users (id uuid primary key references auth.users (id), full_name text, email text, phone text, is_master_admin boolean default false);
  create table if not exists public.organization_memberships (id uuid primary key default gen_random_uuid(), user_id uuid, organization_id uuid, role text, is_active boolean default true);
  create table if not exists public.organization_settings (organization_id uuid primary key references public.organizations (id), notification_matrix jsonb, created_at timestamptz default now(), updated_at timestamptz default now());
  create table if not exists public.email_action_tokens (id uuid primary key default gen_random_uuid(), token_hash text not null unique, organization_id uuid not null, user_id uuid not null, entity_type text not null, entity_id uuid not null, action text not null, payload jsonb not null default '{}'::jsonb, expires_at timestamptz not null, consumed_at timestamptz, consumed_ip text, result text, created_at timestamptz not null default now());
`;
export const REQUISITIONS_MIGRATION = readFileSync(path.join("supabase", "migrations", "20261117000003_recruitment_requisitions.sql"), "utf8");
/** The pipeline's stages as a list HR edits, and the editable WhatsApp update (owner 2026-11-19). */
export const STAGES_MIGRATION = readFileSync(path.join("supabase", "migrations", "20261119000001_recruitment_stages.sql"), "utf8");
/** Interviews (owner 2026-11-19): the WhatsApp interview invite in candidate_outreach. */
export const INTERVIEWS_MIGRATION = readFileSync(path.join("supabase", "migrations", "20261119000002_recruitment_interviews.sql"), "utf8");
/** Hiring-request follow-ups (owner 2026-11-21): the "endorsed" and "still_needed" history entries. */
export const REQUISITION_FOLLOWUPS_MIGRATION = readFileSync(path.join("supabase", "migrations", "20261121000001_recruitment_requisition_followups.sql"), "utf8");
/** Owner 2026-11-24: the department head approves first; internal mobility, place in the structure, a new role title. */
export const REQUISITION_HOD_MIGRATION = readFileSync(path.join("supabase", "migrations", "20261124000001_recruitment_requisition_hod_and_fields.sql"), "utf8");
/** Connected trackers (owner 2026-11-21): Google Sheet / Excel links synced into the candidate database. */
export const TRACKERS_MIGRATION = readFileSync(path.join("supabase", "migrations", "20261121000002_candidate_tracker_connections.sql"), "utf8");
export const TRACKER_PREVIEW_MIGRATION = readFileSync(path.join("supabase", "migrations", "20261122000004_tracker_preview.sql"), "utf8");
/** The hiring flow after booking (owner 2026-11-21): interviews, scorecards, offers. */
export const HIRING_FLOW_MIGRATION = readFileSync(path.join("supabase", "migrations", "20261121000003_recruitment_hiring_flow.sql"), "utf8");

export const RESUME_SOURCING_MIGRATION = readFileSync(path.join("supabase", "migrations", "20261122000001_resume_sourcing.sql"), "utf8");

export async function freshDb(options: { resumeSourcing?: boolean; resumeFields?: boolean; stages?: boolean; interviews?: boolean; requisitionFollowups?: boolean; trackers?: boolean; hiringFlow?: boolean } = {}): Promise<PGlite> {
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
  if (options.resumeFields !== false) await db.exec(RECRUITMENT_MIGRATION);
  if (options.resumeFields !== false) await db.exec(CALLS_MIGRATION);
  if (options.resumeFields !== false) await db.exec(OUTREACH_MIGRATION);
  if (options.resumeFields !== false) await db.exec(SOURCING_MIGRATION);
  if (options.resumeFields !== false) await db.exec(POSITION_DETAILS_MIGRATION);
  if (options.resumeFields !== false) await db.exec(CALL_ROUNDS_MIGRATION);
  if (options.resumeFields !== false) await db.exec(JD_LIBRARY_MIGRATION);
  if (options.resumeFields !== false) { await db.exec(REQUISITIONS_STUBS); await db.exec(REQUISITIONS_MIGRATION); }
  if (options.resumeFields !== false && options.requisitionFollowups !== false) await db.exec(REQUISITION_FOLLOWUPS_MIGRATION);
  if (options.resumeFields !== false && options.requisitionFollowups !== false) await db.exec(REQUISITION_HOD_MIGRATION);
  if (options.resumeFields !== false && options.trackers !== false) await db.exec(TRACKERS_MIGRATION);
  if (options.resumeFields !== false && options.trackers !== false) await db.exec(TRACKER_PREVIEW_MIGRATION);
  if (options.resumeFields !== false && options.hiringFlow !== false) await db.exec(HIRING_FLOW_MIGRATION);
  if (options.resumeFields !== false && options.stages !== false) await db.exec(STAGES_MIGRATION);
  if (options.resumeFields !== false && options.stages !== false && options.interviews !== false) await db.exec(INTERVIEWS_MIGRATION);
  if (options.resumeFields !== false && options.resumeSourcing !== false) await db.exec(RESUME_SOURCING_MIGRATION);
  return db;
}

/** A 3-dim vector pointing mostly along `axis`, in the app's "[...]" format. */
export const vec = (axis: number) => `[${[0, 1, 2].map((i) => (i === axis ? 1 : 0.05)).join(",")}]`;
