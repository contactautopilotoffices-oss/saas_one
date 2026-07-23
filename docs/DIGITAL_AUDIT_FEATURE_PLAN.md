# Digital Audit Feature — Product Specification

> **Status:** Draft — Pending Approval  
> **Module:** PPM / AMC / Vendor Compliance  
> **Audience:** Property Admin, Org Admin, Auditors  

---

## 1. Executive Summary

The **Digital Audit** feature is a unified compliance & verification dashboard that intelligently inspects all PPM (Planned Preventive Maintenance) and AMC (Annual Maintenance Contract) artifacts uploaded against calendar dates. It provides property admins with a **visual, enriched summary** that answers one core question:

> *"What is complete, what is missing, and what needs my attention — right now?"*

The audit engine cross-references scheduled tasks, completion reports, vendor proofs, AMC contract documents, and verification statuses to generate a **smart summary**, an **interactive checklist**, and an **exportable audit report**.

---

## 2. Core Audit Criteria

The digital audit evaluates the following criteria across the PPM/AMC lifecycle:

| # | Audit Criteria | Data Source | Pass Condition |
|---|----------------|-------------|----------------|
| 1 | **Task Completion Coverage** | `ppm_schedules` | `status = 'done'` on or before `planned_date` |
| 2 | **Completion Report Attached** | `ppm_schedules.attachments` + legacy cols | At least 1 photo **OR** `completion_doc_url` exists for every `done` task |
| 3 | **Invoice Attached (Done Tasks)** | `ppm_schedules.attachments` / `invoice_url` | Invoice present for all `done` tasks where vendor is external |
| 4 | **Vendor Proof Submitted** | `ppm_schedules.verification_status` | Vendor has uploaded proof (`submitted` / `verified`) |
| 5 | **Admin Verification Done** | `ppm_schedules.verification_status` | Admin has `verified` the vendor proof |
| 6 | **AMC Contract Active** | `amc_contracts` | `status = 'active'` and `contract_end_date` > today |
| 7 | **AMC Contract Document Present** | `amc_documents` | At least 1 `contract` doc exists per active AMC |
| 8 | **AMC Renewal Document Present** | `amc_documents` | `renewal` doc exists if contract expires within 30 days |
| 9 | **Vendor KYC Verified** | `maintenance_vendors` | `kyc_status = 'verified'` for all vendors assigned to tasks |
| 10 | **On-Time Completion** | `ppm_schedules` | `done_date <= planned_date` for `done` tasks |
| 11 | **Postponed / Skipped Justification** | `ppm_schedules.remark` | Non-empty `remark` for `postponed` or `skipped` tasks |
| 12 | **Property-Scoped Vendor Assignment** | `vendor_property_assignments` | Every vendor on a PPM task is assigned to that property |

---

## 3. Sub-Features

### 3.1 Smart Audit Dashboard (Visual Summary)
- **Overall Compliance Score** — weighted aggregate of all 12 criteria (ring chart)
- **Critical Alerts Panel** — red-flag items requiring immediate action (e.g., done but no invoice, AMC expiring without renewal doc)
- **Category Breakdown Cards** — PPM Tasks, AMC Contracts, Vendor KYC, each with mini score
- **Month-over-Month Trend** — compliance trajectory line chart
- **Property Selector** — filter audit scope by single property or all properties

### 3.2 Intelligent Checklist Engine
- Auto-generated checklist per property / per month / per system
- Each checklist item shows:
  - Criteria name & description
  - Current status (✅ Pass / ⚠️ Warning / ❌ Fail / ⏳ Pending)
  - Linked entity (task name, contract ID, vendor name)
  - Date of last update
  - Quick-action button (view details / nudge vendor / upload missing doc)
- **Drill-down** — click any checklist item to open the underlying record (PPM task modal, AMC contract card, vendor profile)

### 3.3 Missing Items Tracker
- Dedicated "What's Missing" view:
  - PPM tasks marked `done` but missing completion photos
  - PPM tasks `done` but missing invoice
  - AMC contracts without contract document
  - AMC contracts expiring in ≤30 days without renewal document
  - Vendors with `pending` or `rejected` KYC
  - `postponed`/`skipped` tasks with empty remarks
- Grouped by priority: **Critical** (overdue / no proof) → **High** (missing invoice/doc) → **Medium** (pending verification)

### 3.4 Audit Trail & Timeline
- Chronological view of all audit-relevant events:
  - Task status changes
  - Document uploads
  - Vendor proof submissions
  - Admin verifications / rejections
  - AMC contract status transitions
- Filterable by date range, property, system, vendor

### 3.5 Comparative Audit (Period-over-Period)
- Select two periods (e.g., Jan vs Feb, or Q1 vs Q2)
- Side-by-side comparison of compliance scores, missing items, and completion rates
- Delta indicators (▲ / ▼) with percentage change

### 3.6 Vendor Performance Scorecard
- Per-vendor audit view:
  - Tasks assigned vs completed
  - On-time completion rate
  - Proof submission rate
  - Admin rejection rate
  - KYC status
  - Invoice upload compliance
- Ranked leaderboard across vendors

### 3.7 Exportable Audit Report
- **PDF Export** — formatted audit report with cover page, executive summary, detailed checklist, charts, and appendices
- **Excel Export** — multi-sheet workbook:
  1. **Summary** — scores, alerts, top issues
  2. **PPM Audit** — task-level audit with all 12 criteria as columns
  3. **AMC Audit** — contract-level audit with document checklist
  4. **Vendor Audit** — vendor-level KYC & performance audit
  5. **Missing Items** — raw list of all failures/warnings with owner & due date
- **CSV Export** — single flat file for external BI tools

---

## 4. Data Architecture & Mapping

### 4.1 Audit Engine Logic (Pseudocode)

```
for each property (or org-wide):
  fetch ppm_schedules for selected date range
  fetch amc_contracts + amc_documents for property
  fetch maintenance_vendors + vendor_property_assignments

  for each ppm_schedule:
    evaluate criteria 1, 2, 3, 4, 5, 10, 11, 12
    score = weighted_sum(passed_criteria) / total_criteria

  for each amc_contract:
    evaluate criteria 6, 7, 8
    score = passed / 3

  for each vendor:
    evaluate criteria 9
    score = 1 if verified else 0

  aggregate:
    overall_score = 0.5*ppm_avg + 0.3*amc_avg + 0.2*vendor_avg
    alerts = all failures where severity = critical
    missing_items = all failures ordered by severity
```

### 4.2 New Database Artifacts (Minimal)

| Table / Column | Purpose |
|----------------|---------|
| `ppm_audit_logs` *(new)* | Immutable record of audit runs: `id`, `property_id`, `run_at`, `overall_score`, `criteria_json`, `run_by` |
| `ppm_schedules.audit_flags` *(new column, jsonb)* | Cached per-task audit result: `{photo_missing: true, invoice_missing: false, ...}` — updated on every task/doc change |
| `amc_contracts.audit_flags` *(new column, jsonb)* | Cached per-contract audit result |

> **Rationale:** Audit logs enable historical trend analysis. `audit_flags` caching prevents heavy recomputation on every dashboard load.

#### `ppm_audit_logs` Schema
```sql
CREATE TABLE ppm_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  property_id UUID REFERENCES properties(id),
  run_by UUID REFERENCES auth.users(id),
  run_at TIMESTAMPTZ DEFAULT now(),
  date_range_start DATE,
  date_range_end DATE,
  overall_score INT CHECK (overall_score BETWEEN 0 AND 100),
  ppm_score INT,
  amc_score INT,
  vendor_score INT,
  criteria_json JSONB DEFAULT '{}',
  missing_count INT DEFAULT 0,
  critical_count INT DEFAULT 0,
  report_url TEXT
);
CREATE INDEX idx_ppm_audit_logs_org ON ppm_audit_logs(organization_id);
CREATE INDEX idx_ppm_audit_logs_property ON ppm_audit_logs(property_id);
CREATE INDEX idx_ppm_audit_logs_run_at ON ppm_audit_logs(run_at);
```

---

## 5. API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/audit/summary` | Overall scores, alerts, breakdown by category for date range + property filter |
| `GET` | `/api/audit/checklist` | Full checklist with status, entity links, and action buttons |
| `GET` | `/api/audit/missing` | Prioritized list of all missing items |
| `GET` | `/api/audit/timeline` | Audit trail events (paginated) |
| `GET` | `/api/audit/compare` | Period-over-period comparison data |
| `GET` | `/api/audit/vendors` | Vendor performance scorecards |
| `POST` | `/api/audit/run` | Trigger a new audit run (stores result in `ppm_audit_logs`) |
| `GET` | `/api/audit/export/pdf` | Generate & return PDF report |
| `GET` | `/api/audit/export/excel` | Generate & return Excel workbook |
| `GET` | `/api/audit/export/csv` | Generate & return CSV |
| `GET` | `/api/audit/history` | List past audit runs with scores & report links |

### 5.1 Query Parameters (Common)
- `propertyId` — single property or `all`
- `from`, `to` — ISO date range
- `system` — optional system_name filter
- `vendorId` — optional vendor filter

---

## 6. Frontend Components

```
frontend/components/audit/
├── AuditDashboard.tsx          # Main container, tab router
├── AuditSummary.tsx            # Visual summary: rings, alerts, trend
├── AuditChecklist.tsx          # Interactive checklist with filters
├── MissingItemsTracker.tsx     # "What's Missing" prioritized view
├── AuditTimeline.tsx           # Chronological event feed
├── AuditCompare.tsx            # Period comparison UI
├── VendorScorecard.tsx         # Per-vendor performance
├── AuditExportModal.tsx        # Export format selector + progress
├── AuditHistory.tsx            # Past audit runs list
├── hooks/
│   ├── useAuditSummary.ts
│   ├── useAuditChecklist.ts
│   └── useAuditExport.ts
└── types/
    └── audit.types.ts          # Centralized AuditItem, AuditScore, etc.
```

### 6.1 Integration Points
- Add `"audit"` tab to `PPMModule.tsx` (6th tab)
- Add `"Audit"` quick-link card to `PropertyAdminDashboard.tsx` and `OrgAdminDashboard.tsx`
- Reuse existing `PPMCalendar` task modal for checklist drill-down
- Reuse existing `AMCContracts` contract card for AMC audit drill-down

---

## 7. User Flows

### 7.1 Property Admin — Weekly Audit Review
1. Opens **Audit** tab from PPM module
2. Sees **Overall Compliance Score** ring + **Critical Alerts** panel
3. Clicks an alert → navigates to **Missing Items** view
4. Finds a "done" task without invoice → clicks **Upload** → opens task modal
5. Returns to audit → score updates in real time
6. Clicks **Export → PDF** → downloads formatted audit report for weekly standup

### 7.2 Org Admin — Monthly Compliance Report
1. Opens Audit dashboard, selects **All Properties**
2. Clicks **Run Audit** → system computes scores, stores log
3. Views **Compare** tab → compares this month vs last month
4. Exports **Excel** → sends to stakeholders

### 7.3 Auditor (External) — Quarterly Inspection
1. Given read-only access to Audit module
2. Views **History** → opens a previously run audit
3. Drills into **Checklist** → expands all failures
4. Downloads **PDF** report as evidence

---

## 8. Scoring Algorithm (v1)

```typescript
// Per-task score (0-100)
function scoreTask(task: PPMSchedule): number {
  let passed = 0;
  const checks = [
    task.status === 'done',
    hasAttachment(task),           // photo or doc
    hasInvoice(task),
    task.verification_status === 'verified',
    task.verification_status === 'verified', // admin verification
    isOnTime(task),
    hasRemarkIfSkipped(task),
  ];
  passed = checks.filter(Boolean).length;
  return Math.round((passed / checks.length) * 100);
}

// Overall score (0-100)
function overallScore(ppmAvg: number, amcAvg: number, vendorAvg: number): number {
  return Math.round(ppmAvg * 0.5 + amcAvg * 0.3 + vendorAvg * 0.2);
}

// Color coding
// 90-100 : Green  (Excellent)
// 70-89  : Blue   (Good)
// 50-69  : Amber  (Needs Attention)
// 0-49   : Red    (Critical)
```

---

## 9. Export Formats — Detailed Spec

### 9.1 PDF Report Structure
1. **Cover Page** — Property name, audit period, generated date, overall score badge
2. **Executive Summary** — 3-4 bullet insights auto-generated by the smart summary engine
3. **Score Breakdown** — Visual ring charts for PPM / AMC / Vendor
4. **Critical Alerts** — Table of top 10 issues
5. **Detailed Checklist** — All items with status icons
6. **Appendix** — Raw data tables (condensed font)

### 9.2 Excel Workbook Structure
| Sheet | Columns |
|-------|---------|
| Summary | Metric, Value, Target, Status |
| PPM Audit | Task ID, System, Detail, Planned Date, Done Date, Status, Photo✓, Invoice✓, Verified✓, On-Time✓, Remark✓, Score |
| AMC Audit | Contract ID, System, Vendor, Start, End, Status, Contract Doc✓, Renewal Doc✓, Score |
| Vendor Audit | Vendor ID, Name, KYC✓, Tasks Assigned, Done, On-Time %, Rejection %, Score |
| Missing Items | Item Type, Entity ID, Description, Owner, Severity, Due Date, Action |

---

## 10. Notifications & Alerts

- **Daily Digest** (cron @ 8 AM): Property admin receives WhatsApp/FCM summary of yesterday's new failures
- **Critical Alert** (real-time): When a task is marked `done` but missing invoice/photo, instant alert to admin
- **Audit Complete** (after `/api/audit/run`): Notification with score + PDF link

---

## 11. Implementation Phases

| Phase | Scope | Est. Effort |
|-------|-------|-------------|
| **P1** — Foundation | DB migration (`ppm_audit_logs`, `audit_flags` columns), `/api/audit/summary` + `/api/audit/checklist`, `AuditSummary` + `AuditChecklist` UI | 3-4 days |
| **P2** — Missing Items & Timeline | `/api/audit/missing`, `/api/audit/timeline`, `MissingItemsTracker`, `AuditTimeline` | 2 days |
| **P3** — Exports | Excel export (XLSX), PDF generation (PDFKit / Puppeteer), CSV export, `AuditExportModal` | 3 days |
| **P4** — Advanced Views | `/api/audit/compare`, `/api/audit/vendors`, `AuditCompare`, `VendorScorecard`, `AuditHistory` | 2-3 days |
| **P5** — Polish & Notifications | Cron jobs for daily digest, real-time critical alerts, caching optimization, UI polish | 2 days |

**Total Estimated Effort:** 12–14 dev-days

---

## 12. Open Questions / Decisions Needed

1. **PDF Engine:** Use `puppeteer` (headless Chrome, heavier) or `pdfmake` / `jspdf` (lighter, code-based)?
2. **Real-time vs Scheduled:** Should audit scores compute on-demand (every page load) or be cached and refreshed via "Run Audit" button?
3. **Read-only Auditor Role:** Do we need a new `auditor` role in `organization_memberships`?
4. **Smart Summary NLP:** Should the "Executive Summary" use rule-based insights or integrate an LLM for natural-language generation?
5. **Photo Verification:** Should we add AI/image validation (e.g., detect if uploaded photo is actually of the equipment)? *(Future scope)*

---

## 13. Appendix — Existing Reuse

| Existing Component | Reuse In Audit Feature |
|--------------------|------------------------|
| `PPMCalendar` task modal | Checklist drill-down for PPM tasks |
| `AMCContracts` contract card | AMC audit drill-down |
| `VendorManagement` vendor card | Vendor scorecard drill-down |
| `/api/ppm/reports` | Data source for PPM scoring |
| `/api/ppm/schedules/[id]/attachments` | Upload missing docs from audit |
| `NotificationService` / `WhatsAppQueueService` | Daily digest & critical alerts |
| Recharts charts | Audit summary visualizations |

---

*Document prepared for review. Please approve or comment before engineering begins.*
