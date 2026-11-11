-- Candidate Search: values worked out from a resume's employers (owner 2026-11-11).
--
-- When the resume's reader leaves the current designation, the current company or the total experience empty, the
-- app works them out from the employers the resume lists (the latest job; the months the employment dates cover).
-- Such a value is a reading of the dates, not something the resume states, so the person's row remembers which
-- fields were filled that way and the screens mark them "worked out". A value HR types in is no longer marked.
--
--   candidates   + inferred_fields text[]   any of: currentDesignation, currentOrganization, totalExpMonths
--
-- Safety:   ADDITIVE (one defaulted column). No view changes: the app reads the column from the table itself.
--           Until it is applied the values are still worked out and filled in; only the mark is missing.
-- Apply by hand after 20261111000003. Safe to re-run.
-- Rollback: ALTER TABLE public.candidates DROP COLUMN IF EXISTS inferred_fields;

BEGIN;

alter table public.candidates
  add column if not exists inferred_fields text[] not null default '{}';

COMMIT;
