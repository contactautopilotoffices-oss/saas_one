# 🛡️ HR Grievance & Ticketing Module: Architecture & Risk Analysis Report

## Executive Summary
The **HR Grievance & Ticketing Feature** in **SaaS One** is designed as a multi-tier, confidential, and automated escalation system for managing employee grievances, queries, and feedback. It spans across 4 primary authority levels: **Level 1 (Reporting Manager)**, **Level 2 (HR Manager / Ops Lead)**, **Level 3 (HR Head)**, and **Level 4 (Director / Executive Authority)**.

Due to the complex interactions between multi-role dashboards, dual user representations (`public.users` vs `public.employee_profiles`), RLS policies, background outbox event triggers, and anonymous/confidential ticket flows, several **critical failure modes** exist in the current architecture.

---

## 🏗️ 1. Core Module Architecture & Flow

```
[Employee / Staff User] ---> [POST /api/hr/tickets]
                                   |
                      +------------+------------+
                      |                         |
          (Confidential / Anonymous)    (Standard Ticket)
                      |                         |
            [Route to Director]     [Lookup reporting_manager_id]
                      |                         |
                      +------------+------------+
                                   |
                       [Insert into hr_tickets]
                                   |
                   [Trigger: trg_hr_tickets_outbox]
                                   |
                     [Queue: omnichannel_events]
                                   |
                  [WhatsApp & In-App Alerts Sent]
```

---

## 🚨 2. Critical Failure Points & Breaking Modes

### 🔴 Failure Point 1: Outbox Trigger Schema Mismatch (Immediate Runtime SQL Crash)
- **Root Cause**: The database trigger function `fn_hr_ticket_event_outbox()` in `20260910000002_hr_ticket_outbox_triggers.sql` attempts to construct a JSONB payload containing `NEW.resolution_note` and `NEW.resolved_by_user_id`. However, the table `hr_tickets` created in `20260910000001_hr_ticketing_module.sql` does **not** have these columns.
- **Impact**: Any `UPDATE` query on `hr_tickets` (e.g. updating status, escalating, assigning, or resolving a ticket) will trigger `fn_hr_ticket_event_outbox()` and fail with PostgreSQL error `column "resolution_note" does not exist on table hr_tickets`. This completely breaks ticket updates and resolutions via API!

### 🔴 Failure Point 2: Manager Confidentiality & Privacy Leak
- **Root Cause**: In `GET /api/hr/tickets`, manager query scoping is constructed as:
  ```typescript
  query.or(`assigned_to_user_id.eq.${userId},raised_by_user_id.in.(${allowedUserIds.join(',')})`)
  ```
- **Impact**: If an employee raises a **confidential grievance against their own reporting manager** (`is_confidential = true`), the reporting manager's `GET` request will include the ticket because `raised_by_user_id` matches one of the manager's reportees!
- **Consequence**: The manager being reported can view confidential complaints filed against them, violating whistleblower protection and privacy policies.

### 🔴 Failure Point 3: Unlinked Profiles & Orphaned Tickets
- **Root Cause**: Employee profiles (`employee_profiles`) can exist in `unlinked` or `pending_approval` state, or app users can exist as "virtual users" without a row in `employee_profiles`. When a user raises a ticket:
  1. `POST /api/hr/tickets` looks up `employee_profiles` by `user_id`.
  2. If the user is unlinked or has no profile, `empProfile.reporting_manager_id` returns `null`.
  3. `firstLevelOwnerId` evaluates to `null`.
- **Impact**: The ticket is inserted with `assigned_to_user_id = null`. No manager receives notifications, no manager sees it on their dashboard, and the grievance sits in an **orphaned state** indefinitely.

### 🔴 Failure Point 4: Silent Escalation Deadlocks (Missing Authority Roles)
- **Root Cause**: When SLA expires (`/api/cron/hr-sla-escalation`), the system attempts to auto-escalate:
  - Level 1 → Level 2 (`is_hr_manager_authority = true`)
  - Level 2 → Level 3 (`is_hr_authority = true`)
  - Level 3 → Level 4 (`is_director_authority = true`)
- **Impact**: If no employee profile in the organization has `is_hr_manager_authority = true` or `is_director_authority = true` set to `true`, `nextAssigneeId` falls back to the **current (breached) assignee ID**.
- **Consequence**: The ticket's `current_level` increments to 2/3/4 and status changes to `escalated`, but **it remains assigned to the exact same manager who ignored it**, creating a false sense of escalation with zero progress.

### 🔴 Failure Point 5: Reporting Manager Re-Assignment Sync Gaps
- **Root Cause**: When an employee's reporting manager changes via `PATCH /api/hr/admin/employees`, the code attempts to update open Level 1 tickets.
- **Impact**: 
  1. If `sync_open_tickets` runs, it only updates tickets where `status = 'new'`. Tickets in `in_progress`, `awaiting_employee_response`, or `awaiting_manager_response` remain assigned to the **former manager**.
  2. If the employee was originally a virtual user and a new profile is inserted on the fly, previous historical tickets raised by `user_id` are not back-linked.

---

## 🛠️ 3. Recommended Remediation & Safeguards

| Failure Point | Recommended Technical Solution |
| :--- | :--- |
| **1. Missing Outbox Columns** | Add missing columns `resolution_note TEXT` and `resolved_by_user_id UUID` to `hr_tickets` via database migration, OR fix `fn_hr_ticket_event_outbox()` trigger payload. |
| **2. Confidentiality Filter** | Update `GET /api/hr/tickets` manager scoping to explicitly exclude confidential tickets: `.eq('is_confidential', false)` for managers. |
| **3. Manager Lookup Guard** | In `POST /api/hr/tickets`, if `reporting_manager_id` is null, automatically fall back to `default_hr_owner_id` or Org Super Admin instead of leaving `assigned_to_user_id` null. |
| **4. SLA Escalation Fallback** | In `cron/hr-sla-escalation`, if no user has the specific authority flag, fallback to the Org Super Admin / Property Admin so escalation never deadlocks. |
| **5. Comprehensive Ticket Sync** | Extend `PATCH /api/hr/admin/employees` ticket sync to cover all active open statuses (`new`, `assigned`, `in_progress`, `awaiting_manager_response`). |
