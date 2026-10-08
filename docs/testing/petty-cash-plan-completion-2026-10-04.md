# Petty cash plan completion — 4 October 2026

Branch: `feat/petty-cash-allocation-wallet`. The existing implementation at `497cc3b` was compared with the supplied allocation, approval and wallet plan. This follow-up completes missing behavior in the same module. Changes remain local for user review; nothing has been pushed or deployed.

## Changes

- Property routing supports distinct primary actors and up to 25 eligible backups per stage. Backups see requests only after explicit super-admin reassignment. Configuration updates do not silently change request snapshots.
- Requesters, including super admins, need an active assigned property. Removed actors lose property-scoped access. Drafts can be saved and edited while another pipeline is pending; submitting a draft still checks routing, proofs and the serialized wallet gate.
- Sent-back property corrections resolve that property's actors and restart allocation. Pending legacy advances require reassignment before approval. Historical reimbursements stay read-only and are excluded from advance eligibility and wallet balances.
- Accounts records the external payment date independently of the payment audit timestamp. Self-confirmation of cash returns is denied. Actions enforce the organization selected by the server.
- Before/after request snapshots preserve allocation amounts, actor IDs and property changes when decisions are reset. API support access by a master admin records the selected organization.
- Reports include requester-ID wallet grouping, actor and requester filters, exact cent totals and pagination after aggregation. Historical reimbursements remain visible as history and do not contribute to advance-wallet summaries.
- Settings expose unavailable configured backups for explicit removal, so an inactive membership cannot permanently prevent routing repairs.

## Verification and limits

Focused regression tests use the real SQL migrations in an isolated PostgreSQL-compatible PGlite database. Browser checks run the actual React components against those database functions with fixture identities, at desktop and mobile widths. They cover the payment/spend/replenishment cycle and draft editing, property selection, backup reassignment and settings repair.

| Final check | Result |
| --- | --- |
| `npm run test:petty-cash` | 36 passed |
| Actual React browser checks | 3 passed, including desktop/mobile lifecycle and draft/property/backup/settings repair |
| `npm run test:whatsapp` | 37 passed |
| `node --max-old-space-size=8192 node_modules/typescript/bin/tsc --noEmit` | Passed |
| Changed-file ESLint | Passed |
| `npm run lint:sql` and `git diff --check` | Passed |
| Production build | Blocked by existing Urbanist/Poppins Google Fonts downloads |

The independent review's SQL findings and settings repair were fixed with failing reproductions followed by passing regression runs. TypeScript and changed-file ESLint checks run independently of the build's font download.

No live Supabase schema, balances, payments, files or memberships were changed. Live acceptance with real users and an audit of existing financial records still require authorized application/database access. Apply the earlier allocation-wallet migration and then `20261004000001_petty_cash_plan_completion.sql` through the normal deployment process before using these changes.

## Implementation decisions

- The supplied plan and request authorize completing its proposed defaults. Existing ledger-derived balances remain authoritative; no mutable duplicate wallet balance is introduced.
- Drafts require valid request details and an assigned property, but do not reserve a pending pipeline or require routing until submitted. A separate Prepare draft action keeps the Request Petty Cash button blocked until replenishment is permitted.
- Payment and expense dates follow Asia/Kolkata. Existing API clients that omit payment date record today's date; the new payment form explicitly collects it.
- Unavailable backups are retained until explicitly removed, rather than silently deleting configuration. Historical request actor snapshots remain intact.
- The new migration is additive. Historical reimbursement statuses are preserved; read-only history is excluded from advance blockers rather than cancelled or converted.
- The sidebar preservation test compares the original branch base `5140c02`, so unrelated later changes on the moving `work` branch cannot falsify this feature's regression result.
