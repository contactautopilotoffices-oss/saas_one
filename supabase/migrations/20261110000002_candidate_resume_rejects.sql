-- Candidate Search: files that are not resumes are removed by themselves (owner 2026-11-10).
--
-- After a stored file's text is read (phase 2), a deterministic check (resume-text.ts, looksLikeResume: contact
-- details plus resume words, against job-description / invoice words) decides whether it is a resume. A file that is
-- not has its bytes deleted from the bucket, and its row is KEPT with status 'rejected' and the reason in text_error:
-- the row's hash is what stops the same file being uploaded again on the next "Upload new resumes", and the list can
-- show HR what was removed and why.
--
-- Safety:   ADDITIVE. One CHECK constraint widened (every existing value stays valid); no row changes.
-- Apply by hand after 20261110000001. Safe to re-run.
-- Rollback: DELETE FROM public.candidate_resume_files WHERE status = 'rejected'; then restore the old CHECK
--           (status in ('uploading', 'ready')).

BEGIN;

alter table public.candidate_resume_files
  drop constraint if exists candidate_resume_files_status_check,
  add constraint candidate_resume_files_status_check check (status in ('uploading', 'ready', 'rejected'));

create index if not exists candidate_resume_files_org_status_idx
  on public.candidate_resume_files (organization_id, status);

NOTIFY pgrst, 'reload schema';

COMMIT;
