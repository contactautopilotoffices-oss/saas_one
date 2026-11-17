-- =================================================================================
-- Migration: 20261019000001_task_manager_team_controls.sql
-- Description: four new switches per department for the Task Manager (owner 2026-10-19). All start OFF.
--   team_assign      "Assign to anyone in team": everyone may GIVE a task to anyone in the same department
--                    (a colleague, or their own manager to ask for support). SEEING tasks still follows the
--                    reporting chain (yourself and the people below you).
--   pending_on       "Pending on…": a person may tell a colleague in the team that one of their own tasks is
--                    waiting on them (in-app notification + WhatsApp alert).
--   protect_given    "Protect given tasks": a task someone else gave you cannot be deleted or renamed by you;
--                    only the giver, someone above the giver, or a superuser may.
--   assigned_tab     "Assigned by me" tab: shows the tasks you gave (edit / delete) and, for managers, the
--                    tasks given by the people below them (view only).
-- Safety: ADDITIVE ONLY. Adds four columns with a safe default (false) to the table created by
--         20261007000001. Nothing changes until you switch a department ON in the Control Center.
-- How to apply: run this file once in the Supabase SQL Editor (after 20261007000001).
-- Rollback:   ALTER TABLE public.task_manager_department_settings
--                 DROP COLUMN team_assign, DROP COLUMN pending_on, DROP COLUMN protect_given, DROP COLUMN assigned_tab;
-- =================================================================================

ALTER TABLE public.task_manager_department_settings
    ADD COLUMN IF NOT EXISTS team_assign   BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS pending_on    BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS protect_given BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS assigned_tab  BOOLEAN NOT NULL DEFAULT false;
