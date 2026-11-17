-- =============================================================================
-- FIX: Step 4 of the ETPL re-import updated two rows instead of one
-- =============================================================================
-- Run this after reimport_etpl_ppm_inhouse_tracker.sql. Section 1 is a correction
-- and should be run. Section 2 is optional tidying.
--
-- WHAT WENT WRONG
--   Step 4 restored the one app-recorded completion with
--       WHERE detail_name = 'Rodent  Panel HUB Room C Wing'
--         AND planned_date = DATE '2025-10-11'
--   That pair is not unique. The same task exists on several floors, so it matched
--   TWO rows and wrote the 23-Jul-2026 completion and Altamash's name onto both:
--       si_no 60, 1st Floor  <- the row that really was ticked in the app
--       si_no 64, 3rd Floor  <- collateral, never had an app completion
--   191 of the 917 ETPL rows share a (detail_name, planned_date) pair with another
--   floor, so the WHERE should have been on id from the start. Every other
--   statement in the re-import keyed on id or inserted fresh rows, so this one
--   statement is the whole of the damage.
--
-- WHAT THE RECORDS ACTUALLY SAY
--   The tracker has both of these serviced on 11-Oct-2025.
--   The 23-Jul-2026 tick in the app was someone clearing an old row that the
--   broken import had left showing as pending — a catch-up tick, not a service
--   date. So the tracker date is the completion, and the tick is provenance.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- SECTION 1 - correction (keyed on id this time)
-- -----------------------------------------------------------------------------
BEGIN;

-- 3rd Floor (si_no 64): put the tracker's date back and drop the attribution that
-- was copied onto it by mistake.
UPDATE public.ppm_schedules SET
    done_date   = DATE '2025-10-11',
    attachments = '{}'::jsonb,
    updated_at  = now()
WHERE id = 'bb40f777-fd5d-4777-b846-19d5d02738dd';

-- 1st Floor (si_no 60): the tracker's date is the completion; keep who ticked it
-- and when, as provenance rather than as the service date.
UPDATE public.ppm_schedules SET
    done_date   = DATE '2025-10-11',
    attachments = jsonb_build_object(
                      'completed_by', '1a1d781a-1b3a-4dac-8d1b-1944ab5be743',
                      'completed_by_name', 'Altamash Sirajuddin Chaugule',
                      'completed_at', '2026-07-23T11:12:05.747Z',
                      'source', 'ticked done in the app on 23-Jul-2026 against the old mis-imported row; service date taken from the in-house tracker'
                  ),
    updated_at  = now()
WHERE id = '9013e9e1-dbd3-4d89-9ff0-bce70c7dae6c';

COMMIT;

-- If you would rather treat 23-Jul-2026 as the real service date for the 1st Floor
-- row, run this instead of the second statement above:
-- UPDATE public.ppm_schedules SET done_date = DATE '2026-07-23', updated_at = now()
-- WHERE id = '9013e9e1-dbd3-4d89-9ff0-bce70c7dae6c';


-- -----------------------------------------------------------------------------
-- SECTION 2 - OPTIONAL: one spelling per floor
-- -----------------------------------------------------------------------------
-- The tracker mixes cases, and the re-import kept them exactly as they were:
--     1st Floor 272 / 1st floor 33     3rd Floor 172 / 3rd floor 27
--     4th Floor 171 / 4th floor 27     2nd floor 204 (lower case throughout)
-- Any grouping or filtering by floor in the module treats those as different
-- places. This settles on title case for all four. Nothing else is touched.
BEGIN;

UPDATE public.ppm_schedules SET location = '1st Floor', updated_at = now()
WHERE property_id = 'bf345711-06fc-405f-b3a6-0a4888fff8b2' AND location = '1st floor';

UPDATE public.ppm_schedules SET location = '2nd Floor', updated_at = now()
WHERE property_id = 'bf345711-06fc-405f-b3a6-0a4888fff8b2' AND location = '2nd floor';

UPDATE public.ppm_schedules SET location = '3rd Floor', updated_at = now()
WHERE property_id = 'bf345711-06fc-405f-b3a6-0a4888fff8b2' AND location = '3rd floor';

UPDATE public.ppm_schedules SET location = '4th Floor', updated_at = now()
WHERE property_id = 'bf345711-06fc-405f-b3a6-0a4888fff8b2' AND location = '4th floor';

COMMIT;


-- -----------------------------------------------------------------------------
-- Verify (read-only)
-- -----------------------------------------------------------------------------
-- both Rodent Panel rows: 11-Oct-2025, attribution on the 1st Floor row only
SELECT si_no, location, planned_date, done_date, status,
       attachments->>'completed_by_name' AS ticked_by
FROM public.ppm_schedules
WHERE id IN ('9013e9e1-dbd3-4d89-9ff0-bce70c7dae6c',
             'bb40f777-fd5d-4777-b846-19d5d02738dd')
ORDER BY si_no;

-- after Section 2 this should list exactly: 1st Floor, 2nd Floor, 3rd Floor,
-- 4th Floor, All floor, Critical & Cabins
SELECT location, count(*) AS rows
FROM public.ppm_schedules
WHERE property_id = 'bf345711-06fc-405f-b3a6-0a4888fff8b2'
  AND location IS NOT NULL
GROUP BY 1 ORDER BY 1;
