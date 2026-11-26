-- Existing grants are pinned to a client only after Zoho accepts a refresh.
alter table public.candidate_resume_mail_connections add column if not exists oauth_client_id text;
alter table public.candidate_resume_mail_oauth add column if not exists oauth_client_id text;
