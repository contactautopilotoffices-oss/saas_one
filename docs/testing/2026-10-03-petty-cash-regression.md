# Petty cash regression assessment — 2026-10-03

Branch: `feat/petty-cash-allocation-wallet`. Scope: current implementation, not the planned allocator/wallet feature.

## Result

The requested new flow is NOT IMPLEMENTED and cannot pass end-to-end testing. The branch contains planning documentation only; existing petty-cash product code matches `work`. TypeScript `tsc --noEmit` passed with exit code 0.

## Safety and test scope

- No live application, database or storage connections were used. No real requests, users, payments or evidence were created, modified or deleted.
- Temporary fixtures executed existing TypeScript modules with React server rendering, in-memory memberships and storage doubles. Lifecycle checks used plain objects only.
- Only this report was added to the repository during testing. No other module code was changed. This establishes change isolation; it does not claim a full live regression of unrelated modules.
- Shared-sidebar rendering substituted CapabilityWrapper with the same capability-matrix check used by authService. Fixtures used one active property membership and matching role metadata. Real multi-role/multi-property sessions remain untested.
- Dashboard request-button checks render the existing component with mocked auth/Supabase and no effects/network. Accounts workspace links were rendered separately.
- A standalone module link does not prove role-specific dashboard reachability or safe backend authorization.

## Requested live scenario

| Step | Status | Evidence |
| --- | --- | --- |
| Sign in as mst.ho@gmail.com and create request | BLOCKED | No configured Supabase credentials or signed-in sessions; no live request created |
| System configure Naresh as allocator | NOT IMPLEMENTED | No allocator stage or assignment endpoint; complete Naresh email is also missing |
| Naresh allocates cash | NOT IMPLEMENTED | Existing state machine returns Unknown action: allocate |
| Configure dipti@worksquare.in as approver and approve | NEW CONFIG NOT IMPLEMENTED | Existing selected-approver action works in a fixture, but no live Dipti session tested |
| Accounts sees and marks Paid | PARTIALLY PRESENT / LIVE UNTESTED | Pure state machine allows accounts payment from approved; list visibility not verified live |
| Credit requester wallet | NOT IMPLEMENTED | No wallet endpoint or wallet credit flow |
| Record individual wallet expenses | NOT IMPLEMENTED | Existing flow stores settlement totals and bill documents, not individual wallet transactions |
| Upload real invoice/evidence | LIVE UNTESTED | Upload handler exercised only with simulated storage; no file uploaded to real storage |

## Role-by-role isolated rendering and backend checks

Yes/No below describes the fixture outcome. A missing shared-sidebar link is a regression against the requested all-internal-role visibility. External roles with module/backend access are failures.

| Role | Shared FMS sidebar link | Accounts workspace link | Module New Request button | Backend access |
| --- | --- | --- | --- | --- |
| super_admin | Yes | Yes | Yes | Yes |
| org_admin | Yes | Yes | Yes | Yes |
| hr | No | Yes | Yes | Yes |
| hr_head | No | Yes | Yes | Yes |
| ops_super_admin | Yes | Yes | Yes | Yes |
| property_admin | Yes | Yes | Yes | Yes |
| manager_executive | Yes | Yes | Yes | Yes |
| purchase_manager | Yes | Yes | Yes | Yes |
| purchase_executive | Yes | Yes | Yes | Yes |
| mst | Yes | Yes | Yes | Yes |
| hk | Yes | Yes | Yes | Yes |
| fe | Yes | Yes | Yes | Yes |
| se | Yes | Yes | Yes | Yes |
| technician | Yes | Yes | Yes | Yes |
| field_staff | Yes | Yes | Yes | Yes |
| bms_operator | Yes | Yes | Yes | Yes |
| tenant_user | No | No | No | No |
| vendor | No | No | No | No |
| staff | Yes | Yes | Yes | Yes |
| soft_service_staff | Yes | Yes | Yes | Yes |
| soft_service_supervisor | Yes | Yes | Yes | Yes |
| soft_service_manager | Yes | Yes | Yes | Yes |
| super_tenant | No | No | No | No |
| bd_super_admin | No | Yes | Yes | Yes |
| bd_admin | No | Yes | Yes | Yes |
| bd_rep | No | Yes | Yes | Yes |
| accounts | Yes | Yes | Yes | Yes |
| org_super_admin | No | Yes | Yes | Yes |
| hr_manager | No | Yes | Yes | Yes |
| hr_ops | No | Yes | Yes | Yes |
| security | No | Yes | Yes | Yes |
| procurement | No | Yes | Yes | Yes |
| owner | No | Yes | Yes | Yes |
| admin | No | Yes | Yes | Yes |
| employee | No | Yes | Yes | Yes |
| tenant | No | No | No | No |
| tenant_admin | No | Yes | Yes | Yes |
| food_vendor | No | Yes | Yes | Yes |
| maintenance_vendor | No | Yes | Yes | Yes |
| pantry_vendor | No | Yes | Yes | Yes |
| cafeteria_vendor | No | Yes | Yes | Yes |
| external_vendor | No | Yes | Yes | Yes |

## Confirmed gaps

1. No allocation workflow, system-configured routing or requester wallet. Existing requester form still selects approver.
2. Single assigned property is prefilled, but its selector is still shown; planned no-selector behavior is absent.
3. HR roles return a dedicated nav list without Petty Cash. Pure BD/CRM roles lack the shared FMS link. Several internal metadata roles, including org_super_admin/security/procurement, have no exact petty-cash capability-matrix entry in the tested fixture. Real role fallback/membership combinations must be verified after login.
4. Backend and standalone module exclude only tenant/tenant_user/super_tenant/vendor. tenant_admin, food_vendor, maintenance_vendor, pantry_vendor, cafeteria_vendor and external_vendor passed the isolated backend resolver and displayed New Request.
5. Assigned approver can approve submitted directly; allocation is not required.
6. Settlement action accepts no proof; paid advance can be cancelled; negative approved amount is accepted by the transition planner. These are pure-function outcomes, not executed financial writes.
7. Upload handler checks file presence/15MB size and relies on storage MIME restrictions. An in-memory storage double accepted text named fake-invoice.pdf with application/pdf MIME; the handler has no PDF-content or invoice-authenticity validation. A simulated PDF upload does not establish real storage behavior or invoice validity.
8. Code review confirms detail GET lacks per-request owner/assignment authorization; same-property list/tracker scopes can widen access; proof URLs are public; these were not tested against live data.

## Checks that succeeded within their scope

- Existing state machine: selected approver approves submitted request; accounts marks approved request paid; repeated Paid from paid status is rejected.
- Oversized upload (16MiB) returns HTTP 400 before calling the storage double.
- tenant, tenant_user, super_tenant and vendor are denied by isolated backend resolver; their personal module does not show New Request.
- Existing TypeScript check passes.

## Next requirements for a live end-to-end run

Implement the reviewed petty-cash plan first. Then use an authorized test/staging URL and existing login sessions/method for requester, allocator, approver, super-admin configuration and accounts. Confirm Naresh’s full email and test amount/payment details. Configure Naresh and Dipti through super-admin system settings, not requester selection. Use clearly identified test records and test evidence, never mark an actual unpaid transaction as paid or present a generated fixture invoice as genuine proof. Leave all test records/evidence intact; do not clean up by deletion.

Local evidence: `/tmp/petty-cash-regression.cjs`, `/tmp/petty-cash-regression-results.json`, `/tmp/petty-cash-api-regression-results.json`. These are execution-workspace artifacts, not production data.
