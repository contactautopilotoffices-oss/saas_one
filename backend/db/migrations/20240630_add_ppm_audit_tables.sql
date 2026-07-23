/*
  Migration: 20240630_add_ppm_audit_tables.sql
  Adds tables required for Digital Audit feature.
*/

create table if not exists public.ppm_audit_reports (
  id uuid default uuid_generate_v4() primary key,
  organization_id uuid not null references organizations(id),
  property_id uuid not null references properties(id),
  audit_month date not null, -- stored as first day of month
  total_tasks integer not null default 0,
  completed_tasks integer not null default 0,
  pending_tasks integer not null default 0,
  compliance_pct numeric(5,2) not null default 0,
  generated_at timestamp with time zone default now()
);

create index if not exists idx_ppm_audit_reports_org_prop_month on public.ppm_audit_reports (organization_id, property_id, audit_month);

create table if not exists public.ppm_audit_items (
  id uuid default uuid_generate_v4() primary key,
  audit_report_id uuid not null references public.ppm_audit_reports(id) on delete cascade,
  ppm_item_id uuid not null, -- reference to original ppm schedule/item
  has_completion_report boolean not null default false,
  attachment_url text,
  created_at timestamp with time zone default now()
);

create index if not exists idx_ppm_audit_items_report on public.ppm_audit_items (audit_report_id);
