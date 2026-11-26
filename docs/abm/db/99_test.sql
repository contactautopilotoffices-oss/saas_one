-- Autopilot Offices ABM, full test suite.
-- Run after 01, 02, 03 on a THROWAWAY database. It writes test data.
--   psql -f 01_schema.sql -f 02_views.sql -f 03_functions.sql -f 99_test.sql
-- Every check prints PASS or FAIL. Any FAIL means do not go live.

\set ON_ERROR_STOP on
\pset pager off
\t on

create or replace function chk(label text, got anyelement, want anyelement)
returns text language sql as $$
  select case when got is not distinct from want
              then 'PASS  ' || label
              else 'FAIL  ' || label || '   got=' || coalesce(got::text,'null')
                   || ' want=' || coalesce(want::text,'null') end;
$$;

create or replace function set_day(n int) returns void language sql as $$
  update abm_leads set sequence_start = current_date - (n-1);
$$;

select '--- INTAKE, DEDUP, DNC ---';
do $$ begin perform abm_add_dnc('9820000001', null, null, null, 'pre-existing'); end $$;
with r as (
  select abm_intake('T1','Andheri East','[
   {"first_name":"Pranesh","linkedin_url":"https://linkedin.com/in/pranesh123","phone":"+919820020906",
    "company":"Brandscapes","persona":"founder","score":"HOT","why_now":"hiring now"},
   {"first_name":"Viren","linkedin_url":"https://linkedin.com/in/viren","phone":"9821074005",
    "company":"MBM","persona":"finance","score":"WARM","why_now":"big deposit"},
   {"first_name":"Anand","linkedin_url":"https://linkedin.com/in/anand","phone":"+18486672570",
    "company":"Sequretek","persona":"founder","score":"HOT","why_now":"raised funding"},
   {"first_name":"Cold","linkedin_url":"https://linkedin.com/in/cold","phone":"9876543210",
    "company":"ColdCo","persona":"hr","score":"COLD"},
   {"first_name":"Dupe","linkedin_url":"https://LINKEDIN.com/in/PRANESH123","phone":"9999999999",
    "company":"Dupe","score":"HOT"},
   {"first_name":"Blocked","linkedin_url":"https://linkedin.com/in/blocked","phone":"9820000001",
    "company":"BlockedCo","score":"HOT"}]'::jsonb) as j
)
select chk('4 leads inserted',            (j->>'inserted')::int,   4) from r
union all select chk('1 duplicate blocked (case-insensitive URL)', (j->>'duplicates')::int, 1) from r
union all select chk('1 DNC blocked at intake',                    (j->>'dnc_blocked')::int, 1) from r;

select chk('US number rejected as unsendable',
       (select abm_is_sendable_phone(phone) from abm_leads where first_name='Anand'), false);
select chk('10-digit number normalised to 91...',
       (select phone from abm_leads where first_name='Viren'), '919821074005');

select '--- CADENCE QUEUES, 8 DAY ---';
do $$ begin perform set_day(1); end $$;
select chk('Day 1: 4 due for LinkedIn connect', (select count(*)::int from v_abm_due_li_connect), 4);
select chk('Day 1: WhatsApp queue empty',       (select count(*)::int from v_abm_due_wa_intro), 0);
do $$ begin perform set_day(2); end $$;
select chk('Day 2: 2 due for WhatsApp (COLD and US-number excluded)',
       (select count(*)::int from v_abm_due_wa_intro), 2);
do $$ begin perform set_day(3); end $$;
select chk('Day 3: LinkedIn message empty until invite accepted',
       (select count(*)::int from v_abm_due_li_message), 0);
do $$ begin perform abm_mark_sent(id,'li_accepted') from abm_leads where first_name='Pranesh'; end $$;
select chk('Day 3: due once accepted', (select count(*)::int from v_abm_due_li_message), 1);
do $$ begin perform set_day(4); end $$;
select chk('Day 4: call list holds the HOT lead with a valid mobile',
       (select string_agg(first_name,',') from v_abm_call_list), 'Pranesh');
do $$ begin perform set_day(6); end $$;
select chk('Day 6: follow-up empty before intro was sent',
       (select count(*)::int from v_abm_due_wa_followup), 0);
do $$ begin perform abm_mark_sent(id,'wa_intro') from abm_leads where first_name in ('Pranesh','Viren'); end $$;
select chk('Day 6: 2 due for follow-up', (select count(*)::int from v_abm_due_wa_followup), 2);
do $$ begin perform abm_mark_sent(id,'wa_followup') from abm_leads where first_name in ('Pranesh','Viren'); end $$;
do $$ begin perform set_day(7); end $$;
select chk('Day 7: final not yet due', (select count(*)::int from v_abm_due_wa_final), 0);
do $$ begin perform set_day(8); end $$;
select chk('Day 8: 2 due for final',   (select count(*)::int from v_abm_due_wa_final), 2);

select '--- REPLY CLASSIFICATION ---';
select chk('"Yes, share options" = interested',
       (abm_record_reply('919820020906',null,'whatsapp','Yes, share options'))->>'intent', 'interested');
select chk('interested raises an alert',
       (select (replied_at is not null and reply_intent='interested') from abm_leads where first_name='Pranesh'), true);
select chk('"Not right now" = later, NOT interested',
       (abm_record_reply('919821074005',null,'whatsapp','Not right now'))->>'intent', 'later');
select chk('"not interested" = not_interested',
       (abm_record_reply('919876543210',null,'whatsapp','not interested, remove me'))->>'intent', 'not_interested');
select chk('refusal moved lead to dnc stage',
       (select stage::text from abm_leads where first_name='Cold'), 'dnc');
select chk('refusal written to DNC table',
       (select count(*)::int from abm_dnc where phone='919876543210'), 1);
select chk('re-importing a DNC person is blocked',
       ((abm_intake('T2','Andheri East','[{"first_name":"Cold","linkedin_url":"https://li/x",
         "phone":"9876543210","company":"ColdCo","score":"HOT"}]'::jsonb))->>'dnc_blocked')::int, 1);

select '--- CROSS-CHANNEL STOP ---';
select chk('a reply removes the lead from every WhatsApp queue',
       (select count(*)::int from (
          select id from v_abm_due_wa_intro union all
          select id from v_abm_due_wa_followup union all
          select id from v_abm_due_wa_final) q
        where id in (select id from abm_leads where replied_at is not null)), 0);
select chk('a reply removes the lead from every LinkedIn queue',
       (select count(*)::int from (
          select id from v_abm_due_li_connect union all
          select id from v_abm_due_li_message union all
          select id from v_abm_due_li_followup union all
          select id from v_abm_due_li_final) q
        where id in (select id from abm_leads where replied_at is not null)), 0);

select '--- EXPIRY AND RETRY ---';
do $$ begin perform set_day(9); end $$;
select chk('Day 9: the no-reply lead expires',
       ((abm_expire_sequences())->>'expired')::int, 1);
select chk('expired lead parked 60 days out',
       (select retry_after from abm_leads where first_name='Anand'), (current_date + 60));

select '--- SUMMARY ---';
\t off
select * from v_abm_funnel;
