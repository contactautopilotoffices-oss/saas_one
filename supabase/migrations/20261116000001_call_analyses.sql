-- =================================================================================
-- Migration: 20261116000001_call_analyses.sql
-- Description: owner 2026-11-16 — Recruitment, the Calls tab (plan P3 + P7 in docs/RECRUITMENT_ATS_IMPLEMENTATION_PLAN.md).
--   The recruiter's first call to a candidate is made on a normal phone and recorded; the recording (or a pasted
--   transcript) is uploaded on the candidate's panel, transcribed, and read by a model for sentiment, interest, the
--   concerns raised, and the facts heard (current pay, expected pay, notice, location, reason for change), each with a
--   quote from the call. Everything the model writes is advisory: nothing on the candidate changes unless a person
--   clicks "Apply" on a fact, and no status ever changes from a call.
--   1) call_analyses : one row per uploaded call. `subject_type` is 'candidate' today (candidate_id set); another
--                      subject later (say a BD call) adds its own column. The audio stays in the private bucket below;
--                      the transcript, the segments with their time stamps, and the model's result are kept here.
--   2) storage bucket 'candidate-calls' : private, 25 MB per file (the transcription service's per-request limit).
-- Access: RLS on, NO policies: only server code (service role) reads or writes, after backend/lib/candidates/access.ts
--         says the caller may (HR roles, org super admin, Tech, master admin). Recordings and transcripts are personal
--         data: the app soft-deletes a call (deleted_at) and removes its audio from the bucket.
-- Safety: ADDITIVE. One new table, two indexes, one bucket row. No existing row, column, view or function is touched.
-- How to apply: run this whole file once in the Supabase SQL Editor, after 20261115000002. Safe to re-run.
-- Rollback: DROP TABLE IF EXISTS public.call_analyses;
--           DELETE FROM storage.buckets WHERE id = 'candidate-calls';  (empty the bucket first)
-- =================================================================================

BEGIN;

create table if not exists public.call_analyses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- whose call this is: 'candidate' today; a later subject adds its own id column and value here
  subject_type text not null default 'candidate' check (subject_type in ('candidate')),
  candidate_id uuid references public.candidates (id) on delete cascade,
  -- the sourcing record the call was logged from, and the position it was for, when there was one
  application_id uuid references public.candidate_applications (id) on delete set null,
  position_id uuid references public.candidate_positions (id) on delete set null,
  -- 'audio': a recording in the bucket, transcribed here; 'transcript': text pasted by HR, used as is
  input_kind text not null check (input_kind in ('audio', 'transcript')),
  file_name text,
  file_type text,
  file_size bigint,
  storage_path text,
  -- the day the call was made (typed by HR; the upload may be later)
  called_on date,
  -- HR confirmed the candidate was told the call is recorded
  consent_confirmed boolean not null default false,
  -- uploading -> uploaded -> transcribing -> analysing -> done | failed. A pasted transcript starts at 'uploaded'.
  status text not null default 'uploading'
    check (status in ('uploading', 'uploaded', 'transcribing', 'analysing', 'done', 'failed')),
  error text,
  attempts integer not null default 0,
  -- the transcript: the full text, and the segments as [{start, end, text}] in seconds (null for a pasted transcript)
  transcript_text text,
  segments jsonb,
  language text,
  duration_seconds integer,
  transcribe_model text,
  -- the model's reading (backend/lib/callInsights/contexts/candidateScreening.ts), the model that answered, and its usage
  result jsonb,
  model text,
  tokens_in integer,
  tokens_out integer,
  cost_usd numeric(10, 5),
  -- facts HR applied to the record from this call: [{key, at, by}]
  applied_facts jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  -- the name shown on the call, kept here so it reads the same after someone leaves
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint call_analyses_candidate_subject check (subject_type <> 'candidate' or candidate_id is not null)
);

create index if not exists call_analyses_candidate_idx
  on public.call_analyses (candidate_id, created_at desc) where deleted_at is null;
create index if not exists call_analyses_org_status_idx
  on public.call_analyses (organization_id, status) where deleted_at is null;

alter table public.call_analyses enable row level security;
revoke all on public.call_analyses from anon, authenticated;

-- Private bucket: 25 MB per file (the transcription service's limit), call recordings only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'candidate-calls', 'candidate-calls', false, 26214400,
  array['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/flac']
)
on conflict (id) do nothing;

NOTIFY pgrst, 'reload schema';

COMMIT;
