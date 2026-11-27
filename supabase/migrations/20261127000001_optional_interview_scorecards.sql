create or replace function public.require_offer_interviews() returns trigger
language plpgsql set search_path = public as $$
declare
  scheduled_count integer;
  completed_count integer;
begin
  select count(*) filter (where status = 'scheduled'), count(*) filter (where status = 'done')
    into scheduled_count, completed_count
    from public.recruitment_interviews
    where organization_id = new.organization_id and position_id = new.position_id and candidate_id = new.candidate_id;
  if scheduled_count > 0 then
    raise exception using errcode = 'P4201', message = 'Finish the scheduled interviews for this position before proposing an offer.';
  end if;
  if completed_count = 0 then
    raise exception using errcode = 'P4201', message = 'Complete an interview for this position before proposing an offer.';
  end if;
  return new;
end;
$$;
