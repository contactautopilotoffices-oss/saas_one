# Electricity Automation — Phased Implementation Plan

> Drafted 2026-08-03 from the ops team's walkthrough (single-mailbox bill ingestion → OCR →
> validation vs FMS readings → 3-touch MST chase + reliability score → ops_super_admin
> checker → disputes + pending-actions center → monthly PDF → org_super_admin 3-scenario
> payment form → Accounts → AOP actuals). Planned by Fable against the live codebase.

## 1. Architecture Overview

### The two role systems (critical context)
This repo has **two parallel role systems** and any new role must touch both:
- **Membership roles** (runtime authority): free-string `role` on `organization_memberships` / `property_memberships`, checked by backend guards (`backend/lib/electricity/access.ts` uses `['org_super_admin','master_admin','accounts','procurement']`) plus a `users.is_master_admin` boolean. This is what actually gates APIs.
- **Legacy RBAC types**: `frontend/types/rbac.ts` (`RoleKey`) + `frontend/constants/capabilities.ts` (`CAPABILITY_MATRIX`) — used by sidebar `domain` gating and some dashboards.

### Existing assets we build on (verified)
| Need | Already exists |
|---|---|
| Bill money model incl. 3 scenarios | `electricity_bills.total_amount / early_payment_amount / after_due_date_amount` + `payment_status ('pending','paid','disputed')` and `source` CHECK already includes `'ocr'` (`supabase/migrations/20260802000002_electricity_bills.sql`) |
| Deadline/urgency maths | `electricity_bill_alerts` view + `backend/lib/electricity/tracker.ts` |
| Logged readings | `electricity_readings`, `electricity_meters` (`backend/db/migrations/electricity_logger.sql`), anomaly-filtered `electricity_monthly_consumption` view (`20260802000003`) |
| Mailbox sync | `ZohoMailService` (list only — **no body/attachment fetch yet**), `mailboxDigest.ts` → `mailbox_threads`, cron `sync-purchase-mailbox` (env-pinned org, dormant-until-configured contract) |
| OCR/LLM | Groq vision (`meta-llama/llama-4-scout-17b-16e-instruct`) in `app/api/ocr/meter/route.ts`; shared `GROQ_API_KEY` budget warning in `mailboxDigest.ts` |
| WhatsApp | `whatsapp_queue` table + DB-webhook `app/api/webhooks/whatsapp-queue` + fallback cron `process-whatsapp-queue` (provider: **WasenderAPI** — plain messages, no Meta template approval needed) |
| PDF | `backend/lib/council/auditPdf.ts` — HTML → headless-Chromium (puppeteer) precedent |
| Email | `nodemailer` via `backend/lib/council/mailer.ts` / `EmailService.ts` (needs an `attachments` param added) |
| One-click email actions | `email_action_tokens` (`20260731000002`) |
| Notifications | `notifications` table (realtime, RLS `recipient_id = auth.uid()`) + `NotificationBell.tsx` |
| AOP actuals | `aop_entries` — `source` CHECK **already allows `'electricity'`**, `aop_line_items.feed_source='electricity'`, `electricity_billing_accounts.aop_site_id` FK already exists |
| Escalation-cost precedent | `workflow_spoc_rules` (`20260801000002`) |

### Data-flow narrative
1. Electricity boards mail bills to one mailbox (e.g. `electricity@worksquare.in`). A new cron pulls messages, downloads PDF attachments to a new `electricity-bills` storage bucket, and Groq parses each PDF page-image into structured bill fields → upsert into `electricity_bills` (source `'ocr'`) + a new `electricity_bill_documents` row. A copy is emailed to the site's property admin (resolved via `electricity_billing_accounts.property_id` → `property_memberships` role `property_admin`).
2. A validation engine compares the bill's billed kWh vs `electricity_monthly_consumption` for the account's property and checks reading completeness for the billing period → writes an `electricity_bill_validations` row (auto-pass, variance, or missing-data).
3. Missing/variant data spawns a chase job: touch 1 & 2 via `whatsapp_queue`, touch 3 via voice agent (provider TBD). Defaults feed `employee_reliability_events`; 3rd strike raises a ticket + notifies all super admins.
4. `ops_super_admin` (checker) reviews validations; discrepancies open `electricity_disputes`; property admin answers via the new pending-actions center (free-form text + attachments).
5. Monthly PDF report (puppeteer) emailed to ops_super_admins.
6. `org_super_admin` (accepter) sees the 3-scenario amounts per account, picks a scenario, submits an `electricity_payment_runs` form → Accounts dashboard queue → marks paid → `payment_status='paid'` and an `aop_entries` upsert with `source='electricity'`.

### Bill lifecycle state machine
Add `workflow_status` to `electricity_bills` (keep `payment_status` untouched — it is the money-side status the register already edits via PATCH):

```
ingested ──parse ok──▶ parsed ──account matched──▶ validating
   │ parse fail ▶ needs_manual_entry ──────────────────┘
validating ──readings complete & within tolerance──▶ validated
validating ──variance or missing readings──▶ chasing (3-touch engine)
chasing ──data fixed──▶ validating (re-run)
validating/checker review ──discrepancy──▶ disputed  (electricity_disputes row; payment_status→'disputed')
disputed ──property admin response accepted by ops_super_admin──▶ validated
validated ──ops_super_admin sign-off──▶ verified
verified ──org_super_admin selects scenario──▶ scenario_selected
scenario_selected ──run submitted──▶ sent_to_accounts
sent_to_accounts ──accounts marks paid──▶ paid (payment_status='paid')
paid ──actuals cron──▶ aop_linked
```

---

## 2. Phasing (6 independently shippable phases)

### Phase 1 — Mailbox ingestion + bill OCR + property-admin forwarding
**Goal:** every board bill lands in `electricity_bills` automatically and the site SPOC gets a copy. Immediate value; no new roles needed.

**Migration** `supabase/migrations/2026XXXX_electricity_bill_ingestion.sql`:
- `electricity_bill_documents` (id, organization_id, account_id nullable FK, bill_id nullable FK, mailbox_message_id text, from_address, subject, received_at, storage_path, file_name, mime_type, ocr_status CHECK ('pending','parsed','failed','manual'), ocr_payload jsonb, ocr_confidence numeric, forwarded_to text[], forwarded_at, created_at; UNIQUE (organization_id, mailbox_message_id, file_name)).
- `ALTER TABLE electricity_bills ADD COLUMN workflow_status text NOT NULL DEFAULT 'ingested' CHECK (...)` (states above; backfill existing rows to `'validated'` or `'paid'` by `payment_status`), plus `billed_units numeric`, `billed_units_unit text`, `document_id uuid`.
- `electricity_billing_accounts ADD COLUMN inbound_email_hints text[]` (board sender addresses / consumer-number strings used for matching), `spoc_user_id uuid REFERENCES users(id)` (explicit property-admin override).
- RLS mirroring the bills tables (`has_aop_access` read; service-role writes).
- Storage bucket `electricity-bills` (private; bucket creation is a Supabase dashboard/user step, like other buckets).

**Backend:**
- Extend `backend/services/zohoMailService.ts`: `getMessageContent(messageId)`, `listAttachments(messageId)`, `downloadAttachment(...)`. READ scope covers content+attachments; forwarding done via SMTP/nodemailer instead of Zoho send scope.
- New `backend/lib/electricity/ingest.ts`: pull messages since last sync (separate env set `ZOHO_ELEC_MAIL_*` mirroring `ZOHO_MAIL_*`, same "dormant until configured" + pinned `ZOHO_ELEC_MAIL_ORG_ID` contract as `sync-purchase-mailbox/route.ts`), download PDFs, render page 1–2 to image (repo already has `pdfjs-dist`) → Groq vision prompt (new `backend/lib/electricity/billOcr.ts`, modeled on `app/api/ocr/meter/route.ts`; extract provider, consumer number, billing month, bill date, due date, total, early-payment date/amount, after-due amount, billed kWh) → match to `electricity_billing_accounts` via consumer_ref/site hints → upsert `electricity_bills` on `(account_id, billing_month)` with `source='ocr'`.
- Forwarding: `backend/lib/electricity/forwardBill.ts` — resolve property admin(s) via `property_memberships` (`role='property_admin'`, property = account.property_id) or `spoc_user_id`; send with nodemailer + attachment (add `attachments` support to `EmailService.sendEmail`).

**API/cron:** `app/api/cron/sync-electricity-mailbox/route.ts` (CRON_SECRET bearer, `maxDuration=300`); vercel.json entry `0 */2 * * *`. Admin review route `app/api/electricity/documents/route.ts` (GET unmatched/failed docs, PATCH to link account).

**UI:** new "Inbox" view inside `ElectricityTrackerTab.tsx` (`frontend/components/electricity/ElectricityBillInbox.tsx`) — parsed bills, unmatched documents, manual-match modal, link to stored PDF. Register rows get a paperclip icon when `document_id` present.

**Role gating:** existing `resolveElectricityAccess` (procurement/accounts/super admins).

### Phase 2 — Validation engine + `ops_super_admin` role
**Goal:** bills auto-checked against logged readings; the checker role exists and has a review queue.

**Migration** `2026XXXX_electricity_validation_and_ops_role.sql`:
- `electricity_bill_validations` (id, organization_id, bill_id FK, run_at, method CHECK ('auto','manual'), billed_units, logged_units, variance_pct, tolerance_pct default 5, missing_dates date[], readings_counted, readings_excluded, result CHECK ('pass','variance','incomplete_data','no_meter_link'), checked_by uuid, checked_at, checker_note text). One row per run; latest wins.
- Comment block documenting the new membership role string `ops_super_admin` (no schema change needed — membership roles are free strings); update RLS helper (`has_aop_access` or new `has_electricity_access`) via `CREATE OR REPLACE FUNCTION` to include `ops_super_admin`.

**Backend:** `backend/lib/electricity/validate.ts` — for a bill: map account → property (via `property_id`), read `electricity_monthly_consumption` for `billing_month`, compute variance and missing dates (gap scan over `electricity_readings.reading_date` in period), insert validation row, set `workflow_status` to `validated` / `chasing`.

**Role wiring (see §3):** `ops_super_admin` added to `backend/lib/electricity/access.ts` (`SUPER_ADMIN_ROLES` stays as-is; add to `ELECTRICITY_ROLES` + a new exported `CHECKER_ROLES = ['ops_super_admin', ...SUPER_ADMIN_ROLES]`), `frontend/lib/auth/silos.ts` `FMS_ROLES`, `AuthContext` priority map, `InviteMemberModal` option, `DashboardSidebar`, `rbac.ts`/`capabilities.ts`.

**API:** `app/api/electricity/validations/route.ts` (GET queue, POST re-run, PATCH checker sign-off → `verified`); validation auto-runs at end of Phase-1 cron and nightly via `app/api/cron/electricity-validate/route.ts`.

**UI:** "Validation" view in `ElectricityTrackerTab.tsx` (`frontend/components/electricity/ElectricityValidationQueue.tsx`): bill vs logged units side-by-side, variance badge, missing-date chips, Approve (sign off) / Flag dispute buttons — checker actions visible to `ops_super_admin` + org super admins only.

### Phase 3 — Dispute tracker + pending-actions center (HRMS-style)
**Goal:** discrepancies become tracked disputes; property admins see a numeric header badge with Approve / View / Reject per item.

**Migration** `2026XXXX_electricity_disputes_pending_actions.sql`:
- `electricity_disputes` (id, organization_id, bill_id FK, validation_id FK, raised_by, raised_at, reason text, status CHECK ('open','responded','accepted','rejected','withdrawn'), assigned_property_admin uuid, resolved_by, resolved_at, resolution_note).
- `electricity_dispute_responses` (id, dispute_id FK, author_id, body text, attachments jsonb — `[ {storage_path, file_name, mime_type} ]` in the `electricity-bills` bucket; deliberately free-form per requirement, created_at).
- `pending_actions` (generic, reusable): id, organization_id, recipient_id, domain text ('electricity_dispute' first), entity_type, entity_id, title, description, actions jsonb (e.g. `["respond","view"]` / `["approve","reject","view"]`), deep_link, status CHECK ('open','done','dismissed'), created_at, resolved_at, resolved_action. RLS: `recipient_id = auth.uid()`; add to `supabase_realtime` publication like `notifications`.

**Backend:** `backend/lib/electricity/disputes.ts` (open/respond/resolve; on open → `payment_status='disputed'`, `workflow_status='disputed'`, insert `pending_actions` + `notifications` row + `WhatsAppQueueService.enqueue` heads-up to the property admin).

**API:** `app/api/electricity/disputes/route.ts` + `app/api/electricity/disputes/[id]/respond/route.ts` (multipart upload → storage); `app/api/pending-actions/route.ts` (GET mine, PATCH act).

**UI:**
- `frontend/components/dashboard/PendingActionsBell.tsx` — sibling of `NotificationBell.tsx` (same realtime pattern), numeric badge, dropdown list with per-item Approve / View Form / Reject buttons (Qandle HRMS pattern); mount everywhere `NotificationBell` mounts (PropertyAdminDashboard, OrgAdminDashboard, ProcurementDashboard, etc.).
- "Disputes" view in `ElectricityTrackerTab.tsx` (`frontend/components/electricity/ElectricityDisputeTracker.tsx`) — procurement workspace, thread-style responses with attachment chips; ops_super_admin accept/reject.
- Property-admin dispute response form (modal from pending action deep-link): free textarea + multi-file upload.

**Role gating:** disputes readable by `ELECTRICITY_ROLES` + the assigned property admin (route-level scoped branch: a property admin may read only disputes assigned to them).

### Phase 4 — 3-touch escalation engine + employee reliability ("CIBIL") score
**Goal:** automated chase of MSTs for missing readings; defaults tracked; 3rd strike → super-admin ticket.

**Migration** `2026XXXX_electricity_chase_reliability.sql`:
- `electricity_chase_tasks` (id, organization_id, bill_id, validation_id, property_id, assignee_id — resolved MST via `property_memberships role='mst'`, missing_dates date[], status CHECK ('open','touch1_sent','touch2_sent','touch3_called','completed','defaulted'), touch1_at, touch2_at, touch3_at, due_at per touch (e.g. +24h), completed_at, cost_incurred numeric default 0).
- `employee_reliability_events` (id, organization_id, user_id, source_type ('electricity_chase' first — generic for future modules), source_id, kind CHECK ('default','strike','recovered'), points int, note, created_at, employee_notified_at, notified_via text).
- `employee_reliability_scores` view: score = 100 − weighted event sum over rolling 12 months; strike_count; last_strike_at.

**Backend:** `backend/lib/electricity/chase.ts`:
- Touch 1/2: enqueue via existing `WhatsAppQueueService.enqueue` with `eventType: 'ELECTRICITY_CHASE_T1'/'T2'` (extend the module map in `WhatsAppQueueService.ts` → `moduleName: 'electricity'` + new `system_config` toggle `whatsapp_electricity_enabled`). Message templates in `backend/lib/electricity/chaseMessages.ts` (polite → pushy; WasenderAPI = free-form text, no Meta template approval needed).
- Touch 3: `backend/lib/voice/provider.ts` interface (`placeCall(phone, script) → {call_id,status}`) with a no-op stub logging `voice_provider_not_configured`; provider decision flagged (§9). Each touch increments `cost_incurred` (config costs in `system_config`).
- Completion detection: nightly cron re-runs validation; if missing dates now filled → `completed`, else after touch 3 + grace → `defaulted` → insert reliability `default` event; every 1 default = strike (threshold-configurable); on 3rd strike within 12 months → create a row in `tickets` (category 'HR / Reliability') visible to all org super admins + `notifications` fan-out; employee informed via WhatsApp ("this has been noted on your reliability profile") satisfying the "employee must be informed" requirement (`employee_notified_at`).

**Cron:** `app/api/cron/electricity-chase/route.ts` (hourly): advance due touches, detect completions/defaults.

**UI:**
- Chase queue view inside `ElectricityTrackerTab` (status per bill: which touch, who, cost so far).
- `frontend/components/dashboard/ReliabilityBadge.tsx` on user profiles + a "Reliability" panel in `UserDirectory.tsx` / `UserManagement.tsx` (score, strikes, event history) — visible to org/ops super admins; the employee sees their own score (MstDashboard card).

### Phase 5 — Monthly PDF report + email to ops_super_admin
**Goal:** exportable, emailable monthly pack.

**Backend:** `backend/lib/electricity/monthlyReportPdf.ts` — clone the `auditPdf.ts` approach (HTML → puppeteer, esc() everything, house palette #708F96): sections = register for the month, validation results, variances, open disputes, discount captured/missed (reuse `computeDiscountPerformance` from `backend/lib/electricity/tracker.ts`), chase/reliability summary. `backend/lib/electricity/monthlyReportMailer.ts` — nodemailer with PDF attachment to all `ops_super_admin` members (and optionally org super admins).

**API/cron:** `app/api/electricity/report/route.ts` (GET ?month= → PDF download, gated by `resolveElectricityAccess`); `app/api/cron/electricity-monthly-report/route.ts`, vercel.json `0 5 5 * *` (5th of month, after most bills arrive).

**UI:** "Download report / Email now" buttons in `ElectricityTrackerTab` header.

### Phase 6 — 3-scenario payment selection form → Accounts → AOP actuals
**Goal:** org_super_admin picks early/due/late per account; Accounts executes; actuals flow into AOP.

**Migration** `2026XXXX_electricity_payment_runs.sql`:
- `electricity_payment_runs` (id, organization_id, period_month date, status CHECK ('draft','submitted','in_payment','completed'), submitted_by, submitted_at, completed_at).
- `electricity_payment_selections` (id, run_id FK, bill_id FK UNIQUE, scenario CHECK ('early','due','late'), scenario_amount numeric, pay_by_date date — derived: early→`early_payment_date`, due→`due_date`, late→NULL, note; selected_by, selected_at).
- `ALTER electricity_bills ADD payment_run_id uuid` (denormalised pointer for the register).

**Backend:** `backend/lib/electricity/paymentRuns.ts` — build the month's form from `verified` bills (the three amounts already live on `electricity_bills`); on submit: `workflow_status='sent_to_accounts'`, notify accounts (`notifications` + `pending_actions` domain `'electricity_payment'`). On accounts marking paid (reuses existing register PATCH semantics: sets `payment_status='paid'`, `payment_date`, `paid_amount`): `backend/lib/electricity/aopSync.ts` upserts `aop_entries` — site = `electricity_billing_accounts.aop_site_id`, line item = `aop_line_items` where `code='electricity'`/`feed_source='electricity'`, `period_month=billing_month`, `actual += paid_amount`, `source='electricity'`, `source_ref=bill id` → `workflow_status='aop_linked'`. Bills without `aop_site_id` are surfaced as warnings, mirroring `aop_import_warnings` philosophy.

**API:** `app/api/electricity/payment-runs/route.ts` (+ `[id]/route.ts` PATCH submit / select / complete). Access: form GET for `ELECTRICITY_ROLES`; scenario selection + submit restricted to `org_super_admin`/`master_admin` (the accepter check inside the route via `access.isSuperAdmin`); accounts completion allowed for `accounts` role.

**UI:**
- `frontend/components/electricity/ElectricityPaymentScenarioForm.tsx` — table: account | Amt if paid Early | Amt on Due date | Amt if Late | radio per row | pay-by date; totals footer; Submit-to-Accounts button (org super admin only). Mounted as a "Payments" view in `ElectricityTrackerTab`.
- `frontend/components/accounts/ElectricityPaymentQueue.tsx` — new tab in `AccountsDashboard.tsx`: submitted runs, per-bill scenario + deadline, "Mark paid" (reuses `MarkPaidModal` pattern), completion state.
- Reconciliation view (`ElectricityReconciliation.tsx`) now shows the closed loop billed vs AOP actual.

---

## 3. New role: `ops_super_admin`

- **Nature:** org-scoped membership role (like `org_super_admin`), `property_id = null` in invite flow. **Not** in `SUPER_ADMIN_ROLES` anywhere — it must NOT inherit org-super-admin authority (checker below accepter).
- **Touch list:**
  - `frontend/types/rbac.ts` — add `'ops_super_admin'` to `RoleKey`.
  - `frontend/constants/capabilities.ts` — matrix entry (dashboards/reports view, tickets view/approve, users view; no procurement approve).
  - `frontend/lib/auth/silos.ts` — add to `FMS_ROLES`.
  - `frontend/context/AuthContext.tsx` — priority map: `{ owner:0, org_super_admin:1, ops_super_admin:2, org_admin:3, accounts:4 }`.
  - `frontend/components/dashboard/InviteMemberModal.tsx` — `<option value="ops_super_admin">Ops Super Admin</option>` (no-property branch, same as `org_super_admin`).
  - `frontend/components/layout/DashboardSidebar.tsx` — nav: Electricity Validation, Disputes, Reports entries for this role.
  - `backend/lib/electricity/access.ts` — add to `ELECTRICITY_ROLES`; export `CHECKER_ROLES`; new helper `isChecker(access)`.
  - `backend/lib/aop/access.ts` — decision needed (default: read-only AOP not granted; reconciliation data comes through the electricity guard).
  - RLS: `has_aop_access()` extension only if AOP read is granted; otherwise new `has_electricity_access()` fn in the Phase-2 migration covering the new tables.
  - Routing/dashboard: `frontend/lib/dashboard/registry.ts`, `frontend/hooks/useAppSession.ts`, `UnifiedDashboard.tsx` — land ops_super_admin on a dashboard variant with the validation queue front and center.
- **Checker vs accepter split:** `ops_super_admin` signs off validations and accepts/rejects dispute responses (`validated`→`verified`); `org_super_admin` alone can select payment scenarios and submit the run. Enforced in route handlers, not just UI.
- Seed users (dipti.walanj@worksquare.in, shrihari@autopilotoffices.com) are invited through the normal flow by the customer — not a migration.

## 4. Employee reliability score — summary
Tables in Phase 4. Scoring default: start 100; −10 per default (configurable via `system_config` keys `reliability_default_points` etc.); strike = any default; strikes expire after 12 months (view computes rolling window). 3rd active strike → tickets row + notification fan-out to all `org_super_admin` members and `is_master_admin` users. Every event that penalises stores `employee_notified_at` after the WhatsApp inform message is enqueued — the score UI shows "employee informed" per event. Surfaces: user directory panel, employee's own dashboard card, chase queue, monthly PDF.

## 5. 3-touch escalation — summary
Touches 1–2 ride the existing `whatsapp_queue` → DB webhook → WasenderAPI path unchanged (plain-text messages, so no WhatsApp Business template approval lead time). Scheduling via hourly `electricity-chase` cron using per-task `due_at`. Touch 3 behind `backend/lib/voice/provider.ts` — ships as a logged no-op + falls back to a 3rd WhatsApp message tagged "call pending" until a provider is chosen.

## 6. Pending-actions center — summary
New generic `pending_actions` table (realtime, RLS by recipient) + `PendingActionsBell.tsx` header badge with per-item Approve / View Form / Reject, mounted beside `NotificationBell` in every dashboard header. Electricity disputes are the first domain; `email_action_tokens` reused so the dispute email to the property admin also carries one-click Respond links.

## 7. Monthly PDF — summary
Puppeteer HTML→PDF exactly per `auditPdf.ts` (escaping discipline, brand palette); nodemailer attachment (extend `EmailService.sendEmail` with `attachments?`); cron on the 5th; on-demand download in the tracker tab.

## 8. 3-scenario payment form — summary
No new amount modeling needed — the three amounts already exist on `electricity_bills`. New tables only for the *selection* (`electricity_payment_runs` / `_selections`), Accounts queue tab, and `aopSync.ts` writing `aop_entries` with the already-permitted `source='electricity'`.

## 9. Risks / open questions (each with a recommended default)

1. **Electricity mailbox address + Zoho provisioning** — unknown. Default: `electricity@worksquare.in` as a Zoho shared mailbox, separate `ZOHO_ELEC_MAIL_*` env set + `ZOHO_ELEC_MAIL_ORG_ID` pin (mirrors the purchase mailbox's cross-tenant safety note). Boards must be re-pointed by ops — out of scope for code.
2. **Zoho attachment download scope** — current refresh token likely `ZohoMail.messages.READ` only for purchase@; the new mailbox needs its own grant incl. content/attachment endpoints. Default: new OAuth client for the electricity mailbox; forwarding done via SMTP (nodemailer), never Zoho send scope.
3. **Voice-agent provider** — none in repo. Default: define the provider interface now, recommend Exotel (India telephony + TRAI compliance) or Vapi for LLM-voice; ship touch-3 as WhatsApp fallback until decided.
4. **Is `ops_super_admin` org-scoped or cross-org?** Default: org-scoped membership (dipti/shrihari invited into the Worksquare org); master_admin remains the only cross-org authority.
5. **Does ops_super_admin get AOP read access?** Default: no; reconciliation figures surface through the electricity tracker payload only.
6. **Variance tolerance** — default 5% (configurable per org via `system_config` key `electricity_variance_tolerance_pct`); bills report kWh/kVAh while meters may log kVAh — unit normalisation ambiguity; default: compare like units, flag unit-mismatch as `incomplete_data` rather than false variance.
7. **MST assignee resolution** — default: all active `mst` members of the account's property; if none, escalate straight to property admin.
8. **WhatsApp compliance** — WasenderAPI is an unofficial WhatsApp gateway; if the org later moves to Meta Cloud API, touches 1–2 will need approved templates (2–4 week lead). Default: proceed on existing infra.
9. **Chase cost figures** — per-touch cost values unknown; default: `system_config` keys with ₹0 placeholders so tracking works day one.
10. **Strike thresholds/expiry** — default: 1 default = 1 strike, 12-month rolling window, 3 strikes = ticket; all configurable.
11. **Pending migrations** — several recent migrations (incl. the `20260802*` electricity/AOP set) are not yet applied by the user; every new migration must keep the repo's "written, never applied by the agent" rule and the `isMissingRelation` → `provisioned:false` degradation pattern so unapplied migrations never 500.
12. **"Electricity council member"** — the Council module's Energy & Utilities persona is advisory LLM only; default interpretation: the phrase means the human-owned shared mailbox, not the council agent. Confirm with ops.
13. **AOP actuals write semantics** — bill paid_amount vs existing xlsx-imported actuals can double-count. Default: `aop_entries.source_ref` guards idempotency; electricity-sourced actuals only overwrite cells whose `source='electricity'` or that are empty, warnings otherwise.

## 10. File-level touch list per phase
(New files marked ★)

**Phase 1:** ★`supabase/migrations/…_electricity_bill_ingestion.sql`, `backend/services/zohoMailService.ts`, ★`backend/lib/electricity/ingest.ts`, ★`backend/lib/electricity/billOcr.ts`, ★`backend/lib/electricity/forwardBill.ts`, `backend/services/EmailService.ts`, ★`app/api/cron/sync-electricity-mailbox/route.ts`, ★`app/api/electricity/documents/route.ts`, `vercel.json`, ★`frontend/components/electricity/ElectricityBillInbox.tsx`, `frontend/components/procurement/ElectricityTrackerTab.tsx`, `frontend/lib/electricity/trackerTypes.ts`.

**Phase 2:** ★`…_electricity_validation_and_ops_role.sql`, ★`backend/lib/electricity/validate.ts`, `backend/lib/electricity/access.ts`, ★`app/api/electricity/validations/route.ts`, ★`app/api/cron/electricity-validate/route.ts`, ★`frontend/components/electricity/ElectricityValidationQueue.tsx`, `frontend/types/rbac.ts`, `frontend/constants/capabilities.ts`, `frontend/lib/auth/silos.ts`, `frontend/context/AuthContext.tsx`, `frontend/components/dashboard/InviteMemberModal.tsx`, `frontend/components/layout/DashboardSidebar.tsx`, `frontend/lib/dashboard/registry.ts`.

**Phase 3:** ★`…_electricity_disputes_pending_actions.sql`, ★`backend/lib/electricity/disputes.ts`, ★`app/api/electricity/disputes/route.ts` (+ `[id]/respond`), ★`app/api/pending-actions/route.ts`, ★`frontend/components/dashboard/PendingActionsBell.tsx`, ★`frontend/components/electricity/ElectricityDisputeTracker.tsx`, dashboards mounting the bell (`PropertyAdminDashboard.tsx`, `OrgAdminDashboard.tsx`, `ProcurementDashboard.tsx`, …).

**Phase 4:** ★`…_electricity_chase_reliability.sql`, ★`backend/lib/electricity/chase.ts`, ★`backend/lib/electricity/chaseMessages.ts`, ★`backend/lib/voice/provider.ts`, `backend/services/WhatsAppQueueService.ts`, ★`app/api/cron/electricity-chase/route.ts`, ★`frontend/components/dashboard/ReliabilityBadge.tsx`, `frontend/components/dashboard/UserDirectory.tsx`, `frontend/components/dashboard/MstDashboard.tsx`, `vercel.json`.

**Phase 5:** ★`backend/lib/electricity/monthlyReportPdf.ts`, ★`backend/lib/electricity/monthlyReportMailer.ts`, ★`app/api/electricity/report/route.ts`, ★`app/api/cron/electricity-monthly-report/route.ts`, `vercel.json`.

**Phase 6:** ★`…_electricity_payment_runs.sql`, ★`backend/lib/electricity/paymentRuns.ts`, ★`backend/lib/electricity/aopSync.ts`, ★`app/api/electricity/payment-runs/route.ts` (+ `[id]`), ★`frontend/components/electricity/ElectricityPaymentScenarioForm.tsx`, ★`frontend/components/accounts/ElectricityPaymentQueue.tsx`, `frontend/components/accounts/AccountsDashboard.tsx`, `frontend/components/electricity/ElectricityReconciliation.tsx`.
