-- New connections wait for a reviewed import; existing scheduled connections retain their approval.
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'candidate_tracker_connections' and column_name = 'reviewed_at') then
    alter table public.candidate_tracker_connections add column reviewed_at timestamptz;
    update public.candidate_tracker_connections set reviewed_at = last_synced_at where last_ok = true;
  end if;
end $$;

alter table public.candidate_tracker_connections add column if not exists skipped_keys text[] not null default '{}';

alter table public.candidate_tracker_connections alter column sync_every set default 'manual';
