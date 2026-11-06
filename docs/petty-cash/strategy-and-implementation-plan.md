# Petty Cash strategy and implementation plan

Date: 12 October 2026. Status: proposed, awaiting Harsh's approval.

## Business objective

Turn Petty Cash into a reliable daily work queue and a cash-control system. A requester should know what they received, what they spent, what remains and what they must do next. Allocators/approvers should see their next decisions. Accounts should find payments, expense reviews, returns and closures without scanning every request. Ops/Org Super Admins should see where cash and work are stuck, and who can resolve them.

The requested outcome is less follow-up and spreadsheet reconciliation, shorter waiting times, less unused cash held, and clearer accountability. Released working capital is not automatically a profit or cost saving. Savings must be measured against a baseline; no invented ROI, budgets or SLA limits.

## Current state and boundaries

The request/allocation/approval/payment, partial expense, optional receipt, confirmed-return, settlement and outbox/Omnichannel workflow exists. Role navigation and admin Overview are pushed. Compact searchable filters, initial stage/creation-age analysis and the prior analysis review remain local and unpushed. Preserve these while implementing the approved plan.

Pending badges depend on a separate pc_pending_counts RPC. The code currently discards the underlying error and returns a generic Refresh message. The initial screenshot proved failure, not its exact cause. Harsh then supplied a read-only SQL result showing pc_pending_counts does not exist; its reported execution grant is false because the function is absent. Installing the scoped pending-count migration and reloading the API schema is the confirmed next repair, followed by an execution check. No live Supabase connector is available in this session; installation, cache, grants, project mismatch, authorization and network/runtime errors remain possibilities.

## Expected benefits and measurement

| Benefit | Product change | Measure |
|---|---|---|
| Less staff/Accounts time | Role-specific next-action queues, review/return/closure links and filtered exports | Sample handling minutes per request; actions/touches per request; follow-up count |
| Faster decisions | Stage-entry age, actual owner and configurable reminders | Median and p90 allocation/approval/payment/review/closure elapsed time |
| Less idle cash | Posted balance, cash age and return/reconciliation queue | Cash outstanding, balance-age bands and confirmed cash recovered |
| Fewer reconciliation problems | Ledger-based cash equation, accepted/pending/rejected expense split | Discrepancy count/value; reviewed expense backlog; unsettled count/value |
| Less notification chasing | Omnichannel reminders and visible delivery failures | Successful deliveries, explicit failures, ambiguous deliveries and backlog |
| Better management decisions | Actual expense-period/category/property/user/vendor trends | Spend trend, concentration and approval-to-payment differences |
| Fewer operational surprises | Protected module health diagnostics with incident/recovery history | Failure rate, last successful refresh and time to resolve an incident |

Capture the current baseline before rollout. Compare like-for-like periods and workload. Estimated labor cost saved can be shown only when an approved handling-time baseline and hourly cost exist, and must be labelled an estimate. Cash recovered/working capital released is reported separately from savings.

## Product layout

Keep compact searchable filters and Overview first for Ops/Org Super Admin.

- Overview: cash position, next-action queues, age bands, property/user breakdown and attention items; clicking a figure opens its filtered records.
- Requests: current stage, current action owner, stage-entry time, requested/allocated/approved/paid amounts, remarks and immutable audit trail.
- Expense review: Accounts queue with pending/accepted/rejected counts and amounts; review detail and optional attachments.
- Cash and settlements: transaction ledger, outstanding cash, confirmed returns, settlement completeness and closure queue.
- Spend analysis: expense-date reporting with category, vendor, payment mode, property and user filters, comparisons and exports.
- Module health: protected Org/Ops admin panel with last successful check, current problems, diagnostic references and recovery history. Ordinary users see only a useful availability message.

Expose only sections/actions authorized for the signed-in role. These are coherent views of one module, not duplicated finance workflows. Separate advances from historical reimbursements.

## Phase 1 — Make the module trustworthy and diagnosable

1. Run the read-only checks in pending-counts-readonly-check.sql against the project's actual Supabase database. Confirm the non-secret project reference matches the app environment. Check pc_pending_counts and its helpers, service-role execution grants and required schema. Confirm the actual API error code/message in server logs.
2. Preserve a sanitized classification, correlation ID, check time and last success. Distinguish missing migration/function, stale API schema cache, missing column, denied access/grant and timeout/runtime failure. Do not display keys, connection strings or unrestricted database details.
3. Add an admin-only Module health panel with the current state, affected feature, suggested remediation and incident/recovery history. Record changes of state and repeated failure counts, not a new incident on every refresh. Keep incidents organization-scoped with restricted access and retention.
4. Show counts as unavailable when unknown; never convert a failure into zero. If retaining a last successful value, clearly label it stale and recheck current organization/user authorization. Recheck after repair and show a resolved timestamp.
5. Fix the confirmed cause with the smallest migration/grant/cache/environment change. Verify badges against authorized underlying requests and expense statuses. Use canonical definitions so badges and queues do not disagree; reconcile counts beyond the current table page.
6. Establish cash integrity: posted credits minus recorded expense debits minus confirmed cash returns equals remaining cash. Keep recorded spending separate from approved spending. Flag discrepancies for Accounts; no automatic financial corrections or historical posting replay.

Acceptance: healthy project shows exact badges; deliberately missing RPC or denied grant produces the correct protected diagnostic and never a false zero. Restored service resolves the incident. Cross-org access and permission loss reveal no stale private data. Ledger totals match individual request/user balances.

## Phase 2 — Reduce daily manual work

1. Make the work queues actionable: allocation, approval, payment, requester expense correction, Accounts expense review, return confirmation and settlement closure.
2. Derive stage-entry time from the relevant activity event, including resubmission/reassignment. Do not use generic updated_at as a stage clock because expense edits can change it.
3. Show the current eligible allocator/approver; for Accounts actions show an authorized Accounts queue or explicit configured assignment, rather than inventing a single owner when several Accounts users are eligible.
4. Show pending/accepted/rejected expense counts and amounts, dates, review remarks and request links. Bills remain optional; unattached bills do not become violations or block spending.
5. Show cash age from the actual payment date, outstanding balance, settlement stage, pending reviews, confirmed returns and the reason closure is blocked. For multiple funding transactions use transaction dates; mark unavailable historical dates as unknown.
6. Allow configurable age bands and stage targets. Informational age is distinct from overdue; no SLA-based overdue label until an organization has configured its policy.
7. Add optional scheduled reminders through durable event_outbox and Omnichannel channel/recipient/template configuration only. Defaults stay off. Deduplicate per request/stage occurrence/reminder window, recheck stage/access and stop reminders after the task changes. No direct hook messages or duplicate channel sends.

Acceptance: each queue leads to a permitted next action; stage clocks reset correctly on send-back/resubmission; partial spending and zero-balance replenishment still work; reminders obey Omnichannel and cannot resend successfully delivered channels.

## Phase 3 — Add financial and management analysis

1. Cash-flow view by posting/payment/return dates: received, spent, confirmed returned and remaining cash, with a reconciliation drill-down.
2. Expense-period view by expense date: categories, vendors, payment modes, properties, requesters and period-over-period comparisons. Clearly label request cohort, expense period and cash movement views; changing one basis must not silently change another.
3. Requested → allocated → approved → paid differences, rejection/send-back counts and reasons, and stage turnaround median/p90. Explain incomplete/missing historical data.
4. Settlement analysis: accepted expenses, pending review, rejected expenses, cash remaining, confirmed returns, closed/open settlements and review age. A spent wallet and an Accounts-closed settlement are different states.
5. Filtered CSV exports of summaries and authorized request/expense/ledger records, with date basis, timezone and generated-at metadata. Escape spreadsheet formula cells. Add printable/PDF summaries after the CSV and displayed totals match. Never export public receipt URLs.
6. Aggregate in the database and paginate detail lists. Add appropriate indexes and avoid downloading all financial rows just to draw cards. Use one configured organization reporting timezone; validate boundaries and compare equal-duration periods.

Acceptance: every card reconciles with drill-down/export under identical filters, all records/pages are counted, money uses cent-accurate arithmetic, timezone boundaries agree, advances/reimbursements are separated and exports preserve authorization.

## Phase 4 — Measure improvement and introduce budgets carefully

Add a baseline comparison for waiting time, review backlog, cash held and repeat corrections. Add optional budgets/variance only after budget ownership, property/category scope and periods have been agreed and configured. Do not fabricate spend limits or call normal variation fraud. Budget variance is initially informational; new blocking controls would require a separate business decision.

Acceptance: labels distinguish actual values, measured improvement and estimates. Zero/missing prior-period data is handled honestly. Working capital released is not counted as profit.

## Proposed implementation order and delivery

Approve the full roadmap, then implement and validate Phases 1–3 in that order. Phase 4 measurements use the baseline captured in Phase 1; budget control remains an opt-in extension requiring actual budget input. Deliver additive SQL separately from application code, preserve existing data and permissions, and document exact deployment/migration order. Local implementation and tests come first; live migrations and deployment are separate actions.

Testing covers financial reconciliation, multi-property and cross-organization access, closed/legacy requests, missing schema and recovery, concurrent updates and reminder dedup, optional receipts, partial spending, report/export parity, date boundaries, desktop/mobile use and loading performance. Test failures or missing database access must be reported rather than assumed fixed.

## Decisions proposed for approval

- Approve this phased roadmap and Phase 1-first implementation sequence.
- Keep all existing financial eligibility rules, optional receipts and outbox-only Omnichannel delivery.
- Keep budgets and reminder channels disabled until explicitly configured.
- Prefer operational queues and cash integrity before advanced charts.

No additional product implementation or live database change has been made while preparing this plan. Only planning and read-only diagnostic artifacts were created.
