-- Candidate Search: scanned resumes (owner 2026-11-11).
--
-- A PDF with no text layer (a scan, a photo saved as PDF) used to stop at "couldn't be read". Now only those files
-- are sent to the model as the PDF itself (Control Center job 'candidate_extract', default Claude Haiku 5.5), which
-- types out what is on the pages. That text then takes the same path as any other resume: the "is it a resume?"
-- check, the email / phone match, and the details read into the candidate.
--
--   candidate_resume_files   text_status may hold 'scan' (waiting for the scan reader) and 'scanning' (being read)
--                            + scan_model, scan_tokens_in / scan_tokens_out (doctrine L14: cost per call)
--   The scans already marked unreadable are put back in the queue once (the last statement).
--
-- Safety:   ADDITIVE (nullable columns; the CHECK is widened, never narrowed). Until it is applied the app keeps
--           marking scans "couldn't be read", exactly as before.
-- Apply by hand after 20261111000002. Safe to re-run: a scan the reader gave up on carries a different message
-- and is not queued again.
-- Rollback: UPDATE public.candidate_resume_files SET text_status = 'unreadable' WHERE text_status IN ('scan', 'scanning');
--           restore the CHECK without the two values; DROP the three scan_ columns.

BEGIN;

alter table public.candidate_resume_files
  add column if not exists scan_model text,
  add column if not exists scan_tokens_in integer,
  add column if not exists scan_tokens_out integer;

alter table public.candidate_resume_files
  drop constraint if exists candidate_resume_files_text_status_check,
  add constraint candidate_resume_files_text_status_check
    check (text_status in ('pending', 'working', 'ready', 'unreadable', 'failed', 'scan', 'scanning'));

-- The scans uploaded before this migration: back in the queue, once.
update public.candidate_resume_files
set text_status = 'scan', text_error = null, text_attempts = 0, extract_status = 'pending', updated_at = now()
where status = 'ready'
  and text_status = 'unreadable'
  and text_error like 'No text in the file%'
  and lower(file_name) like '%.pdf';

COMMIT;
