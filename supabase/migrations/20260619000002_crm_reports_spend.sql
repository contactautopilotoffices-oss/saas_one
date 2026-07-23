-- Migration: CRM Reports — spend tracking + lost-reason analytics
-- Description:
--   1. Add spend-related columns to crm_campaigns (channel, budget, period, dates).
--   2. New table crm_campaign_spend — granular daily spend log per campaign.
--   3. Add lost_reason / lost_reason_notes to crm_leads for funnel analytics.

-- ============================================================================
-- 1. crm_campaigns — spend metadata
-- ============================================================================
alter table public.crm_campaigns
    add column if not exists channel text
        check (channel in ('meta_ads','google_ads','whatsapp','email','referral','organic','manual','other')),
    add column if not exists budget_total numeric(14,2) default 0 check (budget_total >= 0),
    add column if not exists budget_period text default 'monthly'
        check (budget_period in ('monthly','quarterly','one_time')),
    add column if not exists start_date date,
    add column if not exists end_date date;

create index if not exists crm_campaigns_channel_idx
    on public.crm_campaigns (organization_id, channel);

-- ============================================================================
-- 2. crm_campaign_spend — granular spend log
-- ============================================================================
create table if not exists public.crm_campaign_spend (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    campaign_id uuid not null references public.crm_campaigns(id) on delete cascade,
    spend_date date not null,
    amount numeric(14,2) not null check (amount >= 0),
    source text not null default 'manual'
        check (source in ('manual','meta_api','google_api','import')),
    notes text,
    created_by uuid references public.users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists crm_campaign_spend_campaign_idx
    on public.crm_campaign_spend (campaign_id, spend_date desc);
create index if not exists crm_campaign_spend_org_idx
    on public.crm_campaign_spend (organization_id, spend_date desc);
create index if not exists crm_campaign_spend_date_idx
    on public.crm_campaign_spend (organization_id, spend_date);

create or replace function public.crm_campaign_spend_touch_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end $$;

drop trigger if exists trg_crm_campaign_spend_touch on public.crm_campaign_spend;
create trigger trg_crm_campaign_spend_touch
    before update on public.crm_campaign_spend
    for each row execute function public.crm_campaign_spend_touch_updated_at();

alter table public.crm_campaign_spend enable row level security;

-- Org members can read; admins can write
drop policy if exists crm_campaign_spend_select_org on public.crm_campaign_spend;
create policy crm_campaign_spend_select_org on public.crm_campaign_spend
    for select to authenticated
    using (organization_id in (
        select organization_id from public.organization_memberships
        where user_id = auth.uid() and is_active = true
        union
        select organization_id from public.property_memberships
        where user_id = auth.uid() and is_active = true
    ));

drop policy if exists crm_campaign_spend_admin_write on public.crm_campaign_spend;
create policy crm_campaign_spend_admin_write on public.crm_campaign_spend
    for all to authenticated
    using (exists (
        select 1 from public.organization_memberships
        where user_id = auth.uid() and is_active = true
          and role in ('bd_admin','org_admin','org_super_admin')
          and organization_id = crm_campaign_spend.organization_id
    ))
    with check (exists (
        select 1 from public.organization_memberships
        where user_id = auth.uid() and is_active = true
          and role in ('bd_admin','org_admin','org_super_admin')
          and organization_id = crm_campaign_spend.organization_id
    ));

-- ============================================================================
-- 3. crm_leads — lost-reason analytics
-- ============================================================================
alter table public.crm_leads
    add column if not exists lost_reason text,
    add column if not exists lost_reason_notes text;

create index if not exists crm_leads_lost_reason_idx
    on public.crm_leads (organization_id, lost_reason)
    where lost_reason is not null;
