-- Restrict the shared purchase mailbox to PROCUREMENT and SUPER ADMINS.
--
-- 20260801000003 granted SELECT on mailbox_threads to org_super_admin, org_admin,
-- master_admin, the three procurement roles AND `accounts`. That is wrong: the digest
-- exposes the contents of purchase@worksquare.in — vendor names, commercial terms, and
-- who is chasing whom. The accounts/finance team can reach the Payment Tracker but has no
-- business reading the purchase team's correspondence, and `org_admin` is broader than
-- intended for this one surface.
--
-- Narrowing rather than widening, deliberately: over-restricting is recoverable by adding
-- a role back, over-sharing correspondence is not.
--
-- Keep this list in step with MAILBOX_ROLES in backend/lib/mailbox/access.ts — the API
-- guard and this policy are one rule expressed twice. The dashboard tile reads through
-- that guarded route (service role), so this policy governs direct client reads.

DROP POLICY IF EXISTS "org members read mailbox threads" ON public.mailbox_threads;

CREATE POLICY "procurement and super admins read mailbox threads"
    ON public.mailbox_threads FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM organization_memberships om
        WHERE om.user_id = auth.uid()
          AND om.organization_id = mailbox_threads.organization_id
          AND om.is_active
          AND om.role::text IN ('org_super_admin', 'master_admin',
                                'purchase_manager', 'purchase_executive', 'procurement')
    )
    OR EXISTS (
        SELECT 1 FROM property_memberships pm
        WHERE pm.user_id = auth.uid()
          AND pm.organization_id = mailbox_threads.organization_id
          AND pm.is_active
          AND pm.role::text IN ('org_super_admin', 'master_admin',
                                'purchase_manager', 'purchase_executive', 'procurement')
    )
);
