-- Offer PDFs stay private with their offer. A release claim freezes the approved draft while it is being sent.
-- Rollback: drop letter_file_name, letter_pdf_base64, letter_release_started_at and approval_submitted_by from recruitment_offers.
-- The added image MIME types can stay enabled for existing recruitment documents.
begin;

alter table public.recruitment_offers
  add column if not exists letter_file_name text,
  add column if not exists letter_pdf_base64 text,
  add column if not exists letter_release_started_at timestamptz,
  add column if not exists approval_submitted_by uuid references auth.users(id) on delete set null;

alter table public.recruitment_offers drop constraint if exists recruitment_offers_letter_pdf_check;
alter table public.recruitment_offers add constraint recruitment_offers_letter_pdf_check check (
  (letter_file_name is null and letter_pdf_base64 is null)
  or (letter_file_name is not null and letter_pdf_base64 is not null and length(letter_pdf_base64) between 8 and 5592408)
);

update storage.buckets
set allowed_mime_types = array(
  select distinct mime from unnest(allowed_mime_types || array['image/jpeg', 'image/png', 'image/webp']) as mime
  order by mime
)
where id = 'candidate-resumes' and allowed_mime_types is not null;

notify pgrst, 'reload schema';
commit;
