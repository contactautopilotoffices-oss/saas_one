-- =================================================================================
-- Migration: 20261104000005_design_task_manager_no_whatsapp.sql
-- Description: owner 2026-11-04 — turn the Task Manager on for Shabbir Hussain (E150) and Raj Gawade (E179) of the Design
--   team, without any Task Manager WhatsApp message.
--   1) Pause Task Manager WhatsApp for the Design department (killSwitches.departmentHalt). This is the same switch as
--      the department kill switch in the Task Manager Control Centre.
--   2) Link their HR employee records to their logins. The records were never linked because the emails differ. This
--      also puts them in the Meeting Assistant's attendee list.
--   3) Switch the Task Manager ON for the Design department.
--   4) Record them as onboarded, source 'backfill': no kickoff message is sent, now or later.
-- WhatsApp: this file sends nothing. There are no triggers on these tables, and nothing here calls a sender.
--   Keep the Design pause ON for as long as they must not get messages. Limits of the pause (it is not a block on the
--   person's phone number):
--     - sends that carry no department still go out: a superuser's ping, and the reply relay to whoever gave a task;
--     - the bot still answers if they message it first;
--     - it does not cover other modules: their phone number becomes reachable through the link in step 2, so ticket and
--       meeting room alerts can reach them where those alerts are switched on.
-- Safety: changes only these rows. Aborts, changing nothing, if a record is not as expected. HR's email and phone on
--         the two records are left as they are. Safe to re-run.
-- How to apply: run this whole file once in the Supabase SQL Editor (no code deploy needed).
-- Rollback:
--   DELETE FROM public.task_manager_onboarding
--    WHERE user_id IN ('a5099fd2-7a5c-45bd-8b61-fca47112bce1', 'add030a1-f92b-4075-bd06-e5e285d5c629');
--   UPDATE public.task_manager_department_settings SET enabled = false, updated_at = NOW()
--    WHERE department_id = '00808f56-b3c1-4192-946a-faf9ff156299';
--   UPDATE public.employee_profiles SET user_id = NULL, reconciliation_status = 'unlinked', updated_at = NOW()
--    WHERE id IN ('763bd082-37f6-4d8e-9408-5fb67259f040', '4f264b91-fa35-47ed-9036-970bc933b4ca');
--   Then turn the Design pause off in the Control Centre. Do NOT do that while they are still onboarded, or they
--   start receiving Task Manager messages.
-- =================================================================================

BEGIN;

DO $$
DECLARE
    design_dept     CONSTANT UUID := '00808f56-b3c1-4192-946a-faf9ff156299';
    shabbir_profile CONSTANT UUID := '763bd082-37f6-4d8e-9408-5fb67259f040';
    shabbir_user    CONSTANT UUID := 'a5099fd2-7a5c-45bd-8b61-fca47112bce1';
    raj_profile     CONSTANT UUID := '4f264b91-fa35-47ed-9036-970bc933b4ca';
    raj_user        CONSTANT UUID := 'add030a1-f92b-4075-bd06-e5e285d5c629';
    changed INTEGER;
BEGIN
    -- 1. Pause WhatsApp first. The whole file is one transaction, so nobody is ever unlocked without the pause.
    UPDATE public.conversation_context
    SET context_data = jsonb_set(context_data, ARRAY['killSwitches', 'departmentHalt', design_dept::text], 'true'::jsonb, true),
        updated_at = NOW()
    WHERE phone_number = 'TEST_CONFIG'
      AND system = 'TASK_MANAGER'
      AND context_data #> '{killSwitches,departmentHalt}' IS NOT NULL;
    GET DIAGNOSTICS changed = ROW_COUNT;
    IF changed <> 1 THEN
        RAISE EXCEPTION 'Task Manager kill switch settings not found; nothing was changed.';
    END IF;

    -- 2. Link the HR records to the logins (never over a record that belongs to someone else)
    IF EXISTS (
        SELECT 1 FROM public.employee_profiles
        WHERE user_id IN (shabbir_user, raj_user) AND id NOT IN (shabbir_profile, raj_profile)
    ) THEN
        RAISE EXCEPTION 'One of these logins is already linked to another employee record; nothing was changed.';
    END IF;

    UPDATE public.employee_profiles
    SET user_id = shabbir_user, reconciliation_status = 'linked', updated_at = NOW()
    WHERE id = shabbir_profile AND is_active AND department_id = design_dept
      AND (user_id IS NULL OR user_id = shabbir_user);
    GET DIAGNOSTICS changed = ROW_COUNT;
    IF changed <> 1 THEN
        RAISE EXCEPTION 'Shabbir Hussain''s record (E150) is not as expected; nothing was changed.';
    END IF;

    UPDATE public.employee_profiles
    SET user_id = raj_user, reconciliation_status = 'linked', updated_at = NOW()
    WHERE id = raj_profile AND is_active AND department_id = design_dept
      AND (user_id IS NULL OR user_id = raj_user);
    GET DIAGNOSTICS changed = ROW_COUNT;
    IF changed <> 1 THEN
        RAISE EXCEPTION 'Raj Gawade''s record (E179) is not as expected; nothing was changed.';
    END IF;

    -- 3. Department ON
    INSERT INTO public.task_manager_department_settings (department_id, enabled, updated_by)
    VALUES (design_dept, true, 'migration: Design on, WhatsApp paused')
    ON CONFLICT (department_id) DO UPDATE
        SET enabled = true, updated_by = EXCLUDED.updated_by, updated_at = NOW();

    -- 4. Onboarded with no kickoff sent ('backfill', as the original Tech seed)
    INSERT INTO public.task_manager_onboarding (user_id, department_id, kickoff_type, source, recorded_by)
    VALUES
        (shabbir_user, design_dept, 'employee', 'backfill', 'migration: no kickoff sent'),
        (raj_user,     design_dept, 'employee', 'backfill', 'migration: no kickoff sent')
    ON CONFLICT (user_id) DO NOTHING;
END $$;

COMMIT;
