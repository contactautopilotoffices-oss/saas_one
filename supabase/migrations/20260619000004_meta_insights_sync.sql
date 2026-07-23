-- Migration: Meta Ads — Marketing API sync support
-- Adds:
--   * Marketing API credentials to crm_meta_config (ad account, long-lived user
--     token, app id, token expiry, last-sync telemetry)
--   * meta_campaign_id on crm_campaigns (joins local campaigns to Meta insights)
--   * crm_campaign_metrics — daily impressions / clicks / CTR / CPC / CPM /
--     reach / frequency pulled from Meta. Kept separate from spend so we can
--     upsert spend without touching metrics and vice-versa.
--
-- Manual spend entries always take precedence over Meta-API spend for the
-- same (campaign, date). The sync service enforces this in application code
-- (see backend/services/metaInsightsSync.ts).

-- ============================================================================
-- 1. crm_meta_config — Marketing API fields
-- ============================================================================
alter table public.crm_meta_config
    add column if not exists meta_ad_account_id text,
    add column if not exists meta_user_access_token text,
    add column if not exists meta_app_id text,
    add column if not exists meta_token_expires_at timestamptz,
    add column if not exists last_sync_at timestamptz,
    add column if not exists last_sync_status text
        check (last_sync_status in ('ok', 'failed', 'auth_error', 'partial'));

-- ============================================================================
-- 2. crm_campaigns — meta_campaign_id (FK target from insights)
-- ============================================================================
alter table public.crm_campaigns
    add column if not exists meta_campaign_id text;

-- Per-org unique so two orgs can independently link to the same Meta campaign.
create unique index if not exists uq_crm_campaigns_meta_id
    on public.crm_campaigns (organization_id, meta_campaign_id)
    where meta_campaign_id is not null;

create index if not exists idx_crm_campaigns_meta_id
    on public.crm_campaigns (meta_campaign_id)
    where meta_campaign_id is not null;

-- ============================================================================
-- 3. crm_campaign_metrics — daily Meta performance metrics
-- ============================================================================
create table if not exists public.crm_campaign_metrics (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    campaign_id uuid not null references public.crm_campaigns(id) on delete cascade,
    metric_date date not null,
    impressions bigint not null default 0 check (impressions >= 0),
    clicks bigint not null default 0 check (clicks >= 0),
    reach bigint check (reach is null or reach >= 0),
    ctr numeric(8,4) check (ctr is null or (ctr >= 0 and ctr <= 100)),
    cpc numeric(14,4) check (cpc is null or cpc >= 0),
    cpm numeric(14,4) check (cpm is null or cpm >= 0),
    frequency numeric(8,3) check (frequency is null or frequency >= 0),
    source text not null default 'meta_api'
        check (source in ('meta_api', 'google_api', 'import', 'manual')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (campaign_id, metric_date)
);

create index if not exists idx_crm_campaign_metrics_org_date
    on public.crm_campaign_metrics (organization_id, metric_date desc);

create index if not exists idx_crm_campaign_metrics_campaign_date
    on public.crm_campaign_metrics (campaign_id, metric_date desc);

-- updated_at trigger (re-uses shared helper if present)
do $$
begin
    if exists (select 1 from pg_proc where proname = 'update_updated_at')
       and not exists (select 1 from pg_trigger where tgname = 'crm_campaign_metrics_updated_at') then
        create trigger crm_campaign_metrics_updated_at
            before update on public.crm_campaign_metrics
            for each row execute function public.update_updated_at();
    end if;
end $$;

alter table public.crm_campaign_metrics enable row level security;

-- Read: org members (matches crm_campaign_spend policy shape)
drop policy if exists crm_campaign_metrics_select_org on public.crm_campaign_metrics;
create policy crm_campaign_metrics_select_org on public.crm_campaign_metrics
    for select to authenticated
    using (organization_id in (
        select organization_id from public.organization_memberships
        where user_id = auth.uid() and is_active = true
        union
        select organization_id from public.property_memberships
        where user_id = auth.uid() and is_active = true
    ));

-- Write: admins (manual entry) — sync writes via service role, bypasses RLS.
drop policy if exists crm_campaign_metrics_admin_write on public.crm_campaign_metrics;
create policy crm_campaign_metrics_admin_write on public.crm_campaign_metrics
    for all to authenticated
    using (exists (
        select 1 from public.organization_memberships
        where user_id = auth.uid() and is_active = true
          and role in ('bd_admin', 'org_admin', 'org_super_admin')
          and organization_id = crm_campaign_metrics.organization_id
    ))
    with check (exists (
        select 1 from public.organization_memberships
        where user_id = auth.uid() and is_active = true
          and role in ('bd_admin', 'org_admin', 'org_super_admin')
          and organization_id = crm_campaign_metrics.organization_id
    ));