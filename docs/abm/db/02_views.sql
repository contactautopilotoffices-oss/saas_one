-- Autopilot Offices ABM, cadence queues.
-- Each view answers one question: "who gets this touch today?"
-- Make reads a view, sends, then calls abm_mark_sent(). No cadence logic in Make.
--
-- Day N of the sequence = (current_date - sequence_start) + 1, so the day the
-- sequence starts is Day 1. Every view uses >= rather than = so that a day
-- missed because a scenario was off is picked up the next run instead of
-- being skipped forever.

-- Day 1, LinkedIn connect request, no pitch. Everyone, all scores.
create or replace view v_abm_due_li_connect as
select l.* , abm_day(l.sequence_start) as day_n
from abm_leads l
where abm_is_live(l)
  and l.linkedin_url is not null
  and l.li_connect_sent_at is null
  and abm_day(l.sequence_start) >= 1;

-- Day 2, WhatsApp intro. HOT and WARM only, and only a sendable +91 mobile.
create or replace view v_abm_due_wa_intro as
select l.*, abm_day(l.sequence_start) as day_n
from abm_leads l
where abm_is_live(l)
  and l.score in ('HOT','WARM')
  and abm_is_sendable_phone(l.phone)
  and l.wa_intro_sent_at is null
  and abm_day(l.sequence_start) >= 2;

-- Day 3 to 5, LinkedIn message, only once the invite has been accepted.
create or replace view v_abm_due_li_message as
select l.*, abm_day(l.sequence_start) as day_n
from abm_leads l
where abm_is_live(l)
  and l.li_connected_at is not null
  and l.li_message_sent_at is null
  and abm_day(l.sequence_start) >= 3;

-- Day 4 to 5, the human call list. Deliberately NOT abm_is_live: the diagram
-- says HOT leads AND anyone who replied, and a reply is a reason to call, not
-- a reason to stop. DNC is still respected.
create or replace view v_abm_call_list as
select
  l.id, l.first_name, l.last_name, l.phone, l.company, l.designation,
  l.persona, l.score, l.why_now, l.call_opener, l.target_area,
  l.reply_intent, l.replied_at, l.q_seats, l.q_move_date, l.q_preferred_area,
  abm_day(l.sequence_start) as day_n,
  case when l.replied_at is not null then 1 else 2 end as priority
from abm_leads l
where not abm_is_dnc(l)
  and l.called_at is null
  and l.stage not in ('dnc','closed_won','closed_lost')
  and abm_is_sendable_phone(l.phone)
  and (
        l.replied_at is not null
     or (l.score = 'HOT' and abm_day(l.sequence_start) between 4 and 5)
  )
order by priority, l.score, l.company;

-- Day 6, follow-up one. WhatsApp and LinkedIn are separate rows to send.
create or replace view v_abm_due_wa_followup as
select l.*, abm_day(l.sequence_start) as day_n
from abm_leads l
where abm_is_live(l)
  and l.score in ('HOT','WARM')
  and abm_is_sendable_phone(l.phone)
  and l.wa_intro_sent_at is not null
  and l.wa_followup_sent_at is null
  and abm_day(l.sequence_start) >= 6;

create or replace view v_abm_due_li_followup as
select l.*, abm_day(l.sequence_start) as day_n
from abm_leads l
where abm_is_live(l)
  and l.li_connected_at is not null
  and l.li_message_sent_at is not null
  and l.li_followup_sent_at is null
  and abm_day(l.sequence_start) >= 6;

-- Day 8, final follow-up, then the sequence ends.
create or replace view v_abm_due_wa_final as
select l.*, abm_day(l.sequence_start) as day_n
from abm_leads l
where abm_is_live(l)
  and l.score in ('HOT','WARM')
  and abm_is_sendable_phone(l.phone)
  and l.wa_followup_sent_at is not null
  and l.wa_final_sent_at is null
  and abm_day(l.sequence_start) >= 8;

create or replace view v_abm_due_li_final as
select l.*, abm_day(l.sequence_start) as day_n
from abm_leads l
where abm_is_live(l)
  and l.li_connected_at is not null
  and l.li_followup_sent_at is not null
  and l.li_final_sent_at is null
  and abm_day(l.sequence_start) >= 8;

-- Past day 8 with no reply. These get closed and parked for 60 days.
create or replace view v_abm_to_expire as
select l.*, abm_day(l.sequence_start) as day_n
from abm_leads l
where abm_is_live(l)
  and abm_day(l.sequence_start) > 8;

-- Leads parked 60 days ago that may be approached again.
create or replace view v_abm_retry_ready as
select l.*
from abm_leads l
where l.retry_after is not null
  and l.retry_after <= current_date
  and not abm_is_dnc(l)
  and l.stage not in ('dnc','closed_won','closed_lost');

-- Anyone who replied and has not been dealt with yet. This is the alert queue.
create or replace view v_abm_new_replies as
select
  l.id, l.first_name, l.last_name, l.phone, l.company, l.designation,
  l.score, l.reply_channel, l.reply_intent, l.replied_at,
  l.q_seats, l.q_move_date, l.q_preferred_area, l.call_opener
from abm_leads l
where l.replied_at is not null
  and l.stage = 'replied'
  and not abm_is_dnc(l)
order by
  case l.reply_intent when 'interested' then 1 when 'question' then 2
                      when 'later' then 3 else 4 end,
  l.replied_at desc;

-- The tracker. One row per stage, for the weekly report to Saniel Sir.
create or replace view v_abm_pipeline as
select
  campaign,
  stage,
  count(*) as leads,
  count(*) filter (where score = 'HOT')  as hot,
  count(*) filter (where score = 'WARM') as warm,
  count(*) filter (where score = 'COLD') as cold
from abm_leads
group by campaign, stage
order by campaign, stage;

-- Funnel counts in one row, per campaign.
create or replace view v_abm_funnel as
select
  campaign,
  count(*)                                             as total,
  count(*) filter (where li_connect_sent_at is not null) as li_invited,
  count(*) filter (where li_connected_at   is not null) as li_accepted,
  count(*) filter (where wa_intro_sent_at  is not null) as wa_sent,
  count(*) filter (where replied_at        is not null) as replied,
  count(*) filter (where reply_intent = 'interested')   as interested,
  count(*) filter (where called_at         is not null) as called,
  count(*) filter (where stage = 'visit_booked')        as visits_booked,
  count(*) filter (where stage = 'proposal')            as proposals,
  count(*) filter (where stage = 'closed_won')          as won
from abm_leads
group by campaign;
