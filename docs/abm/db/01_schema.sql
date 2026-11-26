-- Autopilot Offices ABM, Supabase schema
-- Run this once in the Supabase SQL editor.
-- Safe to re-run: every statement is idempotent.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

do $$ begin
  create type abm_score   as enum ('HOT','WARM','COLD');
exception when duplicate_object then null; end $$;

do $$ begin
  create type abm_persona as enum ('founder','admin','hr','finance','other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type abm_stage   as enum (
    'new','contacted','replied','called','visit_booked',
    'proposal','closed_won','closed_lost','dnc'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type abm_intent  as enum ('interested','not_interested','later','question','unknown');
exception when duplicate_object then null; end $$;

do $$ begin
  create type abm_channel as enum ('whatsapp','linkedin','call','email');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Do Not Contact. Checked before every single send.
-- ---------------------------------------------------------------------------

create table if not exists abm_dnc (
  id          uuid primary key default gen_random_uuid(),
  phone       text,
  linkedin_url text,
  email       text,
  domain      text,
  reason      text not null default 'said not interested',
  added_at    timestamptz not null default now()
);

create index if not exists abm_dnc_phone_idx    on abm_dnc (phone)        where phone is not null;
create index if not exists abm_dnc_linkedin_idx on abm_dnc (linkedin_url) where linkedin_url is not null;
create index if not exists abm_dnc_domain_idx   on abm_dnc (domain)       where domain is not null;

-- ---------------------------------------------------------------------------
-- Leads
-- ---------------------------------------------------------------------------

create table if not exists abm_leads (
  id                uuid primary key default gen_random_uuid(),

  -- identity
  first_name        text not null,
  last_name         text,
  linkedin_url      text,
  phone             text,          -- normalised to 91XXXXXXXXXX, digits only
  email             text,
  email_status      text,

  -- company
  company           text not null,
  company_domain    text,
  company_location  text,
  target_area       text,          -- Andheri East, MIDC, Marol, SEEPZ ...
  employees         int,
  industry          text,
  designation       text,
  persona           abm_persona not null default 'other',

  -- scoring, written by Claude at intake
  score             abm_score not null default 'COLD',
  why_now           text,
  call_opener       text,
  notes             text,

  -- campaign
  campaign          text not null,
  target_office     text not null default 'Andheri East',

  -- pipeline
  stage             abm_stage not null default 'new',

  -- cadence clock. Day N of the sequence is (current_date - sequence_start) + 1
  sequence_start    date,
  stopped_at        timestamptz,
  stopped_reason    text,
  retry_after       date,          -- set to +60 days when the sequence ends with no reply

  -- touch log, one timestamp per planned touch
  li_connect_sent_at   timestamptz,
  li_connected_at      timestamptz,
  li_message_sent_at   timestamptz,
  li_followup_sent_at  timestamptz,
  li_final_sent_at     timestamptz,
  wa_intro_sent_at     timestamptz,
  wa_followup_sent_at  timestamptz,
  wa_final_sent_at     timestamptz,
  called_at            timestamptz,
  call_outcome         text,

  -- reply handling
  replied_at        timestamptz,
  reply_channel     abm_channel,
  reply_intent      abm_intent not null default 'unknown',

  -- the three qualifying questions
  q_seats           int,
  q_move_date       text,
  q_preferred_area  text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Dedup. A person is the same person if the LinkedIn URL or the phone matches.
create unique index if not exists abm_leads_linkedin_uniq
  on abm_leads (lower(linkedin_url)) where linkedin_url is not null;
create unique index if not exists abm_leads_phone_uniq
  on abm_leads (phone) where phone is not null;

create index if not exists abm_leads_stage_idx    on abm_leads (stage);
create index if not exists abm_leads_campaign_idx on abm_leads (campaign);
create index if not exists abm_leads_seq_idx      on abm_leads (sequence_start) where stopped_at is null;

-- ---------------------------------------------------------------------------
-- Event log. Every touch and every reply, append only.
-- ---------------------------------------------------------------------------

create table if not exists abm_events (
  id          bigserial primary key,
  lead_id     uuid not null references abm_leads(id) on delete cascade,
  channel     abm_channel not null,
  event       text not null,        -- sent_intro, invite_accepted, reply_in, call_made ...
  detail      text,
  payload     jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists abm_events_lead_idx on abm_events (lead_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Day number in the sequence. Day 1 is the day the sequence starts.
create or replace function abm_day(seq_start date)
returns int language sql immutable as $$
  select case when seq_start is null then null
              else (current_date - seq_start) + 1 end;
$$;

-- Only Indian mobiles are sendable on WhatsApp: 91 then 6-9 then 9 digits.
create or replace function abm_is_sendable_phone(p text)
returns boolean language sql immutable as $$
  select p is not null and p ~ '^91[6-9][0-9]{9}$';
$$;

-- Is this lead on the DNC list, by any identifier?
create or replace function abm_is_dnc(l abm_leads)
returns boolean language sql stable as $$
  select exists (
    select 1 from abm_dnc d
    where (d.phone        is not null and d.phone = l.phone)
       or (d.linkedin_url is not null and lower(d.linkedin_url) = lower(l.linkedin_url))
       or (d.email        is not null and lower(d.email) = lower(l.email))
       or (d.domain       is not null and lower(d.domain) = lower(l.company_domain))
  );
$$;

create or replace function abm_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists abm_leads_updated_at on abm_leads;
create trigger abm_leads_updated_at before update on abm_leads
  for each row execute function abm_touch_updated_at();

-- A lead is live if the sequence is running, nobody has replied, and they are
-- not on the DNC list. Everything downstream filters on this.
create or replace function abm_is_live(l abm_leads)
returns boolean language sql stable as $$
  select l.sequence_start is not null
     and l.stopped_at is null
     and l.replied_at is null
     and l.stage not in ('dnc','closed_won','closed_lost')
     and not abm_is_dnc(l);
$$;
