-- Migration: Director role cleanup — restrict org_super_admin to the two actual Directors
-- Created: 2026-09-04
-- Depends on: 20260904000001_app_role_ops_super_admin.sql (MUST be applied and committed first)
--
-- BUSINESS DECISION (recorded, because this is not reversible by guesswork)
--   In Autopilot Offices the Directors are Saniel Golechha and Rushab Shah, and only they
--   should hold `org_super_admin`. Everyone else currently holding it is demoted to
--   `ops_super_admin`. Decision taken 2026-09-04; option "C" in docs/PEOPLE_DESK_PLAN.md §5.4,
--   chosen with the consequences below stated in advance.
--
-- WHAT THE FOUR DEMOTED USERS LOSE
--   org_super_admin is referenced 264 times across 123 files; ops_super_admin 48 times across
--   26, with zero RLS grants of its own. The demotion therefore removes, at org level:
--     · procurement approval (app/api/procurement/*)
--     · user management + invitations (app/api/users/*, InviteMemberModal, UserDirectory)
--     · property create/update (app/api/properties/*)
--     · petty cash approval (backend/lib/pettyCash/access.ts)
--     · meeting-room credit administration (app/api/meeting-room-credits/*)
--     · vendor management, Document Bank writes, CRM admin, agent administration
--   and leaves: users[view], tickets[view, approve], dashboards[view], reports[view],
--   plus electricity validation sign-off and dispute accept/reject.
--
--   NOTE ON SHAILESH KASHYAP: he separately holds an ACTIVE property_memberships row with
--   role 'property_admin'. That row is deliberately NOT touched here, so he keeps property
--   admin authority on his site. The other three demoted users have no property membership
--   and are org-level only after this runs.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT TOUCH
--   · jonny@123gmail.com — holds org_super_admin on the 'tcs' organisation, a DIFFERENT
--     tenant. Every statement below is filtered on the Autopilot Offices organization_id
--     precisely so a "demote everyone else" cannot reach across tenants.
--   · property_memberships — org-level roles only.
--   · Any RLS policy. Access changes as a consequence of the role value, nothing else.

BEGIN;

DO $$
DECLARE
    v_org_id   uuid := '211e1330-ad83-446d-941f-dcea48396798'; -- Autopilot Offices
    v_demoted  int;
    v_deact    int;
    v_kept     int;
BEGIN
    -- Guard: the enum value must already exist (20260904000001 applied and committed).
    IF NOT EXISTS (
        SELECT 1 FROM unnest(enum_range(NULL::public.app_role)) e
        WHERE e::text = 'ops_super_admin'
    ) THEN
        RAISE EXCEPTION
            'ops_super_admin is not in the app_role enum. Apply 20260904000001_app_role_ops_super_admin.sql first, in its own transaction.';
    END IF;

    -- Guard: refuse to run if the two Directors are not both present and active, rather
    -- than demoting the org into having no super admin at all.
    SELECT count(*) INTO v_kept
    FROM public.organization_memberships om
    JOIN public.users u ON u.id = om.user_id
    WHERE om.organization_id = v_org_id
      AND om.is_active
      AND om.role = 'org_super_admin'
      AND u.email IN ('saniel@worksquare.in', 'rushab@worksquare.in');

    IF v_kept <> 2 THEN
        RAISE EXCEPTION
            'Expected exactly 2 active Director memberships (saniel@, rushab@), found %. Aborting rather than leaving the org without a super admin.', v_kept;
    END IF;

    -- 1. Demote the four operational holders to ops_super_admin.
    WITH demoted AS (
        UPDATE public.organization_memberships om
        SET role = 'ops_super_admin'
        FROM public.users u
        WHERE u.id = om.user_id
          AND om.organization_id = v_org_id
          AND om.is_active
          AND om.role = 'org_super_admin'
          AND u.email IN (
              'dipti.walanj@worksquare.in',
              'naresh.laxman@worksquare.in',
              'shailesh.kashyap@worksquare.in',
              'shriharii@autopilotoffices.com'
          )
        RETURNING om.user_id, u.email
    )
    INSERT INTO public.user_management_audit_logs (action, target_user_id, admin_user_id, details)
    SELECT
        'update_role',   -- matches the vocabulary already in this table
        d.user_id,
        NULL, -- applied by migration, not by a signed-in admin
        jsonb_build_object(
            'from', 'org_super_admin',
            'to', 'ops_super_admin',
            'organization_id', v_org_id,
            'email', d.email,
            'reason', 'Director role cleanup — only Saniel and Rushab remain org_super_admin',
            'migration', '20260904000002_director_role_cleanup'
        )
    FROM demoted d;

    GET DIAGNOSTICS v_demoted = ROW_COUNT;

    -- 2. Deactivate the test account's production super-admin membership.
    --    Deactivated, not deleted or demoted: reversible, and it leaves the audit trail intact.
    WITH deact AS (
        UPDATE public.organization_memberships om
        SET is_active = false
        FROM public.users u
        WHERE u.id = om.user_id
          AND om.organization_id = v_org_id
          AND om.is_active
          AND u.email = 'test.autopilotoffices@gmail.com'
        RETURNING om.user_id, u.email, om.role::text AS old_role
    )
    INSERT INTO public.user_management_audit_logs (action, target_user_id, admin_user_id, details)
    SELECT
        'remove_org_membership',  -- soft form; see soft_deactivate below
        x.user_id,
        NULL,
        jsonb_build_object(
            'from_role', x.old_role,
            'soft_deactivate', true,   -- is_active = false, the row is NOT deleted
            'organization_id', v_org_id,
            'email', x.email,
            'reason', 'Test account held active org_super_admin on the production organisation',
            'migration', '20260904000002_director_role_cleanup'
        )
    FROM deact x;

    GET DIAGNOSTICS v_deact = ROW_COUNT;

    RAISE NOTICE 'Director role cleanup: % demoted to ops_super_admin, % membership(s) deactivated, % Directors retained.',
        v_demoted, v_deact, v_kept;
END $$;

COMMIT;

-- VERIFY AFTER APPLYING — expect exactly Saniel and Rushab:
--   SELECT u.email, om.role::text, om.is_active
--   FROM organization_memberships om JOIN users u ON u.id = om.user_id
--   WHERE om.organization_id = '211e1330-ad83-446d-941f-dcea48396798'
--     AND om.role IN ('org_super_admin','ops_super_admin')
--   ORDER BY om.role, u.email;
--
-- ROLLBACK (per user, if a demotion turns out to be wrong):
--   UPDATE organization_memberships SET role = 'org_super_admin'
--   WHERE organization_id = '211e1330-ad83-446d-941f-dcea48396798'
--     AND user_id = (SELECT id FROM users WHERE email = '<email>');
