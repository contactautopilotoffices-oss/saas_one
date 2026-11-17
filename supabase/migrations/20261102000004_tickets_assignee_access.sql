-- =================================================================================
-- Migration: 20261102000004_tickets_assignee_access.sql
-- Description: owner 2026-11-02 — the person a ticket is assigned to can always read and work it.
--   The org-level IT team (role 'it', no property membership) is assigned tickets across properties by @mention,
--   but the live row level security on public.tickets only admits property staff and org admins, so the IT login's
--   Requests list was empty and its tickets could not be opened or worked (Start / Pause / Complete).
--   1. tickets_assignee_select   SELECT where assigned_to = the signed-in user
--   2. tickets_assignee_update   UPDATE where assigned_to = the signed-in user (and it stays assigned to them)
-- Safety: ADDITIVE ONLY. Two new permissive policies; every existing policy is left as it is, so no one loses access
--         and no one gains access to tickets that are not assigned to them. Safe to re-run.
-- How to apply: run once in the Supabase SQL Editor.
-- Rollback:   DROP POLICY IF EXISTS tickets_assignee_select ON public.tickets;
--             DROP POLICY IF EXISTS tickets_assignee_update ON public.tickets;
-- =================================================================================

BEGIN;

DROP POLICY IF EXISTS tickets_assignee_select ON public.tickets;
CREATE POLICY tickets_assignee_select ON public.tickets
    FOR SELECT TO authenticated
    USING (assigned_to = auth.uid());

DROP POLICY IF EXISTS tickets_assignee_update ON public.tickets;
CREATE POLICY tickets_assignee_update ON public.tickets
    FOR UPDATE TO authenticated
    USING (assigned_to = auth.uid())
    WITH CHECK (assigned_to = auth.uid());

COMMIT;
