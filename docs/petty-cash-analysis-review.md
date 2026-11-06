# Petty Cash analysis review

## Implemented in this change

Compact searchable filters for property, status, requester, allocator/approver and request-date presets. Custom dates appear only when selected. Filters apply consistently to request tables, grouped totals and action summaries. Assigned-user names are resolved only for actors present in the authorized report.

The Overview now shows allocation, approval, payment and settlement-review queues, their counts, and requested/allocated/approved amounts where applicable. It also shows funded requests awaiting accounting, rejected expenses, creation-based age and request dates. Property/user grouping remains available. An age of seven days is an informational threshold, not a configured SLA or proof that a request is overdue.

## Highest-priority reporting gaps

| Priority | Missing analysis | Business decision it supports | Existing data to expose |
|---|---|---|---|
| P1 | Received, spent, returned and remaining cash reconciliation | Identify cash still held by employees and reconcile Accounts postings | Wallet credits/debits, confirmed returns and posted dates; separate legacy reimbursements |
| P1 | Expense review queue: pending/accepted/rejected counts and amounts | Make Accounts review workload and disputed spending visible | Expense review status, amounts, dates and remarks |
| P1 | Cash age from payment date and time at each workflow stage | Identify money outstanding longest and the allocator/approver/Accounts bottleneck | Actual payment date and activity timestamps, with configurable SLA targets |
| P1 | Exact next-action owner and stage-entry date per request | Give each queue an accountable person and actionable drill-down | Routing snapshots, current eligibility, Accounts recipients and activity history |
| P2 | Expense-period analysis by property, user, category, vendor and payment mode | Understand what money was spent on and compare periods | Expense records and expense dates, not request creation dates |
| P2 | Requested → allocated → approved → paid differences, rejection/send-back reasons | Explain funding reductions and recurring corrections | Stage amounts, audit remarks and status history |
| P2 | Settlement completeness and return confirmation age | Distinguish spent cash awaiting review, cash awaiting return and fully closed settlements | Accepted expenses, confirmed returns, settlement/closure timestamps |
| P2 | Export of filtered summaries and transaction-level records | Support Accounts reconciliation and management review outside the application | Authorized report rows; no public evidence URLs |
| P3 | Spend trends and variance against an approved budget | Identify unusual changes relative to a defined baseline | Monthly expense history and an actual configured budget; do not invent limits |

## Definitions and safeguards

- Cash exposure means posted cash still held, after recorded expenses and confirmed returns. Paid request totals alone do not prove a ledger credit exists.
- A date-filtered request cohort includes later activity on requests created within the selected dates. It is different from expenses incurred in that period; keep these views explicitly separate.
- Pending workflow requests, pending expense reviews and rejected expenses are different counts. The report currently exposes rejected expenses in its `unresolved_proofs` field; this change labels that metric as rejected expenses.
- Bills/receipts remain optional. Receipt attachment coverage can be reported informationally, but a missing bill must not be treated as a violation or block spending/replenishment.
- Historical reimbursements should have a separate view/type filter so management does not confuse them with cash advances. The updated tracker exposes request type, but Overview has no dedicated type filter yet.
- Zero balance permits another eligible request according to the existing workflow; Accounts settlement closure is a separate process.
- Totals and exports must stay within the selected organization, authorized request access and selected filters. Group by IDs, not names.

## Operational issue visible in the supplied screenshot

“Pending counts are unavailable” means the separate badge-count RPC failed. The current Overview derives its groups and action counts from the authorized tracker response, so these are independent. Verify the installed `pc_pending_counts` function and access in the connected Supabase project, including migration `20261006000001_petty_cash_pending_counts.sql`. Missing schema, permissions and runtime failures must be distinguished before applying a fix; repeated Refresh is not a database migration.

No new database migration is required for this UI/report enrichment. The larger reporting gaps above are recommendations, not claims of implemented functionality.
