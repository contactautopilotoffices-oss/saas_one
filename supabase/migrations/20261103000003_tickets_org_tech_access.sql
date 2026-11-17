-- =================================================================================
-- Migration: 20261103000003_tickets_org_tech_access.sql
-- Description: owner 2026-11-03 — the Tech console gets the Super Admin console's Requests tab (List / Board / Flow
--   Map) with the same actions (owner: "Full Super Admin actions"), for every ticket of the Tech user's own
--   organisation. Lists, deletes and asset work are checked in the API code; but opening a ticket, commenting and
--   status / assignment changes run with the user's own session, and the live row level security only admits property
--   staff, org admins and the assignee (20261102000004), so an org-level 'tech' login could not do them.
--   A user counts as Tech of an organisation when they hold an ACTIVE organization_memberships row with role 'tech'
--   in that organisation.
--   1. tickets_org_tech_select              SELECT the organisation's tickets
--   2. tickets_org_tech_update              UPDATE them (status, assignment, priority, edits); the ticket must stay
--                                           in an organisation where the user is Tech
--   3. ticket_comments_org_tech_select      SELECT the comments of those tickets
--   4. ticket_comments_org_tech_insert      INSERT a comment on them, as themselves
--   5. ticket_activity_log_org_tech_insert  INSERT the activity rows the ticket routes write with the user's session
-- Safety: ADDITIVE ONLY. Five new permissive policies; every existing policy is left as it is, so no one loses access.
--         Only org-level Tech members gain access, and only to their own organisation's tickets. No DELETE policy:
--         deleting goes through the API, which checks permissions in code and deletes with the service role.
--         Safe to re-run.
-- How to apply: run once in the Supabase SQL Editor.
-- Rollback:   DROP POLICY IF EXISTS tickets_org_tech_select ON public.tickets;
--             DROP POLICY IF EXISTS tickets_org_tech_update ON public.tickets;
--             DROP POLICY IF EXISTS ticket_comments_org_tech_select ON public.ticket_comments;
--             DROP POLICY IF EXISTS ticket_comments_org_tech_insert ON public.ticket_comments;
--             DROP POLICY IF EXISTS ticket_activity_log_org_tech_insert ON public.ticket_activity_log;
-- =================================================================================

BEGIN;

DROP POLICY IF EXISTS tickets_org_tech_select ON public.tickets;
CREATE POLICY tickets_org_tech_select ON public.tickets
    FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.organization_memberships m
        WHERE m.user_id = auth.uid() AND lower(m.role::text) = 'tech' AND coalesce(m.is_active, true)
          AND m.organization_id = tickets.organization_id
    ));

DROP POLICY IF EXISTS tickets_org_tech_update ON public.tickets;
CREATE POLICY tickets_org_tech_update ON public.tickets
    FOR UPDATE TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.organization_memberships m
        WHERE m.user_id = auth.uid() AND lower(m.role::text) = 'tech' AND coalesce(m.is_active, true)
          AND m.organization_id = tickets.organization_id
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.organization_memberships m
        WHERE m.user_id = auth.uid() AND lower(m.role::text) = 'tech' AND coalesce(m.is_active, true)
          AND m.organization_id = tickets.organization_id
    ));

DROP POLICY IF EXISTS ticket_comments_org_tech_select ON public.ticket_comments;
CREATE POLICY ticket_comments_org_tech_select ON public.ticket_comments
    FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.tickets t
        JOIN public.organization_memberships m ON m.organization_id = t.organization_id
        WHERE t.id = ticket_comments.ticket_id
          AND m.user_id = auth.uid() AND lower(m.role::text) = 'tech' AND coalesce(m.is_active, true)
    ));

DROP POLICY IF EXISTS ticket_comments_org_tech_insert ON public.ticket_comments;
CREATE POLICY ticket_comments_org_tech_insert ON public.ticket_comments
    FOR INSERT TO authenticated
    WITH CHECK (
        ticket_comments.user_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM public.tickets t
            JOIN public.organization_memberships m ON m.organization_id = t.organization_id
            WHERE t.id = ticket_comments.ticket_id
              AND m.user_id = auth.uid() AND lower(m.role::text) = 'tech' AND coalesce(m.is_active, true)
        )
    );

DROP POLICY IF EXISTS ticket_activity_log_org_tech_insert ON public.ticket_activity_log;
CREATE POLICY ticket_activity_log_org_tech_insert ON public.ticket_activity_log
    FOR INSERT TO authenticated
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.tickets t
        JOIN public.organization_memberships m ON m.organization_id = t.organization_id
        WHERE t.id = ticket_activity_log.ticket_id
          AND m.user_id = auth.uid() AND lower(m.role::text) = 'tech' AND coalesce(m.is_active, true)
    ));

COMMIT;
