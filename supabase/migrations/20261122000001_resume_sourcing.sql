-- Resume source and designation / role sourced for (separate from current job title).
-- Apply after 20261116000004_sourcing_duplicates.sql. No files or candidate details are changed.
-- Rollback: ALTER TABLE public.candidate_resume_files DROP COLUMN IF EXISTS sourced_role;
-- Detected sources are retained on rollback so provenance is not lost.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'candidate_resume_files' AND column_name = 'sourced_role'
  ) THEN
    ALTER TABLE public.candidate_resume_files
      ADD COLUMN sourced_role text CHECK (sourced_role IS NULL OR (length(btrim(sourced_role)) > 0 AND length(sourced_role) <= 200));

    -- Fill only unlabelled sources once; re-running must preserve later HR corrections, including Unknown.
    UPDATE public.candidate_resume_files
    SET source_kind = CASE WHEN file_name ILIKE '%naukri%' THEN 'naukri' ELSE 'portal' END,
        source_name = CASE WHEN file_name ILIKE '%linkedin%' THEN 'LinkedIn' ELSE NULL END
    WHERE source_kind IS NULL AND nullif(btrim(source_name), '') IS NULL
      AND ((file_name ILIKE '%naukri%') <> (file_name ILIKE '%linkedin%'));
  END IF;
END;
$$;

COMMIT;
