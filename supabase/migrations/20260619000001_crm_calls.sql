-- Migration: AI Call Coach — recordings + coaching reports
-- Description: crm_calls table for uploaded MP3s + AI-generated 5-layer coaching
--              reports, plus a private Supabase Storage bucket for the audio.

-- ============================================================================
-- 1. crm_calls table
-- ============================================================================
create table if not exists public.crm_calls (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    lead_id uuid not null references public.crm_leads(id) on delete cascade,
    bd_rep_id uuid not null references public.users(id),

    -- Lifecycle
    status text not null default 'uploaded'
        check (status in ('uploaded','transcribing','scoring','completed','failed')),
    error_message text,

    -- Audio
    recording_url text,                     -- Supabase Storage path inside crm-call-recordings
    duration_seconds integer,
    file_size_bytes bigint,
    mime_type text,

    -- Transcript (array of {speaker, start, end, text} segments)
    transcript jsonb,
    summary text,

    -- Coaching report (the 5-layer score card from Groq)
    coaching jsonb,

    -- Rollups for fast list views
    overall_score numeric(4,2),
    rep_talk_ratio numeric(4,2),
    duration_seconds_cached integer,

    -- Context snapshot (so analytics survive lead archival / edits)
    lead_company_name_snapshot text,
    lead_contact_person_snapshot text,

    -- Soft-delete
    is_archived boolean not null default false,

    uploaded_at timestamptz not null default now(),
    analyzed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists crm_calls_lead_idx        on public.crm_calls (lead_id, uploaded_at desc);
create index if not exists crm_calls_rep_idx         on public.crm_calls (bd_rep_id, uploaded_at desc);
create index if not exists crm_calls_org_idx         on public.crm_calls (organization_id, uploaded_at desc);
create index if not exists crm_calls_status_idx      on public.crm_calls (organization_id, status);
create index if not exists crm_calls_overall_idx     on public.crm_calls (organization_id, overall_score desc);

-- updated_at trigger (matches the rest of the CRM)
create or replace function public.crm_calls_touch_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end $$;

drop trigger if exists trg_crm_calls_touch on public.crm_calls;
create trigger trg_crm_calls_touch
    before update on public.crm_calls
    for each row execute function public.crm_calls_touch_updated_at();

-- ============================================================================
-- 2. RLS — mirror the rest of the CRM posture. We keep API-layer enforcement
--    (supabaseAdmin + resolveCrmAccess) as the source of truth, but enable RLS
--    defensively so direct PostgREST reads don't leak across orgs.
-- ============================================================================
alter table public.crm_calls enable row level security;

-- Members of the org can see calls in their org
drop policy if exists crm_calls_select_org on public.crm_calls;
create policy crm_calls_select_org on public.crm_calls
    for select to authenticated
    using (organization_id in (
        select organization_id from public.organization_memberships
        where user_id = auth.uid() and is_active = true
        union
        select organization_id from public.property_memberships
        where user_id = auth.uid() and is_active = true
    ));

-- Reps can insert their own calls; admins can insert anyone's
drop policy if exists crm_calls_insert_self on public.crm_calls;
create policy crm_calls_insert_self on public.crm_calls
    for insert to authenticated
    with check (
        bd_rep_id = auth.uid()
        or exists (
            select 1 from public.organization_memberships
            where user_id = auth.uid() and is_active = true
              and role in ('bd_admin','org_admin','org_super_admin')
              and organization_id = crm_calls.organization_id
        )
    );

-- Reps can update their own calls (for status flips during analysis)
drop policy if exists crm_calls_update_self on public.crm_calls;
create policy crm_calls_update_self on public.crm_calls
    for update to authenticated
    using (bd_rep_id = auth.uid() or exists (
        select 1 from public.organization_memberships
        where user_id = auth.uid() and is_active = true
          and role in ('bd_admin','org_admin','org_super_admin')
          and organization_id = crm_calls.organization_id
    ));

-- ============================================================================
-- 3. Storage bucket — private, 50MB limit (matches sop-videos)
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit)
values ('crm-call-recordings', 'crm-call-recordings', false, 52428800)
on conflict (id) do nothing;

-- Authenticated users can upload into the bucket (path is namespaced by org/lead)
drop policy if exists "crm_call_recordings_insert" on storage.objects;
create policy "crm_call_recordings_insert" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'crm-call-recordings');

-- Owners can read their own uploads; admins (via signed URLs from the server)
-- can read any. For now, keep it owner-only — the API layer hands out signed URLs.
drop policy if exists "crm_call_recordings_select_owner" on storage.objects;
create policy "crm_call_recordings_select_owner" on storage.objects
    for select to authenticated
    using (bucket_id = 'crm-call-recordings' and owner = auth.uid());

drop policy if exists "crm_call_recordings_delete_owner" on storage.objects;
create policy "crm_call_recordings_delete_owner" on storage.objects
    for delete to authenticated
    using (bucket_id = 'crm-call-recordings' and owner = auth.uid());
