alter table public.recruitment_offers
  add column approval_revision integer not null default 1,
  add column hod_approver_id uuid references auth.users(id),
  drop constraint recruitment_offers_current_level_check,
  add constraint recruitment_offers_current_level_check
    check (current_level is null or current_level in ('hiring_manager','hod','hr_head','director'));

create function public.require_offer_interviews() returns trigger
language plpgsql set search_path = public as $$
declare
  round_row record;
  completed boolean := false;
begin
  for round_row in
    select id, status, interviewer_ids from public.recruitment_interviews
    where organization_id = new.organization_id and position_id = new.position_id
      and candidate_id = new.candidate_id and status in ('scheduled','done')
  loop
    if round_row.status = 'scheduled' then
      raise exception using errcode = 'P4201', message = 'Finish the scheduled interviews for this position before proposing an offer.';
    end if;
    completed := true;
    if not exists (select 1 from public.recruitment_scorecards where interview_id = round_row.id and submitted_at is not null)
      or exists (select 1 from public.recruitment_scorecards where interview_id = round_row.id and submitted_at is null)
      or exists (select 1 from unnest(round_row.interviewer_ids) as panel(user_id)
        where not exists (select 1 from public.recruitment_scorecards c where c.interview_id = round_row.id
          and c.panel_user_id = panel.user_id and c.submitted_at is not null)) then
      raise exception using errcode = 'P4201', message = 'Collect all panel scorecards for each completed interview before proposing an offer.';
    end if;
  end loop;
  if not completed then
    raise exception using errcode = 'P4201', message = 'Complete an interview with panel feedback for this position before proposing an offer.';
  end if;
  return new;
end;
$$;

create trigger recruitment_offer_requires_interviews before insert on public.recruitment_offers
for each row execute function public.require_offer_interviews();
