# Petty-cash implementation and regression — 2026-10-03

Branch: `feat/petty-cash-allocation-wallet`. Implements the agreed property-configured allocation and approval flow. This report supplements the earlier baseline assessment; it does not claim live-user validation.

## Delivered behavior

- Org and ops super admins configure distinct primary allocators and approvers per property. Requesters do not select either actor. A sole eligible property is automatic; multiple properties require selection.
- Internal users receive the sidebar link. Tenant and vendor variants are excluded at UI, API and database boundaries. Ordinary users see their own records; assigned actors see their assigned requests and spends. Scoped accounts receive payment/reconciliation queues; super admins receive consolidated data.
- Request, allocate, approve, accounts confirm Paid, credit wallet, record individual proof-backed expenses. Bulk allocation and approval provide confirmation and independent results. All actions check stage, assignment and request version.
- Wallet entries are immutable through exposed application interfaces. Payment credits once; an idempotent expense debits once. Exact decimal balance and complete proofs permit the next request at zero before accounts closes the advance. Rejected proof blocks replenishment without refunding recorded expenditure.
- Attachments use private storage and short-lived authorized download links. File signatures, actual PDF/image readability and size are validated. Invoice authenticity and receipt contents still require accounts review.
- Legacy records and objects remain. Existing payments are not replayed into new wallets. Unresolved legacy advances block replenishment until reconciled; pending legacy requests require explicit reassignment to configured actors.

## Verification

| Check | Result |
| --- | --- |
| `npm run test:petty-cash` | 19 passed: actual migration/workflow functions in isolated PGlite, API boundary tests and role/sidebar checks |
| `npm run test:petty-cash:browser` | 2 passed: actual React UI with isolated PostgreSQL adapter at 1440px and 390px |
| `npx tsc --noEmit` | Passed |
| `npm run lint:sql` | Passed |
| Changed petty-cash TypeScript ESLint | No errors; broader dashboard files and unchanged legacy `transitions.ts` retain pre-existing lint errors |
| `npm run test:whatsapp` | 37 passed; unrelated handler AST and sidebar-only change assertions also pass |
| `git diff --check` | Passed |
| Production build | Blocked by existing Google Fonts Urbanist download failure; used build-only placeholder Supabase settings |

Browser coverage includes property configuration, automatic sole property, two-user bulk allocation/approval, payment with attachment, wallet receipt, spending the full balance with attachment, proof download UI, next-request availability before review, personal expense history, vendor denial and dialog layering above a sidebar. These are synthetic fixture identities, not live sessions for mst.ho@gmail.com, Naresh or Dipti.

No live migration or financial transaction was performed. No existing records or uploaded files were deleted. Database fixtures are isolated from the app. Navigation changes and the petty-cash portion of shared email handling are the only intended changes outside this module; verification confirms other shared email handlers and nine role dashboard bodies remain unchanged.

## Activation

1. Apply `supabase/migrations/20261003000001_petty_cash_allocation_wallet.sql` through the normal Supabase migration process before exposing the new application flow. No new routes should run against the old schema.
2. Deploy the matching application and configure property routing as an org/ops super admin. Existing primary actors are never guessed. Existing pending requests retain their assignments until an explicit reassignment restarts allocation.
3. Reconcile historical advances using their retained bills and accounts-confirmed returns. No inferred opening credit is created. Review ambiguous legacy custodians/reimbursements before enabling new requests for those users.
4. Run the named-user acceptance flow with authorized app access and a known test amount. Confirm the full Naresh email, property, accounts identity and external payment evidence first. Marking Paid records an actual external payment; it does not initiate a bank transfer.

The migration makes both the new evidence bucket and existing petty-cash document bucket private. Objects are preserved; historical public URLs must be accessed through the new authorized download route. Other storage buckets are unaffected. Rollback should disable new actions and retain ledger, evidence and audit records rather than dropping financial data.

## Independent review

An independent reviewer reproduced three additional issues: Supabase explicit default RPC privileges, owner-permission legacy view access, and rejected legacy proof correction. These were corrected with final client-role RPC revocations, an invoker-security settlement view, and audited proof supersession. New regressions first failed against the original implementation, then passed after fixes. The reviewer rechecked the corrections and reported no critical or important blockers in the inspected scope. Live deployment and browser verification were outside that reviewer’s scope.
