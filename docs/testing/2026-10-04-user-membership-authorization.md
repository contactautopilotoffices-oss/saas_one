# User-management membership authorization

Updated 2026-10-05. Profiles in `public.users` are shared and have no `organization_id`. Directory scope comes from organization memberships and property memberships joined to their properties.

## Required schema and application order

Review and manually apply `supabase/migrations/20261005000001_membership_approval_scope.sql` before using these user-management routes. It adds nullable `approval_status` to each membership table, preserves existing inactive rows, and distinguishes pending approval from rejection/removal. It does not add an organization column to profiles. Existing `updated_by`/`updated_at` membership columns from `20260707000000_user_management_audit.sql` are also required. No database migration was applied during this work.

Membership status is authoritative for directory approval display when present. Active membership displays approved. Legacy NULL inactive status falls back to profile status; the migration conservatively backfills existing rows and future insert/update triggers maintain membership status. Audit logs are not used as authorization or approval-state authority.

## Permission matrix

All requests require authentication. Membership authorization requires an active row in the requested scope. Properties must belong to the supplied organization, including for master admins.

| Caller | Directory list | Invite | Create | Approve/reject | Assign property |
| --- | --- | --- | --- | --- | --- |
| Org super admin | Own organization/property | Own organization | Own organization | Own organization/property | Own organization |
| Ops super admin | Own organization/property | Own organization | Own organization; cannot create master admin | Own organization/property | Denied |
| Existing org admin/owner | Own organization/property | Own organization | Own organization | Own organization/property | Denied |
| Property admin | Own property only | Denied | Own property; cannot grant organization-wide role | Own property; cannot grant/activate organization-wide authority | Denied |
| Existing bd_super_admin | Existing approval grant only | Denied | Denied | Own organization/property | Denied |
| Master profile flag | Requested organization/property | Existing active org-admin membership still required by invite | Existing master-admin creation grant retained | Requested organization/property | Requested organization |
| Other/inactive membership | Denied | Denied | Denied | Denied | Denied |

Organization-only approval updates existing organization membership and all existing property memberships in that organization. Property approval updates exactly that property and never creates or activates organization membership. Ambiguous multi-organization approval requires `organizationId`, unless a supplied verified property resolves the organization. An entirely unassigned profile cannot be attributed to an organization or approved through it.

Rejection preserves shared profile approval if another verified active membership survives. Approving one scope preserves another membership's pending state. Explicit rejected/inactive memberships stay hidden from pending directory listings. Non-master callers cannot grant master-admin role through create, invite, approval, or property assignment. Existing authority is not extended to unrelated role labels; property-admin approval excludes organization authority labels including org_admin, admin/owner, and CRM admin variants.

## Isolated automated verification

```sh
node --test --test-isolation=none tests/users/list.test.mjs tests/users/action-roles.test.mjs
```

Backend subtask result: **31 tests passed, 0 failed**. Integration adds a regression ensuring organization summaries retain pending status when another membership is active; final suite and SQL migration counts are recorded in petty-cash-recreation-local.md. The shared fixture in `tests/users/fixtures.mjs` supplies a PostgREST-compatible in-memory boundary, a profile table without organization_id, multi-organization/property memberships, and mocked auth/notifications. No real account, database record, invitation, email, or WhatsApp message is created or sent.

The regressions cover pending organization/property listing, alias filtering, unassigned/rejected/deleted profiles, active ops, inactive and cross-organization denial, authenticated property-only requests, own-property admin scope, parameter mismatches, master creation/role restrictions, exact multi-membership approval/rejection, property-only approval without organization fabrication, verified employee-profile organization, cross-scope shared approval, persistent pending status, and removal state.

`git diff --check` passed for these changed backend/test files. Focused ESLint has 28 existing `no-explicit-any` errors and no warnings: list 24, create 3, approve 1; invite, assignment and the role helper are clean. HEAD baseline for the same routes has 33 errors and 3 warnings. The initial default-heap TypeScript check exhausted its 2 GB heap without obtaining diagnostics. The larger retry was canceled to avoid concurrent heavy checks; the coordinating task runs central TypeScript and broader regression verification.

## Manual fixture flow

Use an isolated test organization with two properties and a second isolated organization. Apply the reviewed schema migrations manually first. Give one test user inactive pending memberships in all three properties. As an active ops admin in the first organization, confirm organization/property lists show the user, property-only requests remain scoped, and property assignment is denied. As an org super admin, verify assignment only within the matching organization. Confirm a property admin sees its own property and cannot fetch organization-wide or another property's directory.

Approve the first property's user with explicit `organizationId` and `propertyId`. Confirm only its membership becomes active/approved, no organization membership is created, and the other organization still lists its inactive membership as pending. Approve the first organization without a property and confirm both existing properties in that organization activate, while the other organization stays unchanged. Reject one property while the other organization has active access; confirm that active access and shared profile approval remain intact. Reject an organization and confirm unrelated memberships stay unchanged. Do not invoke invitation or account creation against live users during a notification-free validation session.

## Remaining limitations

The API tests exercise real route logic with isolated dependency boundaries; they do not establish behavior of a hosted Supabase database, RLS, or the live notification services. Membership updates and shared profile updates retain separate Supabase writes rather than a transaction; a database failure can leave partial state. Employee-profile provisioning retains the existing best-effort generated employee-code behavior. Historical approval timestamps/reasons remain shared profile metadata, while membership status and update actor/time track the selected scope. Browser tests and central TypeScript verification belong to the coordinating task.

Integration TypeScript checking passed with an 8 GB heap. The organization summary now advertises pending approval if any visible membership remains pending, so merged active memberships cannot hide its approval controls.
