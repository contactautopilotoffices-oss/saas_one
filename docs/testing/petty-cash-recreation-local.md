# Local petty cash branch recreation — 5 October 2026

Branch: `feat/petty-cash-allocation-wallet`, based on `497cc3b`, with existing local follow-up work preserved. Supplied historical follow-up commits e010f0a/b8f8139/f47aa4b/10c1381 were unavailable locally and through GitHub; no bundle or AGENTS.md was found in the workspace. Their requested behavior was recreated locally. The local implementation was verified before publication. The user subsequently authorized committing/pushing the feature branch and reviewing a draft pull request preview. Production merge/deployment, live transactions, migration application, data deletion and outbound notifications remain excluded.

## Actual verification

| Check | Result |
| --- | --- |
| Combined petty-cash, user-management, migration and dashboard focused tests | **80 passed**, 0 failed |
| Actual React wallet desktop/mobile and draft/routing browser cases | **3 passed**, 0 failed |
| Actual React User Directory loading/action scope browser cases | **12 passed**, 0 failed |
| StrictMode dashboard history and role-sidebar browser cases | **13 passed**, 0 failed |
| Existing WhatsApp regression suite, isolated fixtures | **37 passed**, 0 failed |
| TypeScript, `node --max-old-space-size=8192 node_modules/typescript/bin/tsc --noEmit --incremental false` | Passed |
| SQL migration linter and `git diff --check` | Passed |
| Lint comparison across changed code/tests | No per-file rule-count increases over HEAD; **299 inherited errors**, down from 309; new helpers/fixtures/tests clean |
| Production build/live acceptance | Not verified by this run; earlier build attempt was blocked by existing Google Fonts downloads |

Focused run comprises 41 petty-cash checks, 33 user/membership checks and 6 dashboard/scope checks. Browser checks use fixture identities and controlled data boundaries; wallet fixtures execute actual migrations in disposable PGlite. No real identities, receipts, balances, invitations or messages were used. The dashboard fixture supplies a controlled Next navigation boundary, not a full authenticated deployed Next application. Concurrent SQL coverage uses PGlite and does not replace production multi-connection acceptance.

Independent review found scoped-profile rejection, disappearing pending memberships, merged pending-state loss, property-only navigation, selected-org redirects and mixed-role shell issues. Each finding was reproduced and corrected with local regression coverage. A completed final independent re-review was not obtained after the review agent hit its session limit; final integrated checks and source review were completed locally.

## Migration and local acceptance

Retain the committed allocation/wallet migration `supabase/migrations/20261003000001_petty_cash_allocation_wallet.sql`. The two new additive files are `20261004000001_petty_cash_plan_completion.sql` and `20261005000001_membership_approval_scope.sql`. Apply none automatically.

Prerequisites: existing application users/organization/property membership schema; shared profile approval columns; membership update actor/time columns from `20260707000000_user_management_audit.sql`; Supabase auth/storage schemas and service/auth roles; prior petty-cash migrations `20260723000002`, `20260903000001` and `20260912000002`. Review backups and migration history, then apply only pending files manually through the project's approved process in chronological order. No `users.organization_id` column is added. Migration backfill never activates memberships. Historical inactive rows already attached to an approved profile stay inactive rather than being guessed pending.

The full permission matrix, migration order and manual requester → allocator → approver → accounts → expense/proof flow are in [the module guide](../features/petty_cash_module.md). Supporting navigation/directory/authorization notes are in the dated documents listed below. Configure fixture routing as org/ops super admin before submitting requests; test only in an explicitly authorized isolated preview database.

User-management writes retain separate Supabase requests; database failures can leave partial state. Employee profile provisioning retains best-effort existing behavior. Shared approval timestamp/reason fields remain shared, while membership state and actor/time are scoped. Receipt type/content checks do not authenticate invoices. Petty-cash notification delivery stays disabled; unrelated notification behavior is preserved.

## File-by-file local change manifest

This lists the working-tree delta over the existing feature HEAD, including preserved earlier local work. The committed allocation/wallet implementation remains part of the branch and was exercised by the focused and browser tests.

| File | Change |
| --- | --- |
| `app/(dashboard)/[orgId]/petty-cash/layout.tsx` | Delegate chrome to persistent parent shell. |
| `app/(dashboard)/layout.tsx` | Use one persistent role dashboard shell for dashboard and petty-cash routes; keep finance routes separate. |
| `app/api/petty-cash/assignments/route.ts` | Validate/save primary actors and eligible backups through atomic routing function. |
| `app/api/petty-cash/candidates/route.ts` | Admin-only, scoped and paginated eligible actor lookup. |
| `app/api/petty-cash/context/route.ts` | Expose own assigned properties separately from admin configuration properties and wallet/context capabilities. |
| `app/api/petty-cash/route.ts` | Keep drafts editable; enforce server submission gate and system-configured actors. |
| `app/api/properties/[propertyId]/approvers/route.ts` | Legacy lookup delegates to admin-only scoped routing candidates. |
| `app/api/users/approve/route.ts` | Resolve membership arrays; approve/reject exact scope; preserve unrelated active access and pending memberships; verified employee organization. |
| `app/api/users/assign-property/route.ts` | Retain org-super/master-only authority, validate property organization and persist approval/removal state. |
| `app/api/users/create/route.ts` | Active scoped user managers, ops support and master-creation restriction; persist membership state. |
| `app/api/users/invite/route.ts` | Active scoped managers and runtime role whitelist; preserve existing invitation behavior. |
| `app/api/users/list/route.ts` | List verified memberships including scoped pending rows; fix alias; enforce active caller/scope; merge pending state without losing controls. |
| `backend/lib/pettyCash/access.ts` | Selected organization access and audited master support; strict internal/property eligibility. |
| `backend/lib/pettyCash/actions.ts` | Pass server-selected organization into atomic actions and preserve reassignment notification call contract. |
| `backend/lib/pettyCash/notify.ts` | No-op delivery with no recipient lookup, outbound service or outbox effect. |
| `backend/lib/users/managementRoles.ts` | Shared action-specific user-management role predicates. |
| `docs/features/petty_cash_module.md` | Workflow, migration, verification or implementation documentation; preserves earlier local progress. |
| `docs/testing/2026-10-04-org-dashboard-tab-flicker.md` | Workflow, migration, verification or implementation documentation; preserves earlier local progress. |
| `docs/testing/2026-10-04-user-directory-loading.md` | Workflow, migration, verification or implementation documentation; preserves earlier local progress. |
| `docs/testing/2026-10-04-user-membership-authorization.md` | Workflow, migration, verification or implementation documentation; preserves earlier local progress. |
| `docs/testing/petty-cash-implementation-progress.md` | Workflow, migration, verification or implementation documentation; preserves earlier local progress. |
| `docs/testing/petty-cash-plan-completion-2026-10-04.md` | Workflow, migration, verification or implementation documentation; preserves earlier local progress. |
| `docs/testing/petty-cash-recreation-local.md` | Workflow, migration, verification or implementation documentation; preserves earlier local progress. |
| `frontend/components/accounts/AccountsDashboard.tsx` | Use independently authorized finance capabilities for selected organization. |
| `frontend/components/accounts/FinanceOverview.tsx` | Use independently authorized finance capabilities for selected organization. |
| `frontend/components/accounts/MailDigest.tsx` | Use independently authorized finance capabilities for selected organization. |
| `frontend/components/dashboard/MasterAdminDashboard.tsx` | Reuse established role sidebar and main-body slot; move Petty Cash into Management Hub and preserve role navigation. |
| `frontend/components/dashboard/MstDashboard.tsx` | Reuse established role sidebar and main-body slot; move Petty Cash into Management Hub and preserve role navigation. |
| `frontend/components/dashboard/OrgAdminDashboard.tsx` | Validated URL-owned tabs, user-action history and reused main-content slot; Management Hub link. |
| `frontend/components/dashboard/OrgDashboard.tsx` | Reuse established role sidebar and main-body slot; move Petty Cash into Management Hub and preserve role navigation. |
| `frontend/components/dashboard/ProcurementDashboard.tsx` | Reuse established role sidebar and main-body slot; move Petty Cash into Management Hub and preserve role navigation. |
| `frontend/components/dashboard/PropertyAdminDashboard.tsx` | Reuse established role sidebar and main-body slot; move Petty Cash into Management Hub and preserve role navigation. |
| `frontend/components/dashboard/SecurityDashboard.tsx` | Reuse established role sidebar and main-body slot; move Petty Cash into Management Hub and preserve role navigation. |
| `frontend/components/dashboard/SoftServiceManagerDashboard.tsx` | Reuse established role sidebar and main-body slot; move Petty Cash into Management Hub and preserve role navigation. |
| `frontend/components/dashboard/StaffDashboard.tsx` | Reuse established role sidebar and main-body slot; move Petty Cash into Management Hub and preserve role navigation. |
| `frontend/components/dashboard/UnifiedDashboard.tsx` | Choose selected-organization role shell; preserve accounts/BD routing and inject petty body for eligible internal roles. |
| `frontend/components/dashboard/UserDirectory.tsx` | Scope-gated fetch, visible errors/Retry, cancellation/stale response guard, exact organization/property action payloads. |
| `frontend/components/layout/AccountsWorkspace.tsx` | Independent scoped finance links, separate Management Hub petty link and active/mobile navigation. |
| `frontend/components/layout/DashboardContentSlot.tsx` | Reusable content provider and verified selected-org/property/role context, including mixed membership shells. |
| `frontend/components/layout/DashboardSidebar.tsx` | Management Hub Petty Cash placement with internal-role visibility. |
| `frontend/components/layout/PettyCashShell.tsx` | Persistent role dashboard host with internal-member access gate. |
| `frontend/components/pettyCash/ConsolidatedOverview.tsx` | Requester/actor filters and per-user wallet summaries with exact totals. |
| `frontend/components/pettyCash/ExpenseForm.tsx` | Reject missing vendor/evidence and retain correct expense ownership inputs. |
| `frontend/components/pettyCash/NewRequestModal.tsx` | Assigned-property selection and draft prepare/edit behavior without requester actor selection. |
| `frontend/components/pettyCash/PettyCashDashboard.tsx` | Draft actions and request gate/context wiring. |
| `frontend/components/pettyCash/PettyCashNavLink.tsx` | Active link and mobile close callback; resolve property-only organization from verified membership. |
| `frontend/components/pettyCash/PropertyRoutingSettings.tsx` | Primary/backup actor settings and explicit removal of unavailable configured backups. |
| `frontend/components/pettyCash/ReassignmentFields.tsx` | Explicit eligible actor reassignment fields. |
| `frontend/components/pettyCash/WorkflowRequestDetail.tsx` | Editable drafts, reassignment and payment-date controls with audit history. |
| `frontend/components/pettyCash/workflowTypes.ts` | Draft/payment and workflow context types. |
| `frontend/lib/accounts/roles.ts` | Finance capabilities scoped to selected organization; existing role grants unchanged. |
| `frontend/lib/dashboard/orgTabs.ts` | Tab validator and user-only history helper without copied framework markers. |
| `frontend/lib/pettyCash/roles.ts` | Payment-date type and existing scoped internal capabilities. |
| `package.json` | Focused petty-cash, user, dashboard and browser test commands. |
| `supabase/migrations/20261004000001_petty_cash_plan_completion.sql` | Additive routing backups, draft/legacy/payment-date/ownership and structured audit completion. |
| `supabase/migrations/20261005000001_membership_approval_scope.sql` | Additive membership approval state, conservative backfill and removal-aware triggers; no profile organization column. |
| `tests/dashboard/fixtures/app.tsx` | Isolated URL/history, role-shell and scope regression or controlled browser fixture. |
| `tests/dashboard/fixtures/navigation.tsx` | Isolated URL/history, role-shell and scope regression or controlled browser fixture. |
| `tests/dashboard/fixtures/state.ts` | Isolated URL/history, role-shell and scope regression or controlled browser fixture. |
| `tests/dashboard/org-tab-browser.test.mjs` | Isolated URL/history, role-shell and scope regression or controlled browser fixture. |
| `tests/dashboard/org-tab-sync.test.mjs` | Isolated URL/history, role-shell and scope regression or controlled browser fixture. |
| `tests/dashboard/scope.test.mjs` | Isolated URL/history, role-shell and scope regression or controlled browser fixture. |
| `tests/petty-cash/approver-compat.test.mjs` | Isolated petty-cash regression or fixture for workflow, routing, access, proof ownership, notifications and finance separation. |
| `tests/petty-cash/browser.test.mjs` | Isolated petty-cash regression or fixture for workflow, routing, access, proof ownership, notifications and finance separation. |
| `tests/petty-cash/database.mjs` | Isolated petty-cash regression or fixture for workflow, routing, access, proof ownership, notifications and finance separation. |
| `tests/petty-cash/finance-separation.test.mjs` | Isolated petty-cash regression or fixture for workflow, routing, access, proof ownership, notifications and finance separation. |
| `tests/petty-cash/fixtures/navigation.ts` | Isolated petty-cash regression or fixture for workflow, routing, access, proof ownership, notifications and finance separation. |
| `tests/petty-cash/notifications.test.mjs` | Isolated petty-cash regression or fixture for workflow, routing, access, proof ownership, notifications and finance separation. |
| `tests/petty-cash/plan-gaps.test.mjs` | Isolated petty-cash regression or fixture for workflow, routing, access, proof ownership, notifications and finance separation. |
| `tests/petty-cash/sidebar.test.mjs` | Isolated petty-cash regression or fixture for workflow, routing, access, proof ownership, notifications and finance separation. |
| `tests/users/action-roles.test.mjs` | Isolated user-management regression/fixture for listing, authorization, scoped approval or directory loading. |
| `tests/users/directory-loading.test.mjs` | Isolated user-management regression/fixture for listing, authorization, scoped approval or directory loading. |
| `tests/users/fixtures.mjs` | Isolated user-management regression/fixture for listing, authorization, scoped approval or directory loading. |
| `tests/users/list.test.mjs` | Isolated user-management regression/fixture for listing, authorization, scoped approval or directory loading. |
| `tests/users/membership-state.test.mjs` | Isolated user-management regression/fixture for listing, authorization, scoped approval or directory loading. |
