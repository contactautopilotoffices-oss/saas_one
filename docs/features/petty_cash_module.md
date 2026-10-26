# Petty Cash allocation, approval and wallets

Changes are prepared on `feat/petty-cash-allocation-wallet`. After local verification, the user authorized publishing this feature branch for preview review. Production merge/deployment, database migration application, live transactions and notifications remain outside this authorization. The workflow at commit `497cc3b` was retained and extended. The four supplied follow-up commit objects were unavailable locally and through GitHub, so their behavior was recreated in the current files.

## Workflow

1. An eligible requester prepares a draft or submits an advance for an actively assigned property. A single assigned property is selected automatically; multiple assignments show only eligible properties.
2. The server resolves the property's configured primary allocator and approver. Requesters cannot choose these actors. Missing routing is an explicit error. The request retains its actor assignments for audit.
3. The assigned allocator records an amount and remarks. The assigned approver approves, rejects or sends the request back. Bulk allocation and approval return independent per-item results with the same authorization and state checks as individual actions.
4. Accounts records payment mode, reference, payment date and evidence. Atomic SQL and a unique request credit prevent duplicate wallet credit on retries or concurrent payments.
5. The requester records dated expenses, category/purpose, vendor where relevant and optional bills or receipts. An expense and its wallet debit are atomic and idempotent. Overspending fails.
6. A new advance is permitted when the wallet is exactly zero, no expenses are rejected, and no earlier request is pending. Pending expense review does not require accounts closure. An acknowledgement cannot bypass the gate.

Drafts do not reserve a pending pipeline; submission enforces the gate. Sent-back changes of property resolve the new property's routing and restart allocation. Admins can explicitly reassign to the eligible configured allocator and approver; changing routing settings never silently changes existing requests. Before/after activity records retain previous decisions when reassignment resets them.

Historical requests, documents, activity and settlement records remain readable. Pending legacy advances require explicit reassignment into the allocation workflow. Historical reimbursements remain read-only history and do not contribute to advance wallet balances or blockers.

## Permissions

All access requires authentication and verified active memberships in the selected organization. The API, SQL functions and private-document checks enforce access independently of navigation visibility.

Membership roles can be stored as the PostgreSQL `app_role` enum. Petty Cash SQL casts roles to text before checking empty values or matching tenant/vendor variants; it does not change the enum or membership records.

| Actor | Read scope | Actions |
| --- | --- | --- |
| Internal requester: staff, MST, managers, property admin, other internal roles | Own requests, wallet, expenses and proofs | Draft/submit for actively assigned properties; own expenses/proof corrections |
| Configured allocator | Own data plus requests specifically assigned to them within eligible scope | Allocate; bulk allocate; supported reject/send-back |
| Configured approver | Own data plus requests specifically assigned to them within eligible scope | Approve; bulk approve; reject/send-back |
| Accounts | Own data and organization-scoped finance queue/records | Pay, review evidence, confirm returns, reconcile/close |
| Org super admin / ops super admin | Selected organization consolidated requests, wallets, expenses, proofs and summaries | Configure property routing; explicit reassignment; reports |
| Master admin | Established support access to the selected organization, audited server-side | Support visibility/reassignment; does not acquire accounts authority merely through master status |
| Tenant / tenant_user / super_tenant / vendor / food_vendor and related variants | None | None |

Property-admin status alone does not expose coworkers' petty cash. Historical backup configuration remains compatible with the database, but backup controls are no longer exposed in routing or reassignment. Saving a property’s routing clears its old backup selections and keeps only the allocator and approver. Removed property memberships revoke assignment access.

Petty Cash appears under **Management Hub** in the user's existing role dashboard shell. Desktop/mobile navigation, direct links and history retain role navigation. **Payment Tracker** uses its own accounts/procurement/finance-admin rules. Petty-cash eligibility never grants tracker access. Tracker UI capability checks are scoped to the selected organization, and its APIs retain their existing independent enforcement.

## Notifications and evidence

`backend/lib/pettyCash/notify.ts` deliberately does no recipient lookup, email, WhatsApp or outbox enqueue. Existing call contracts are retained for later omnichannel integration. Unrelated modules' notification code is untouched. Inspected petty-cash SQL contains request numbering/audit triggers, with no outbound notification trigger.

Uploads accept supported PDF/image content within the size limit and record organization/uploader ownership in a private bucket. Document retrieval rechecks request visibility. Content parsing and type/size checks **do not establish invoice authenticity**.

## Migration prerequisites and manual order

Prepare a backup and review migration state through the normal deployment process. The application schema must already contain users, organizations, properties, their membership tables, Supabase auth/storage schemas and the `service_role`/`authenticated`/`anon` roles. `public.users` is a shared profile table: it has **no organization_id column**, and this change adds none.

Apply these files in chronological order only when explicitly authorized:

1. `supabase/migrations/20260723000002_petty_cash.sql`
2. `supabase/migrations/20260903000001_petty_cash_ledger.sql`
3. `supabase/migrations/20260912000002_add_assigned_approver_to_petty_cash.sql`
4. `supabase/migrations/20261003000001_petty_cash_allocation_wallet.sql`
5. `supabase/migrations/20261004000001_petty_cash_plan_completion.sql`
6. `supabase/migrations/20261005000001_membership_approval_scope.sql`
7. `supabase/migrations/20261005000002_petty_cash_optional_expense_bills.sql`

Do not replay already-applied migrations. Review pending migrations using `supabase migration list`, inspect schema/backups and apply through the project's normal manually approved migration process. The first new migration adds routing, assignment/audit fields, upload ownership, expenses, wallet ledger, atomic functions, RLS and indexes; the second additive migration completes backup/reassignment, draft, legacy, date and audit rules. Neither drops/recreates financial tables or erases historical data. After application, configure one eligible allocator and one eligible approver for each property from Property Routing before submitting new requests. Property, Allocator and Approver dropdowns each support independent search; users can be found by name, email or membership information. The two actors must be different. Searchable routing needs no additional SQL. Optional expense bills require `20261005000002_petty_cash_optional_expense_bills.sql` after the allocation-wallet and plan-completion migrations. This update replaces only `pc_expense` and `pc_gate`, preserves existing payments/expenses and private upload validation, and changes no membership records or storage buckets. It does not depend on the separate membership-approval migration.

The membership migration adds approval state to existing organization/property membership rows so approval in one workspace cannot hide pending membership in another. It requires existing `users.is_approved` and `users.approval_status` columns. Active grants remain active, pending inactive rows retain pending state, and existing removals stay inactive through membership triggers. No new membership is created and no row is activated by the migration. Historical inactive rows whose shared profile is already approved cannot safely be inferred as pending; they remain inactive for administrator review. This adds no organization column to the shared profile. Apply this migration before using the updated user-management endpoints.

## Local acceptance flow

Use an isolated database and fixture users. The named real identities in the supplied instructions were not used or changed.

1. Start the local app against a separately authorized test database with migrations applied manually. Sign in as org/ops super admin and configure a fixture property's allocator and approver. Confirm staff cannot change routing.
2. Sign in as a single-property requester. Open Management Hub → Petty Cash; verify the role sidebar persists and property selection is omitted. With two assignments, verify only those properties are selectable.
3. Request ₹100. Confirm the configured allocator alone receives the allocation task, then the configured approver receives approval. Verify bulk mixed success and cross-property/organization denials.
4. Accounts records a fixture payment with receipt. Retry the payment; the wallet must still have one ₹100 credit. Staff/property admin must not gain Payment Tracker navigation or API access.
5. The requester adds an expense with a test receipt for ₹100. Confirm zero wallet balance and a single debit on retry. A new advance is now allowed before accounts closes the prior one. Rejected expenses block it; missing optional bills do not. Corrected proofs restore eligibility without another debit.
6. Check mobile navigation, direct petty-cash URL, refresh and Back/Forward. Check organization Overview ↔ Grievance with existing query parameters and React StrictMode fixtures.
7. In User Directory, verify pending inactive memberships are listed, missing scope waits, failed fetch shows Retry, old responses cannot replace a newer scope, and approvals/rejections pass organization context.

## Verification limits

Regression tests run real migration functions in disposable PGlite fixtures, route mocks and actual React browser fixtures. They do not validate a live Supabase deployment, real identities, real payments or invoice authenticity. The browser adapter is isolated and does not perform outbound delivery. Actual current results and a file-by-file manifest are recorded in `docs/testing/petty-cash-recreation-local.md` after integration checks. Production build verification may be limited by the existing Google Fonts download dependency.
