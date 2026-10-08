# Department & WhatsApp Control Center — Implementation Plan & Phase Tracker

This document provides a simple, clear, phase-by-phase roadmap for evolving the **Task Testing [Beta]** tab into the full-featured **Department & WhatsApp Control Center**.

---

## 🛡️ Strict Safety Guarantee During Testing
* **Single Test Recipient:** All testing is strictly locked to **Sahil Gorde (`8433649199`)**. No other staff members, managers, or company employees will ever be messaged.
* **Zero Repeated Messages:** Strict deduplication ensures identical messages are never resent in a single cycle.
* **Safe Dry-Run by Default:** All triggers and scheduled rules default to simulation mode first, generating full message previews without touching the live WhatsApp API.

---

## 📋 Phase-by-Phase Implementation Roadmap

### 🏢 Phase 1: Multi-Department Selection & Overview Dashboard
**Goal:** Break out of the "Tech-only" sandbox and let admins monitor all departments across the company.
* **Department Selector:** A top navigation bar to switch between all departments (Operations, Procurement, Tech, Business Development & Growth, Human Resources, Accounts, Legal, Design, etc.).
* **Department Status Cards:**
  * Assigned Reporting Manager (Name, Phone, Kickoff status).
  * Active Team Member count.
  * WhatsApp Status indicator (🟢 Active / 🔴 Paused).
  * Scheduled Notification Rules count.
  * Today's task progress summary.
* **High-Level Organization Stat Bar:** Total active departments, active managers, total employees, and global WhatsApp state.

---

### 🛑 Phase 2: WhatsApp Kill Switches & Safety Controls
**Goal:** Give admins complete, instant control over WhatsApp messaging with a multi-level kill switch hierarchy.
* **Global Kill Switch:** A prominent master switch:
  * 🟢 **WhatsApp Bot Active**
  * 🔴 **STOP ALL WHATSAPP MESSAGES** (Immediately halts every automated message, reminder, and kickoff across the entire company).
* **Department-Level Kill Switch:** Turn WhatsApp messaging ON or OFF for a single department without affecting others (e.g. Pause Tech while Operations remains active).
* **Message-Type Kill Switches:** Toggle specific message categories globally or per department:
  * Manager Kickoffs
  * Employee Kickoffs
  * Morning Task Digests
  * Midday Reminders
  * Evening Wrap-ups
* **Global Alert Banner:** A persistent red banner across Task Manager when the global kill switch is engaged so everyone knows messaging is intentionally paused.
* **Backend Gatekeeper:** Integrated directly into `TaskMessagingService` so no background cron or API route can ever bypass an active kill switch.

---

### 👑 Phase 3: Reporting Manager Controls & Kickoffs
**Goal:** Easily manage department heads and dispatch their official WhatsApp onboarding.
* **Assign / Change Manager:** Select any staff member from the department to make them the Reporting Manager.
* **Remove / Revert Manager:** Safely step down a manager back to a standard employee.
* **WhatsApp Kickoff Dispatch:**
  * Single-click button to send the Meta-approved Manager Kickoff template (`tm_manager_kickoff_v1`).
  * Shows kickoff delivery status (Sent / Delivered / Pending).
  * Option to Resend Kickoff if an onboarding message was missed.
* **Permission Granting:** Once assigned, the manager gains authority to view their department's tasks and manage their department's notification schedules.

---

### 👥 Phase 4: Employee Roster & Department Transfers
**Goal:** Manage who belongs to each department and send employee kickoffs.
* **Department Roster View:** List all team members in the currently selected department with their contact info, role (`Reporting Manager` vs `Employee`), and phone number health badge (+91 verified).
* **Transfer Employees:** Move an employee from one department to another with automatic department ID updates.
* **Assign Existing Staff:** Easily add an existing unassigned employee into the department.
* **Employee Kickoff Dispatch:**
  * Send or resend the Meta-approved Employee Kickoff template (`tm_employee_kickoff_v1`) to individual members.
  * Preview the personalized message before sending.

---

### ⏰ Phase 5: Department-Scoped Scheduled Notifications (Cron Rules)
**Goal:** Allow custom notification schedules per department without cross-department interference.
* **Per-Department Notification Rules:**
  * Tech, Operations, and Procurement can each have their own independent morning digest, midday reminder, and evening wrap-up times.
* **Manager Access:** Department Reporting Managers can view and configure their own department's notification timings.
* **Department Dry-Run Simulation:** A "Simulate Department Run" button that calculates exactly who will receive notifications and shows preview bubbles without sending real messages.

---

### 📜 Phase 6: Safety Confirmation Dialogs & Activity Audit Log
**Goal:** Prevent accidental clicks on destructive actions and maintain full accountability.
* **Prominent Confirmation Dialogs:**
  * "STOP ALL WHATSAPP MESSAGES" requires explicit confirmation.
  * Removing a Reporting Manager or transferring an employee prompts for confirmation.
* **Activity Audit Trail:** Real-time log tracking:
  * Who changed a manager.
  * Who stopped or resumed WhatsApp.
  * Who sent a kickoff.
  * Who added, transferred, or removed an employee.
  * Exact timestamp and department affected.

---

## 📊 Live Progress & Status Tracker

| Phase | Description | Status | Verification & Approval |
| :---: | :--- | :---: | :--- |
| **Phase 1** | Multi-Department Selection & Overview Dashboard | ✅ **Completed** | Verified with 14 departments & 124 employees (`test_phase1_department_control.ts` passed 4/4) |
| **Phase 2** | WhatsApp Kill Switches & Safety Controls | ✅ **Completed** | Verified multi-level kill switches, gatekeeper & API synchronization (`test_phase2_kill_switches.ts` passed 5/5) |
| **Phase 3** | Reporting Manager Controls & Kickoffs | ✅ **Completed** | Verified manager assignment, step down, gatekeeper pre-check & Meta template kickoff (`test_phase3_to_6.ts` passed) |
| **Phase 4** | Employee Roster & Department Transfers | ✅ **Completed** | Verified department roster grid, staff transfer across departments & employee kickoff (`test_phase3_to_6.ts` passed) |
| **Phase 5** | Department-Scoped Scheduled Notifications | ✅ **Completed** | Verified department simulation dry-run & departmentId rule scoping (`test_phase3_to_6.ts` passed) |
| **Phase 6** | Safety Confirmation Dialogs & Activity Audit Log | ✅ **Completed** | Verified prominent safety dialogs, multi-category audit filtering & query API (`test_phase3_to_6.ts` passed) |

---
*All 6 Phases completed & verified with 100% test coverage and zero TypeScript errors on 2026-10-06.*

