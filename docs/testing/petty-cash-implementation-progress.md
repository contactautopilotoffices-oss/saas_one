# Implementation ledger — plan: docs/superpowers/plans/2026-10-03-petty-cash-allocation-wallet.md

- User authorized implementation on the existing dedicated feature branch.
- Phase 1/2: additive database schema, property routing, explicit access and guarded stage actions implemented. Initial database regression suite observed failing before migration existed, then passing (5/5).
- Phase 3: atomic wallet/expense/gate, proof correction and private upload/download implemented. Existing records are retained; legacy advances remain legacy and gate new requests until reconciled. No live migration or financial writes performed.
- Phase 4: API/UI/reporting, bulk preview and per-item results, personal expense history, property routing settings, role sidebars and body-portal responsive dialogs implemented.
- Phase 5: 19 database/API/sidebar regressions and two desktop/mobile browser lifecycle checks passed in isolated fixtures. TypeScript and SQL migration lint passed. Private evidence checks include readable PDF/image acceptance and malformed/spoofed rejection. Live named-user testing remains unavailable without authenticated app access.
- Ruling: use immutable wallet entries plus a balance function rather than a mutable wallet cache; the requester advisory lock serializes credits/debits/submissions and avoids two independent balance sources.
- Ruling: preserve legacy balances and bills in the existing reconciliation view rather than invent opening balances from ambiguous custodian/bill records. New v2 credits originate only from confirmed v2 payment. Existing unresolved legacy advances block replenishment.
- Ruling: old unversioned email links cannot act on v2 requests; notifications link users to the current application record, protecting revised requests from stale approvals.
- Navigation changes outside the petty-cash directory add only a shared Petty Cash link to existing role sidebars; unrelated module behavior is unchanged.
- Explicit reassignment resets current allocation details; original decisions remain in activity history. Regression verifies the old allocator loses action permission.
- Build verification is limited: production build attempted with build-only placeholder Supabase settings, then failed downloading the existing Urbanist Google Font. No live credentials, migration, payment or request were used.

- Independent review found and prompted fixes for explicit Supabase default RPC grants, settlement-view invoker RLS, and legacy rejected-proof supersession. Added failing reproductions, then verified corrected cases pass. Client RPC privileges now exclude anon/authenticated except auth.uid-based RLS wrappers. Superseded proofs remain immutable history.

## Plan completion — 4 October 2026

- User requested completion against the supplied plan on `feat/petty-cash-allocation-wallet`, with pushing deferred until confirmation. Checked out the existing feature tip `497cc3b`; all follow-up changes remain local and uncommitted.
- Routing/access: configured primary and backup actors, explicit reassignment, strict active requester-property scope, current property eligibility for assigned reads, selected-organization action guard and API master-support access audit.
- Workflow/wallet: editable drafts gated only on submission, sent-back property routing and decision resets, legacy pending allocation requirement, explicit payment date, self-return denial and read-only historical reimbursements.
- Reports/audit: full scoped aggregates beyond 200 records, requester-ID wallet groups, named actor filters, immutable before/after request snapshots and readable reassignment history.
- Tests: the initial seven missing-behavior regressions failed before implementation and passed afterward. Further boundary and reviewer reproductions also failed before their corresponding fixes. The final focused suite passed **36/36**; the final desktop/mobile/draft/reassignment/settings-repair browser suite passed **3/3**. Existing WhatsApp regressions passed **37/37**. Changed-file ESLint, SQL lint and `git diff --check` passed.
- Independent reviewer reproduced reimbursement gate lockout, historical reimbursement bill mutability and invisible ineligible backup selections. SQL fixes passed the reviewer's independent **28/28** workflow/plan regressions. UI repair was then verified by an actual browser reproduction that failed before the removal controls existed and passed afterward. Historical reimbursement review buttons are hidden.
- Production build is blocked by existing Urbanist/Poppins Google Fonts fetch failures. It used build-only placeholder Supabase settings and performed no live application/database writes.
- Ruling: retain the existing ledger-based balance, with no duplicate mutable wallet cache. New drafts require valid details/property but never reserve a pending pipeline.
- Ruling: preserve legacy reimbursement statuses as read-only history and exclude them from advance blockers and wallet balance summaries; do not cancel or convert financial history.
- Ruling: unavailable backups must be explicitly removable rather than silently pruned. Changing routing never changes historical request snapshots.
- Ruling: payment/expense dates use Asia/Kolkata; legacy callers omitting payment date record today. The new payment form requires a date.
- Ruling: compare sidebar/email preservation against the original branch base `5140c02`, rather than the later-moving `work` ref.
- Rollout and remaining live acceptance prerequisites are documented in `docs/testing/petty-cash-plan-completion-2026-10-04.md`. No live migration, payment, balance change, deployment or push has occurred.
- Final TypeScript check passed with an 8GB heap after all code changes. All final verification outputs were checked before handing the local branch back for review.
