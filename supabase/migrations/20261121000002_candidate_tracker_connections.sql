-- =================================================================================
-- Migration: 20261121000002_candidate_tracker_connections.sql
-- Description: owner 2026-11-21 (HRMS meeting item 5, "standard tracker Excel sheet integration"; "it must be fully
--   configurable for the sheet/excel selection"). HR connects a Google Sheet or an Excel file (by its share link), picks
--   the tab, matches its columns to the candidate fields and its status values to the pipeline stages, and the app
--   pulls new and changed rows on a schedule. One way only: sheet -> app; the app never writes to the sheet.
--   1) candidate_tracker_connections : one per connected tab: the link, the tab, the column and status matching, how
--                                      often it syncs, and the last sync's result.
--   2) candidate_tracker_rows        : the last values seen per sheet row (keyed by email / phone / name, and role), so
--                                      a sync only applies the cells that changed in the sheet since the last sync and an
--                                      edit made in the app to an unchanged cell stays.
--   3) candidate_tracker_syncs       : every sync, with its counts or its error (insert-only history).
-- Access: RLS on, NO policies: only server code (service role) reads or writes, after the route's own check (people
--         with candidate access, as for sheet uploads).
-- Safety: ADDITIVE. Three new tables; nothing existing changes.
-- How to apply: run this whole file once in the Supabase SQL Editor. Safe to re-run.
-- Rollback: DROP TABLE IF EXISTS public.candidate_tracker_syncs, public.candidate_tracker_rows, public.candidate_tracker_connections;
-- =================================================================================

BEGIN;

create table if not exists public.candidate_tracker_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  source_url text not null,
  source_kind text not null check (source_kind in ('google_sheet', 'excel_link')),
  tab_name text not null,
  -- 1-based row number of the header row in the tab.
  header_row integer not null default 1 check (header_row between 1 and 50),
  -- { "<header text>": "<field>" | null } (null = not imported).
  column_map jsonb not null default '{}'::jsonb,
  -- The column whose text moves people between pipeline stages, and { "<status text, lower case>": "<stage key>" }.
  status_column text,
  status_map jsonb not null default '{}'::jsonb,
  sync_every text not null default 'hourly' check (sync_every in ('hourly', 'daily', 'manual')),
  active boolean not null default true,
  -- The candidate sheet the rows are merged into (Recruitment -> Sheets).
  sheet_id uuid references public.candidate_sheets (id) on delete set null,
  syncing_since timestamptz,
  last_synced_at timestamptz,
  last_ok boolean,
  last_error text,
  last_summary jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists candidate_tracker_connections_org_idx on public.candidate_tracker_connections (organization_id) where deleted_at is null;

create table if not exists public.candidate_tracker_rows (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.candidate_tracker_connections (id) on delete cascade,
  row_key text not null,
  cells jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create unique index if not exists candidate_tracker_rows_key on public.candidate_tracker_rows (connection_id, row_key);

create table if not exists public.candidate_tracker_syncs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  connection_id uuid not null references public.candidate_tracker_connections (id) on delete cascade,
  trigger text not null check (trigger in ('schedule', 'manual')),
  ok boolean not null,
  summary jsonb,
  error text,
  started_at timestamptz not null,
  finished_at timestamptz not null default now()
);
create index if not exists candidate_tracker_syncs_conn_idx on public.candidate_tracker_syncs (connection_id, finished_at desc);

alter table public.candidate_tracker_connections enable row level security;
alter table public.candidate_tracker_rows enable row level security;
alter table public.candidate_tracker_syncs enable row level security;
revoke all on public.candidate_tracker_connections from anon, authenticated;
revoke all on public.candidate_tracker_rows from anon, authenticated;
revoke all on public.candidate_tracker_syncs from anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
