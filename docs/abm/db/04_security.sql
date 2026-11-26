-- Autopilot Offices ABM, hardening. Run after 01, 02 and 03.
--
-- Supabase serves every table in the public schema over PostgREST using the
-- anon key, and the anon key ships in client code. Without this file the whole
-- lead database would be readable and writable by anyone holding it.
--
-- The design here is deliberately strict: RLS is ON with NO policies, so anon
-- and authenticated can do nothing at all. service_role bypasses RLS, and
-- service_role is what Make uses. If a browser or mobile app ever needs to
-- read this data, add explicit policies then, not now.

alter table abm_leads  enable row level security;
alter table abm_dnc    enable row level security;
alter table abm_events enable row level security;

-- Views default to running with the owner's privileges, which would route
-- around the RLS above. security_invoker makes them run as the caller.
alter view v_abm_due_li_connect   set (security_invoker = on);
alter view v_abm_due_wa_intro     set (security_invoker = on);
alter view v_abm_due_li_message   set (security_invoker = on);
alter view v_abm_call_list        set (security_invoker = on);
alter view v_abm_due_wa_followup  set (security_invoker = on);
alter view v_abm_due_li_followup  set (security_invoker = on);
alter view v_abm_due_wa_final     set (security_invoker = on);
alter view v_abm_due_li_final     set (security_invoker = on);
alter view v_abm_to_expire        set (security_invoker = on);
alter view v_abm_retry_ready      set (security_invoker = on);
alter view v_abm_new_replies      set (security_invoker = on);
alter view v_abm_pipeline         set (security_invoker = on);
alter view v_abm_funnel           set (security_invoker = on);

-- The RPCs write data. Only service_role may call them.
--
-- IMPORTANT: Postgres grants EXECUTE on every new function to PUBLIC, and
-- anon and authenticated inherit that. Revoking from the two roles alone
-- leaves the PUBLIC grant intact and the function still callable. A probe
-- caught exactly this: anon could still call abm_intake. Always revoke from
-- public as well.
revoke execute on all functions in schema public from public, anon, authenticated;

-- service_role is what Make authenticates as. It bypasses RLS but still needs
-- ordinary grants, and tables created outside Supabase's normal migration path
-- do not get them automatically. Without this block Make is locked out too,
-- which a probe also caught.
grant usage   on schema public to service_role;
grant all privileges on all tables    in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute on all functions        in schema public to service_role;

alter default privileges in schema public grant all     on tables    to service_role;
alter default privileges in schema public grant all     on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- Pin search_path on every function. Without this a caller can prepend a
-- schema of their own and shadow the tables these functions touch.
alter function abm_day(date)                              set search_path = public, pg_temp;
alter function abm_is_sendable_phone(text)                set search_path = public, pg_temp;
alter function abm_is_dnc(abm_leads)                      set search_path = public, pg_temp;
alter function abm_touch_updated_at()                     set search_path = public, pg_temp;
alter function abm_is_live(abm_leads)                     set search_path = public, pg_temp;
alter function abm_normalise_phone(text)                  set search_path = public, pg_temp;
alter function abm_intake(text,text,jsonb)                set search_path = public, pg_temp;
alter function abm_mark_sent(uuid,text)                   set search_path = public, pg_temp;
alter function abm_record_reply(text,text,text,text)      set search_path = public, pg_temp;
alter function abm_record_answers(uuid,int,text,text)     set search_path = public, pg_temp;
alter function abm_mark_called(uuid,text)                 set search_path = public, pg_temp;
alter function abm_set_stage(uuid,text)                   set search_path = public, pg_temp;
alter function abm_add_dnc(text,text,text,text,text)      set search_path = public, pg_temp;
alter function abm_expire_sequences()                     set search_path = public, pg_temp;

-- Supabase's linter reports "RLS Enabled No Policy" at INFO level for the
-- three tables. That is this design working as intended, not a defect.
