-- Autopilot Offices ABM, the API Make talks to.
-- Every one of these is callable over HTTP at
--   POST {SUPABASE_URL}/rest/v1/rpc/<function_name>
-- with headers apikey + Authorization: Bearer <service_role_key>.
-- Make never writes tables directly, it only calls these.

-- ---------------------------------------------------------------------------
-- Phone normalisation. Accepts anything, returns 91XXXXXXXXXX or null.
-- ---------------------------------------------------------------------------
create or replace function abm_normalise_phone(raw text)
returns text language plpgsql immutable as $$
declare d text;
begin
  if raw is null then return null; end if;
  d := regexp_replace(raw, '[^0-9]', '', 'g');
  if length(d) = 10 and substring(d,1,1) between '6' and '9' then
    return '91' || d;
  elsif length(d) = 12 and left(d,2) = '91' and substring(d,3,1) between '6' and '9' then
    return d;
  elsif length(d) = 11 and left(d,1) = '0' then
    return '91' || right(d,10);
  end if;
  -- Anything else (US numbers, landlines, junk) is not WhatsApp-sendable.
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- Intake. Claude posts a batch; this dedups and starts the clock.
-- Returns how many were inserted, skipped as duplicates, and skipped as DNC.
-- ---------------------------------------------------------------------------
create or replace function abm_intake(
  p_campaign      text,
  p_target_office text,
  p_leads         jsonb
) returns jsonb language plpgsql as $$
declare
  r           jsonb;
  v_phone     text;
  v_li        text;
  n_in        int := 0;
  n_dup       int := 0;
  n_dnc       int := 0;
begin
  for r in select * from jsonb_array_elements(p_leads) loop
    v_phone := abm_normalise_phone(r->>'phone');
    v_li    := nullif(trim(r->>'linkedin_url'), '');

    -- DNC check first, before anything is written.
    if exists (
      select 1 from abm_dnc d
      where (d.phone is not null and d.phone = v_phone)
         or (d.linkedin_url is not null and lower(d.linkedin_url) = lower(v_li))
         or (d.email is not null and lower(d.email) = lower(r->>'email'))
         or (d.domain is not null and lower(d.domain) = lower(r->>'company_domain'))
    ) then
      n_dnc := n_dnc + 1;
      continue;
    end if;

    -- Dedup on LinkedIn URL or phone.
    if exists (
      select 1 from abm_leads l
      where (v_li is not null and lower(l.linkedin_url) = lower(v_li))
         or (v_phone is not null and l.phone = v_phone)
    ) then
      n_dup := n_dup + 1;
      continue;
    end if;

    insert into abm_leads (
      first_name, last_name, linkedin_url, phone, email, email_status,
      company, company_domain, company_location, target_area, employees,
      industry, designation, persona, score, why_now, call_opener, notes,
      campaign, target_office, sequence_start, stage
    ) values (
      coalesce(nullif(trim(r->>'first_name'),''), 'there'),
      nullif(trim(r->>'last_name'),''),
      v_li,
      v_phone,
      nullif(trim(r->>'email'),''),
      nullif(trim(r->>'email_status'),''),
      coalesce(nullif(trim(r->>'company'),''), 'your company'),
      nullif(trim(r->>'company_domain'),''),
      nullif(trim(r->>'company_location'),''),
      nullif(trim(r->>'target_area'),''),
      nullif(r->>'employees','')::int,
      nullif(trim(r->>'industry'),''),
      nullif(trim(r->>'designation'),''),
      coalesce(nullif(trim(r->>'persona'),'')::abm_persona, 'other'),
      coalesce(nullif(trim(r->>'score'),'')::abm_score, 'COLD'),
      nullif(trim(r->>'why_now'),''),
      nullif(trim(r->>'call_opener'),''),
      nullif(trim(r->>'notes'),''),
      p_campaign,
      p_target_office,
      current_date,
      'new'
    );
    n_in := n_in + 1;
  end loop;

  return jsonb_build_object(
    'inserted', n_in, 'duplicates', n_dup, 'dnc_blocked', n_dnc,
    'campaign', p_campaign
  );
end $$;

-- ---------------------------------------------------------------------------
-- Mark a touch as sent. Make calls this straight after a successful send.
-- touch: li_connect | li_accepted | li_message | li_followup | li_final
--      | wa_intro   | wa_followup | wa_final
-- ---------------------------------------------------------------------------
create or replace function abm_mark_sent(p_lead uuid, p_touch text)
returns abm_leads language plpgsql as $$
declare out_row abm_leads;
begin
  update abm_leads set
    li_connect_sent_at  = case when p_touch='li_connect'  then now() else li_connect_sent_at  end,
    li_connected_at     = case when p_touch='li_accepted' then now() else li_connected_at     end,
    li_message_sent_at  = case when p_touch='li_message'  then now() else li_message_sent_at  end,
    li_followup_sent_at = case when p_touch='li_followup' then now() else li_followup_sent_at end,
    li_final_sent_at    = case when p_touch='li_final'    then now() else li_final_sent_at    end,
    wa_intro_sent_at    = case when p_touch='wa_intro'    then now() else wa_intro_sent_at    end,
    wa_followup_sent_at = case when p_touch='wa_followup' then now() else wa_followup_sent_at end,
    wa_final_sent_at    = case when p_touch='wa_final'    then now() else wa_final_sent_at    end,
    stage = case when stage = 'new' then 'contacted' else stage end
  where id = p_lead
  returning * into out_row;

  insert into abm_events (lead_id, channel, event)
  values (
    p_lead,
    case when p_touch like 'wa_%' then 'whatsapp'::abm_channel else 'linkedin'::abm_channel end,
    p_touch
  );

  return out_row;
end $$;

-- ---------------------------------------------------------------------------
-- Record an inbound reply, classify the intent, and stop the sequence.
-- This is the fix for the old behaviour where every reply was logged as "Yes".
-- Identify by phone (WhatsApp) or linkedin_url (LinkedIn).
-- ---------------------------------------------------------------------------
create or replace function abm_record_reply(
  p_phone        text,
  p_linkedin_url text,
  p_channel      text,
  p_body         text
) returns jsonb language plpgsql as $$
declare
  v_lead   abm_leads;
  v_phone  text := abm_normalise_phone(p_phone);
  v_intent abm_intent;
  v_body   text := lower(coalesce(p_body,''));
begin
  select * into v_lead from abm_leads
  where (v_phone is not null and phone = v_phone)
     or (p_linkedin_url is not null and lower(linkedin_url) = lower(p_linkedin_url))
  order by created_at desc limit 1;

  if v_lead.id is null then
    return jsonb_build_object('matched', false, 'reason', 'no lead for that phone or profile');
  end if;

  -- Intent. Order matters: check refusal before interest, because
  -- "not interested" contains "interested".
  if v_body ~ '(not interested|no thanks|no thank you|stop|unsubscribe|remove me|don''t contact|do not contact)' then
    v_intent := 'not_interested';
  elsif v_body ~ '(not right now|not now|later|next year|next quarter|few months|maybe later|busy)' then
    v_intent := 'later';
  elsif v_body ~ '(yes|sure|share|send|interested|options|pricing|price|details|tell me|how much|visit)' then
    v_intent := 'interested';
  elsif v_body ~ '\?' then
    v_intent := 'question';
  else
    v_intent := 'unknown';
  end if;

  update abm_leads set
    replied_at    = coalesce(replied_at, now()),
    reply_channel = p_channel::abm_channel,
    reply_intent  = v_intent,
    stage         = case when v_intent = 'not_interested' then 'dnc'::abm_stage
                         else 'replied'::abm_stage end,
    stopped_at    = now(),
    stopped_reason= 'replied: ' || v_intent
  where id = v_lead.id;

  insert into abm_events (lead_id, channel, event, detail, payload)
  values (v_lead.id, p_channel::abm_channel, 'reply_in', v_intent,
          jsonb_build_object('body', p_body));

  -- A refusal is permanent. Never contact again, on any channel.
  if v_intent = 'not_interested' then
    insert into abm_dnc (phone, linkedin_url, email, reason)
    values (v_lead.phone, v_lead.linkedin_url, v_lead.email, 'said not interested');
  end if;

  return jsonb_build_object(
    'matched', true,
    'lead_id', v_lead.id,
    'name', v_lead.first_name,
    'company', v_lead.company,
    'intent', v_intent,
    'alert', v_intent in ('interested','question')
  );
end $$;

-- ---------------------------------------------------------------------------
-- The three qualifying questions.
-- ---------------------------------------------------------------------------
create or replace function abm_record_answers(
  p_lead uuid, p_seats int, p_move_date text, p_area text
) returns abm_leads language sql as $$
  update abm_leads set
    q_seats = coalesce(p_seats, q_seats),
    q_move_date = coalesce(p_move_date, q_move_date),
    q_preferred_area = coalesce(p_area, q_preferred_area)
  where id = p_lead returning *;
$$;

create or replace function abm_mark_called(p_lead uuid, p_outcome text)
returns abm_leads language sql as $$
  update abm_leads set called_at = now(), call_outcome = p_outcome,
    stage = case when stage in ('new','contacted','replied') then 'called'::abm_stage else stage end
  where id = p_lead returning *;
$$;

create or replace function abm_set_stage(p_lead uuid, p_stage text)
returns abm_leads language sql as $$
  update abm_leads set stage = p_stage::abm_stage where id = p_lead returning *;
$$;

create or replace function abm_add_dnc(
  p_phone text, p_linkedin_url text, p_email text, p_domain text, p_reason text
) returns abm_dnc language sql as $$
  insert into abm_dnc (phone, linkedin_url, email, domain, reason)
  values (abm_normalise_phone(p_phone), p_linkedin_url, p_email, p_domain,
          coalesce(p_reason,'manual'))
  returning *;
$$;

-- ---------------------------------------------------------------------------
-- Daily housekeeping. Closes sequences past day 14 and parks them for 60 days.
-- Run once a day from Make.
-- ---------------------------------------------------------------------------
create or replace function abm_expire_sequences()
returns jsonb language plpgsql as $$
declare n int;
begin
  with done as (
    update abm_leads l set
      stopped_at = now(),
      stopped_reason = 'no reply through day 8',
      retry_after = current_date + 60,
      stage = case when stage = 'contacted' then 'contacted'::abm_stage else stage end
    where l.id in (select id from v_abm_to_expire)
    returning 1
  )
  select count(*) into n from done;
  return jsonb_build_object('expired', n, 'retry_after_days', 60);
end $$;
