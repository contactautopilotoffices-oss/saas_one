# 📱 Meta WhatsApp Business Approved Message Templates Guide (Updated)

This document contains the revised, copy-paste ready message template copy for AutoPilot's integration with **AiSensy / Meta WhatsApp Business Cloud API**.

> [!IMPORTANT]
> **Meta Submission Rules for 100% Guaranteed Approval:**
> 1. **Category:** Always select **`UTILITY`** (Transaction/Operational updates).
> 2. **Language:** Select **`English (en)`** (or `en_US` / `en_GB`).
> 3. **Variable Format:** Variables must use double curly braces with numbers: `{{1}}`, `{{2}}`, `{{3}}`, etc. in strictly increasing sequential order across the whole template.
> 4. **Dynamic URL Buttons:** In AiSensy, the URL parameter continues the sequential numbering after body variables (e.g. if body has 8 variables, the button URL variable is `{{9}}`).
> 5. **Sample Values:** When Meta asks for sample values during template creation, copy the exact sample values provided below.

---

## Table of Contents
1. [Tickets & SLA Management](#1-tickets--sla-management)
2. [SOP Checklists & Compliance](#2-sop-checklists--compliance)
3. [AI Multi-Property Daily Executive Report](#3-ai-multi-property-daily-executive-report)
4. [Procurement & Material Management Suite](#4-procurement--material-management-suite)
   - *Material Requests & Comparative Statements (Templates 8–12)*
   - *Monthly Site Requisitions Suite (Templates 13–13D)*
   - *Vendor Procurement Tagging (Templates 14–15)*
5. [Preventive Maintenance (PPM)](#5-preventive-maintenance-ppm)
6. [Meeting Room Reservations](#6-meeting-room-reservations)
7. [CRM Sales Leads](#7-crm-sales-leads)
8. [FMS Welcome & Onboarding Broadcast](#8-fms-welcome--onboarding-broadcast)

---

## 1. Tickets & SLA Management

### Template 1A: `ticket_created_v3` (Text-Only / Default when NO photo is uploaded)
- **Template Name:** `ticket_created_v3`
- **Category:** `UTILITY`
- **Language:** `English (en)`
- **Header:** `Text` &rarr; `New Ticket Created 📋` *(or None)*
- **Body:**
```text
Hello {{1}},

A new ticket has been raised on AutoPilot.

🎫 Ticket ID: #{{2}}
📋 Title: {{3}}
🏢 Property: {{4}}
⚡ Priority: {{5}}
👤 Raised By: {{6}} (📞 {{7}})
👷 Assigned To: {{8}} (📞 {{9}})

Our team has been notified to attend to this request.
```
- **Footer:** `AutoPilot Property Management`
- **Button Type:** `Call to Action (Dynamic URL)`
  - **Button Text:** `View Ticket`
  - **URL Type:** `Dynamic` &rarr; `https://fms-dev-saas-one.vercel.app/tickets/{{10}}`
- **Sample Values:**
  - `{{1}}`: `Property Team`
  - `{{2}}`: `TICK-1042`
  - `{{3}}`: `Main AC cooling leakage in 3rd floor cafeteria`
  - `{{4}}`: `WorkSquare Hub 1`
  - `{{5}}`: `High`
  - `{{6}}`: `Amit Patel`
  - `{{7}}`: `+91 98765 43210`
  - `{{8}}`: `Sunil Kumar (MST)`
  - `{{9}}`: `+91 98111 22334`
  - `{{10}}` *(Button URL Ticket UUID)*: `d35372d1-bee2-403f-8578-00da66f16984`

---

### Template 1B: `ticket_created_v3_media` (Used automatically when BEFORE PHOTO is uploaded)
- **Template Name:** `ticket_created_v3_media`
- **Category:** `UTILITY`
- **Language:** `English (en)`
- **Header:** `Media` &rarr; Select **`Image`** *(Upload sample issue photo)*
- **Body:** *(Identical body)*
```text
Hello {{1}},

A new ticket has been raised on AutoPilot.

🎫 Ticket ID: #{{2}}
📋 Title: {{3}}
🏢 Property: {{4}}
⚡ Priority: {{5}}
👤 Raised By: {{6}} (📞 {{7}})
👷 Assigned To: {{8}} (📞 {{9}})

Our team has been notified to attend to this request.
```
- **Footer:** `AutoPilot Property Management`
- **Button Type:** `Call to Action (Dynamic URL)`
  - **Button Text:** `View Ticket`
  - **URL Type:** `Dynamic` &rarr; `https://fms-dev-saas-one.vercel.app/tickets/{{10}}`
- **Sample Values:**
  - `Header Image`: Upload any sample equipment/issue photo
  - `{{1}}`: `Property Team`
  - `{{2}}`: `TICK-1042`
  - `{{3}}`: `Main AC cooling leakage in 3rd floor cafeteria`
  - `{{4}}`: `WorkSquare Hub 1`
  - `{{5}}`: `High`
  - `{{6}}`: `Amit Patel`
  - `{{7}}`: `+91 98765 43210`
  - `{{8}}`: `Sunil Kumar (MST)`
  - `{{9}}`: `+91 98111 22334`
  - `{{10}}` *(Button URL Ticket UUID)*: `d35372d1-bee2-403f-8578-00da66f16984`

---

### Template 2: `ticket_assigned_v1` (Dedicated to Assignee / Technician)
- **Template Name:** `ticket_assigned_v1`
- **Category:** `UTILITY`
- **Language:** `English (en)`
- **Header:** `Text` &rarr; `Ticket Assigned to You 👷`
- **Body:**
```text
Hello {{1}},

A ticket has been assigned to you for resolution.

🎫 Ticket ID: #{{2}}
📋 Title: {{3}}
🏢 Property: {{4}}
⚡ Priority: {{5}}
👤 Requester: {{6}} (📞 {{7}})

Please inspect the issue on site and update progress.
```
- **Footer:** `AutoPilot Maintenance`
- **Button Type:** `Call to Action (Dynamic URL)`
  - **Button Text:** `Open Ticket`
  - **URL Type:** `Dynamic` &rarr; `https://fms-dev-saas-one.vercel.app/tickets/{{8}}`
- **Sample Values:**
  - `{{1}}`: `Sunil Kumar`
  - `{{2}}`: `TICK-1042`
  - `{{3}}`: `Main AC cooling leakage in cafeteria`
  - `{{4}}`: `WorkSquare Hub 1`
  - `{{5}}`: `High`
  - `{{6}}`: `Amit Patel`
  - `{{7}}`: `+91 98765 43210`
  - `{{8}}` *(Button URL Ticket UUID)*: `d35372d1-bee2-403f-8578-00da66f16984`

---

### Template 3A: `ticket_completed_v1` (Text-Only / Default when NO after-photo is uploaded)
- **Template Name:** `ticket_completed_v1`
- **Category:** `UTILITY`
- **Language:** `English (en)`
- **Header:** `Text` &rarr; `Ticket Resolved & Completed ✅` *(or None)*
- **Body:**
```text
Hello {{1}},

Ticket #{{2}} has been marked completed.

📋 Title: {{3}}
🏢 Property: {{4}}
👷 Resolved By: {{5}}

Click below to verify the completion and rate the service.
```
- **Footer:** `AutoPilot Quality Assurance`
- **Button Type:** `Call to Action (Dynamic URL)`
  - **Button Text:** `Verify & Rate`
  - **URL Type:** `Dynamic` &rarr; `https://fms-dev-saas-one.vercel.app/tickets/{{6}}`
- **Sample Values:**
  - `{{1}}`: `Amit Patel`
  - `{{2}}`: `TICK-1042`
  - `{{3}}`: `Main AC cooling leakage in cafeteria`
  - `{{4}}`: `WorkSquare Hub 1`
  - `{{5}}`: `Sunil Kumar (MST)`
  - `{{6}}` *(Button URL Ticket UUID)*: `d35372d1-bee2-403f-8578-00da66f16984`

---

### Template 3B: `ticket_completed_v1_media` (Used automatically when AFTER PHOTO is uploaded)
- **Template Name:** `ticket_completed_v1_media`
- **Category:** `UTILITY`
- **Language:** `English (en)`
- **Header:** `Media` &rarr; Select **`Image`** *(Upload sample work completion / resolved photo)*
- **Body:** *(Identical body)*
```text
Hello {{1}},

Ticket #{{2}} has been marked completed.

📋 Title: {{3}}
🏢 Property: {{4}}
👷 Resolved By: {{5}}

Click below to verify the completion and rate the service.
```
- **Footer:** `AutoPilot Quality Assurance`
- **Button Type:** `Call to Action (Dynamic URL)`
  - **Button Text:** `Verify & Rate`
  - **URL Type:** `Dynamic` &rarr; `https://fms-dev-saas-one.vercel.app/tickets/{{6}}`
- **Sample Values:**
  - `Header Image`: Upload sample repaired equipment photo
  - `{{1}}`: `Amit Patel`
  - `{{2}}`: `TICK-1042`
  - `{{3}}`: `Main AC cooling leakage in cafeteria`
  - `{{4}}`: `WorkSquare Hub 1`
  - `{{5}}`: `Sunil Kumar (MST)`
  - `{{6}}` *(Button URL Ticket UUID)*: `d35372d1-bee2-403f-8578-00da66f16984`

---

### Template 4: `reminder_ticket_sla_v1` (SLA Warning)
- **Template Name:** `reminder_ticket_sla_v1`
- **Category:** `UTILITY`
- **Language:** `English (en)`
- **Header:** `Text` &rarr; `⚠️ SLA Breach Warning`
- **Body:**
```text
Hello {{1}},

Ticket #{{2}} ({{3}}) at {{4}} is approaching its resolution SLA deadline.

⏰ SLA Deadline: {{5}}
⚡ Priority: {{6}}
👷 Assigned To: {{7}}

Please take immediate action to resolve or update the ticket.
```
- **Footer:** `AutoPilot SLA Escalations`
- **Button Type:** `Quick Reply` &rarr; `Acknowledge SLA`
- **Sample Values:**
  - `{{1}}`: `Sunil Kumar`
  - `{{2}}`: `TICK-1042`
  - `{{3}}`: `Main server room temperature alert`
  - `{{4}}`: `WorkSquare Hub 1`
  - `{{5}}`: `18/08/2026, 02:00 PM`
  - `{{6}}`: `Critical`
  - `{{7}}`: `Sunil Kumar`

---

## 2. SOP Checklists & Compliance

### Template 5A: `checklist_slot_reminder_v2` (Pre-Start Reminder)
- **Template Name:** `checklist_slot_reminder_v2` *(or `checklist_slot_reminder_v1`)*
- **Category:** `UTILITY`
- **Language:** `English (en)`
- **Header:** `Text` &rarr; `Checklist Slot Due Reminder 📋`
- **Body:**
```text
Hello {{1}},

Site checklist inspection is due for completion.

📋 Checklist: {{2}}
🏢 Property: {{3}}
⏰ Due Slot / Deadline: {{4}}

Please ensure the shift inspection is performed and submitted on the portal.
```
- **Footer:** `AutoPilot Operations`
- **Button Type:** `Call to Action (Dynamic URL)`
  - **Button Text:** `Open Checklists`
  - **URL Type:** `Dynamic` &rarr; `https://fms-dev-saas-one.vercel.app/property/{{5}}/sop`
- **Sample Values:**
  - `{{1}}`: `Operations Team`
  - `{{2}}`: `Daily DG & Electrical Panel Morning Inspection`
  - `{{3}}`: `WorkSquare Hub 1`
  - `{{4}}`: `10:00 AM (in 10 mins)`
  - `{{5}}` *(Button URL Property UUID)*: `211e1330-ad83-446d-941f-dcea48396798`

---

### Template 5B: `checklist_started_v1` (Shift Started Alert)
- **Template Name:** `checklist_started_v1`
- **Category:** `UTILITY`
- **Language:** `English (en)`
- **Header:** `Text` &rarr; `Checklist Shift Started 📋`
- **Body:**
```text
Hello {{1}},

The scheduled checklist inspection for {{2}} at {{3}} has started (Shift Start: {{4}}).

Please conduct your inspection rounds, log mandatory parameters, and upload verification photos in the app.
```
- **Footer:** `AutoPilot Operations`
- **Button Type:** `Call to Action (Website URL)`
  - **Button Text:** `Open Checklist`
  - **URL Type:** `Static` &rarr; `https://fms-dev-saas-one.vercel.app/sop`
- **Sample Values:**
  - `{{1}}`: `Harsh Patil`
  - `{{2}}`: `Daily Morning MST Shift Inspection`
  - `{{3}}`: `Mafatlal Chambers`
  - `{{4}}`: `09:00 AM`

---

### Template 5C: `checklist_completed_v1` (Checklist Completed & Submitted)
- **Template Name:** `checklist_completed_v1`
- **Category:** `UTILITY`
- **Language:** `English (en)`
- **Header:** `Text` &rarr; `Checklist Completed ✅`
- **Body:**
```text
Hello {{1}},

The checklist inspection for {{2}} at {{3}} has been completed.

👤 Completed By: {{4}}
⏰ Completion Time: {{5}}

The submission is now ready for supervisor audit and verification.
```
- **Footer:** `AutoPilot Operations`
- **Button Type:** `Call to Action (Website URL)`
  - **Button Text:** `Review Submission`
  - **URL Type:** `Static` &rarr; `https://fms-dev-saas-one.vercel.app/sop`
- **Sample Values:**
  - `{{1}}`: `Property Admin`
  - `{{2}}`: `Daily Morning MST Shift Inspection`
  - `{{3}}`: `Mafatlal Chambers`
  - `{{4}}`: `Ramesh MST`
  - `{{5}}`: `12:45 PM`

---

### Template 6: `checklist_overdue_alert_v2` (Overdue / Missed Alert)
- **Template Name:** `checklist_overdue_alert_v2` *(or `checklist_overdue_alert_v1`)*
- **Category:** `UTILITY`
- **Language:** `English (en)`
- **Header:** `Text` &rarr; `🚨 Overdue Checklist Alert`
- **Body:**
```text
Alert: A required checklist has not been submitted on time.

📋 Checklist: {{1}}
🏢 Property: {{2}}
⏰ Scheduled Time: {{3}}

Please review site status to ensure compliance standards.
```
- **Footer:** `AutoPilot Compliance`
- **Button Type:** `Quick Reply` &rarr; `View Pending SOPs`
- **Sample Values:**
  - `{{1}}`: `Washroom Hygiene Shift A`
  - `{{2}}`: `WorkSquare Hub 1`
  - `{{3}}`: `09:00 AM – 05:00 PM (Incomplete)`

---

## 3. AI Multi-Property Daily Executive Report

### Template 7: `ai_property_report_v1`
*(Daily multi-property operations executive summary broadcast exclusively to Org Super Admins & Directors selected in the Admin UI)*

- **Template Name:** `ai_property_report_v1`
- **Category:** `UTILITY`
- **Language:** `English (en)`
- **Header:** `Text` &rarr; `AI Operations Executive Report 🤖`
- **Body:**
```text
Hello {{1}},

Here is the daily multi-property operations executive summary for {{2}}:

📅 Date: {{3}}
🎫 Tickets: 🔴 {{4}} Critical | 🟠 {{5}} Open | ✅ {{6}} Resolved Today
⚡ Energy Logged: {{7}} kWh (DG: {{8}} Ltrs)
🔧 PPM Tasks: {{9}} Completed | ⚠️ {{10}} Missed / Overdue
📋 SOP Compliance: {{11}}

🏢 Multi-Property Breakdown:
{{12}}

🤖 AI Insights & Recommendations:
{{13}}
```
- **Footer:** `AutoPilot AI Intelligence`
- **Button Type:** `Call to Action (Website URL)`
  - **Button Text:** `Open Executive Portal`
  - **URL Type:** `Static` &rarr; `https://fms-dev-saas-one.vercel.app/org/dashboard?tab=reports`
- **Sample Values:**
  - `{{1}}`: `Saniel`
  - `{{2}}`: `WorkSquare Group (3 Properties)`
  - `{{3}}`: `20/08/2026`
  - `{{4}}`: `1`
  - `{{5}}`: `7`
  - `{{6}}`: `12`
  - `{{7}}`: `1,420`
  - `{{8}}`: `45`
  - `{{9}}`: `3`
  - `{{10}}`: `0`
  - `{{11}}`: `94% (28/30 Checklists Done)`
  - `{{12}}`: `• Hub 1 (Rabale): 1 Critical, 3 Open | 100% SOPs\n• Hub 2 (Vashi): 0 Critical, 4 Open | 92% SOPs\n• Hub 3 (BKC): 0 Critical, 0 Open | 100% SOPs`
  - `{{13}}`: `• Hub 1 energy usage spiked 14% higher than baseline.\n• Chiller PPM completed smoothly without downtime.`

---

## 4. Procurement & Material Management Suite

### Template 8: `material_request_created_v3`
- **Template Name:** `material_request_created_v3`
- **Category:** `UTILITY`
- **Language:** `English (en)`
- **Header:** `Text` &rarr; `New Material Request 🛒`
- **Body:**
```text
Hello {{1}},

A new material request has been created.

🎫 Ticket ID: #{{2}}
🏢 Property: {{3}}
👤 Requested By: {{4}} (📞 {{5}})
📦 Required Items: {{6}}

Please review the requirements and upload comparative quotations.
```
- **Footer:** `AutoPilot Procurement`
- **Button Type:** `Call to Action (Dynamic URL)`
  - **Button Text:** `View Request`
  - **URL Type:** `Dynamic` &rarr; `https://fms-dev-saas-one.vercel.app/tickets/{{7}}`
- **Sample Values:**
  - `{{1}}`: `Procurement Team`
  - `{{2}}`: `TICK-1088`
  - `{{3}}`: `WorkSquare Hub 1`
  - `{{4}}`: `Ramesh MST`
  - `{{5}}`: `+91 98765 43210`
  - `{{6}}`: `LED Tube Lights 18W x10, MCB 32A TP x4`
  - `{{7}}` *(Button URL Ticket UUID)*: `d35372d1-bee2-403f-8578-00da66f16984`

---

### Template 9A: `comparative_approval_requested_v1`
*(Action Required — Sent directly to the Assigned Approver / Director selected on the quotation)*

- **Template Name:** `comparative_approval_requested_v1`
- **Category:** `UTILITY`
- **Language:** `English (en)`
- **Header:** `Text` &rarr; `Action Required: Comparative Approval 📄`
- **Body:**
```text
Hello {{1}},

A comparative quotation has been uploaded by {{2}} for Ticket #{{3}} ({{4}}) at {{5}}.

📋 Total Est. Cost: ₹{{6}}
📝 Procurement Note: {{7}}

Please review the comparative statement and provide your approval.
```
- **Footer:** `AutoPilot Procurement Approvals`
- **Button Type:** `Call to Action (Dynamic URL)`
  - **Button Text:** `Review & Approve`
  - **URL Type:** `Dynamic` &rarr; `https://fms-dev-saas-one.vercel.app/tickets/{{8}}`
- **Sample Values:**
  - `{{1}}`: `Saniel (Approver)`
  - `{{2}}`: `Alok Procurement`
  - `{{3}}`: `TICK-1088`
  - `{{4}}`: `Electrical Panel Spares`
  - `{{5}}`: `WorkSquare Hub 1`
  - `{{6}}`: `45,000`
  - `{{7}}`: `Quotes received from 3 vendors, lowest attached.`
  - `{{8}}` *(Button URL Ticket UUID)*: `d35372d1-bee2-403f-8578-00da66f16984`

---

### Template 9B: `comparative_uploaded_info_v1`
*(Informational Update — Sent to Requester, Site Staff, and Team Stakeholders)*

- **Template Name:** `comparative_uploaded_info_v1`
- **Category:** `UTILITY`
- **Language:** `English (en)`
- **Header:** `Text` &rarr; `Comparative Quote Uploaded 📄`
- **Body:**
```text
Hello {{1}},

A comparative quotation has been uploaded by {{2}} for Ticket #{{3}} ({{4}}) at {{5}}.

📋 Total Est. Cost: ₹{{6}}
👤 Assigned Approver: {{7}}
📝 Procurement Note: {{8}}

The request has been submitted for approval.
```
- **Footer:** `AutoPilot Procurement`
- **Button Type:** `Call to Action (Dynamic URL)`
  - **Button Text:** `View Quotation`
  - **URL Type:** `Dynamic` &rarr; `https://fms-dev-saas-one.vercel.app/tickets/{{9}}`
- **Sample Values:**
  - `{{1}}`: `Ramesh MST (Requester)`
  - `{{2}}`: `Alok Procurement`
  - `{{3}}`: `TICK-1088`
  - `{{4}}`: `Electrical Panel Spares`
  - `{{5}}`: `WorkSquare Hub 1`
  - `{{6}}`: `45,000`
  - `{{7}}`: `Saniel (Director)`
  - `{{8}}`: `Quotes received from 3 vendors, lowest attached.`
  - `{{9}}` *(Button URL Ticket UUID)*: `d35372d1-bee2-403f-8578-00da66f16984`

---

### Template 10: `comparative_approved_v1`
- **Template Name:** `comparative_approved_v1`
- **Category:** `UTILITY`
- **Language:** `English (en)`
- **Header:** `Text` &rarr; `Comparative Quote Approved ✅`
- **Body:**
```text
Hello {{1}},

The comparative quotation for Ticket #{{2}} ({{3}}) at {{4}} has been approved by {{5}}.

📋 Approved Amount: ₹{{6}}
💬 Approver Comment: {{7}}

Procurement may now proceed with placing the purchase order.
```
- **Footer:** `AutoPilot Procurement`
- **Button Type:** `Call to Action (Dynamic URL)`
  - **Button Text:** `Place Order`
  - **URL Type:** `Dynamic` &rarr; `https://fms-dev-saas-one.vercel.app/tickets/{{8}}`
- **Sample Values:**
  - `{{1}}`: `Alok Procurement`
  - `{{2}}`: `TICK-1088`
  - `{{3}}`: `Electrical Panel Spares`
  - `{{4}}`: `WorkSquare Hub 1`
  - `{{5}}`: `Saniel`
  - `{{6}}`: `45,000`
  - `{{7}}`: `Approved as per lowest quote.`
  - `{{8}}` *(Button URL Ticket UUID)*: `d35372d1-bee2-403f-8578-00da66f16984`

---

### Template 11: `comparative_rejected_v1`
- **Template Name:** `comparative_rejected_v1`
- **Category:** `UTILITY`
- **Language:** `English (en)`
- **Header:** `Text` &rarr; `Comparative Negotiation Requested ⚠️`
- **Body:**
```text
Hello {{1}},

The comparative quotation for Ticket #{{2}} ({{3}}) at {{4}} requires negotiation / revision.

📋 Quotation Amount: ₹{{5}}
👤 Action By: {{6}}
💬 Reason / Notes: {{7}}

Please renegotiate with vendors and upload a revised comparative statement.
```
- **Footer:** `AutoPilot Procurement`
- **Button Type:** `Call to Action (Dynamic URL)`
  - **Button Text:** `View Feedback`
  - **URL Type:** `Dynamic` &rarr; `https://fms-dev-saas-one.vercel.app/tickets/{{8}}`
- **Sample Values:**
  - `{{1}}`: `Alok Procurement`
  - `{{2}}`: `TICK-1088`
  - `{{3}}`: `Electrical Panel Spares`
  - `{{4}}`: `WorkSquare Hub 1`
  - `{{5}}`: `45,000`
  - `{{6}}`: `Saniel`
  - `{{7}}`: `Please request 10% discount on bulk order.`
  - `{{8}}` *(Button URL Ticket UUID)*: `d35372d1-bee2-403f-8578-00da66f16984`

---

### Template 12: `material_delivered_v1`
- **Template Name:** `material_delivered_v1`
- **Category:** `UTILITY`
- **Language:** `English (en)`
- **Header:** `Text` &rarr; `Materials Delivered on Site 📦`
- **Body:**
```text
Hello {{1}},

Materials for Ticket #{{2}} ({{3}}) have been confirmed as delivered to {{4}}.

📦 Delivered Items: {{5}}
👷 Verified By: {{6}}

Site staff may now proceed with installation and closure.
```
- **Footer:** `AutoPilot Operations`
- **Button Type:** `Call to Action (Dynamic URL)`
  - **Button Text:** `Verify Materials`
  - **URL Type:** `Dynamic` &rarr; `https://fms-dev-saas-one.vercel.app/tickets/{{7}}`
- **Sample Values:**
  - `{{1}}`: `Ramesh MST`
  - `{{2}}`: `TICK-1088`
  - `{{3}}`: `Electrical Panel Spares`
  - `{{4}}`: `WorkSquare Hub 1`
  - `{{5}}`: `LED Tube Lights x10, MCB 32A x4`
  - `{{6}}`: `Site Store Keeper`
  - `{{7}}` *(Button URL Ticket UUID)*: `d35372d1-bee2-403f-8578-00da66f16984`

---

### Template 13: `requisition_submitted_v1`
- **Template Name:** `requisition_submitted_v1`
- **Category:** `UTILITY`
- **Language:** `English (en)`
- **Header:** `Text` &rarr; `Monthly Requisition Submitted 📊`
- **Body:**
```text
Hello {{1}},

A new monthly material requisition has been submitted for {{2}}.

📅 Period: {{3}} {{4}}
📦 Items Count: {{5}} line items
💰 Total Estimated Amount: ₹{{6}}
👤 Requested By: {{7}}

Please review the requisition and proceed with vendor price comparisons.
```
- **Footer:** `AutoPilot Procurement`
- **Button Type:** `Call to Action (Website URL)`
  - **Button Text:** `View Requisition`
  - **URL Type:** `Static` &rarr; `https://fms-dev-saas-one.vercel.app/procurement?tab=requisitions`
- **Sample Values:**
  - `{{1}}`: `Procurement Team`
  - `{{2}}`: `Rabale (2nd Floor)`
  - `{{3}}`: `June`
  - `{{4}}`: `2026`
  - `{{5}}`: `28`
  - `{{6}}`: `42,500`
  - `{{7}}`: `Sachin Goswami (Site Admin)`

---

### Template 13B: `requisition_approval_requested_v1`
- **Template Name:** `requisition_approval_requested_v1`
- **Category:** `UTILITY`
- **Language:** `English (en)`
- **Header:** `Text` &rarr; `Action Required: Requisition Approval 📄`
- **Body:**
```text
Hello {{1}},

A monthly material requisition for {{2}} has been prepared with finalized vendor quotes and requires your approval.

📅 Period: {{3}} {{4}}
🏢 Selected Vendor: {{5}}
💰 Total Quoted Cost: ₹{{6}}
📝 Procurement Notes: {{7}}

Please review the items & comparative sheet and approve in the app.
```
- **Footer:** `AutoPilot Approvals`
- **Button Type:** `Call to Action (Website URL)`
  - **Button Text:** `Review & Approve`
  - **URL Type:** `Static` &rarr; `https://fms-dev-saas-one.vercel.app/procurement?tab=requisitions`
- **Sample Values:**
  - `{{1}}`: `Saniel (Director / Org Super Admin)`
  - `{{2}}`: `Rabale (2nd Floor)`
  - `{{3}}`: `June`
  - `{{4}}`: `2026`
  - `{{5}}`: `Reliable Spares & Supplies`
  - `{{6}}`: `41,200`
  - `{{7}}`: `Quotes received from 3 vendors, lowest quoted attached.`

---

### Template 13C: `requisition_status_updated_v1`
- **Template Name:** `requisition_status_updated_v1`
- **Category:** `UTILITY`
- **Language:** `English (en)`
- **Header:** `Text` &rarr; `Requisition Status Update 📋`
- **Body:**
```text
Hello {{1}},

The monthly requisition for {{2}} ({{3}} {{4}}) has been {{5}} by {{6}}.

💰 Total Quoted: ₹{{7}}
💬 Approver Remarks: {{8}}

Procurement team may now proceed with the next steps in the app.
```
- **Footer:** `AutoPilot Procurement`
- **Button Type:** `Call to Action (Website URL)`
  - **Button Text:** `View Status`
  - **URL Type:** `Static` &rarr; `https://fms-dev-saas-one.vercel.app/procurement?tab=requisitions`
- **Sample Values:**
  - `{{1}}`: `Procurement Team`
  - `{{2}}`: `Rabale (2nd Floor)`
  - `{{3}}`: `June`
  - `{{4}}`: `2026`
  - `{{5}}`: `APPROVED`
  - `{{6}}`: `Saniel`
  - `{{7}}`: `41,200`
  - `{{8}}`: `Approved as per lowest quote.`

---

### Template 13D: `requisition_po_issued_v1`
- **Template Name:** `requisition_po_issued_v1`
- **Category:** `UTILITY`
- **Language:** `English (en)`
- **Header:** `Text` &rarr; `Purchase Order Issued 🛒`
- **Body:**
```text
Hello {{1}},

The Purchase Order for the {{2}} {{3}} monthly requisition at {{4}} has been issued to {{5}}.

🧾 PO Number: #{{6}}
💰 Total PO Amount: ₹{{7}}

Items will be delivered to site as per schedule.
```
- **Footer:** `AutoPilot Procurement`
- **Button Type:** `Call to Action (Website URL)`
  - **Button Text:** `Track Delivery`
  - **URL Type:** `Static` &rarr; `https://fms-dev-saas-one.vercel.app/procurement?tab=requisitions`
- **Sample Values:**
  - `{{1}}`: `Sachin Goswami (Site Admin)`
  - `{{2}}`: `June`
  - `{{3}}`: `2026`
  - `{{4}}`: `Rabale (2nd Floor)`
  - `{{5}}`: `Reliable Spares & Supplies`
  - `{{6}}`: `PO-2026-089`
  - `{{7}}`: `41,200`

---

### Template 14: `procurement_vendor_tag_v1`
- **Template Name:** `procurement_vendor_tag_v1`
- **Category:** `UTILITY`
- **Language:** `English (en)`
- **Header:** `Text` &rarr; `Procurement Vendor Tagged 🏷️`
- **Body:**
```text
Hello {{1}},

Site staff has tagged procurement to arrange an external vendor/service for Ticket #{{2}} ({{3}}) at {{4}}.

👤 Tagged By: {{5}}
📝 Note: {{6}}
👷 Assigned Specialist: {{7}}

Please coordinate with certified vendors and provide update.
```
- **Footer:** `AutoPilot Procurement`
- **Button Type:** `Call to Action (Dynamic URL)`
  - **Button Text:** `Open Ticket`
  - **URL Type:** `Dynamic` &rarr; `https://fms-dev-saas-one.vercel.app/tickets/{{8}}`
- **Sample Values:**
  - `{{1}}`: `Procurement Team`
  - `{{2}}`: `TICK-1055`
  - `{{3}}`: `Lift 3 Inverter Drive Fault`
  - `{{4}}`: `WorkSquare Hub 1`
  - `{{5}}`: `Ramesh MST`
  - `{{6}}`: `OEM technician inspection needed`
  - `{{7}}`: `Alok Procurement`
  - `{{8}}` *(Button URL Ticket UUID)*: `d35372d1-bee2-403f-8578-00da66f16984`

---

### Template 15: `procurement_vendor_aligned_v1`
- **Template Name:** `procurement_vendor_aligned_v1`
- **Category:** `UTILITY`
- **Language:** `English (en)`
- **Header:** `Text` &rarr; `Vendor Aligned / Arranged 🤝`
- **Body:**
```text
Hello {{1}},

Procurement has arranged an external vendor for Ticket #{{2}} ({{3}}) at {{4}}.

🏭 Vendor Details: {{5}}
👤 Arranged By: {{6}}

The vendor has been scheduled to visit the site.
```
- **Footer:** `AutoPilot Operations`
- **Button Type:** `Call to Action (Dynamic URL)`
  - **Button Text:** `View Ticket`
  - **URL Type:** `Dynamic` &rarr; `https://fms-dev-saas-one.vercel.app/tickets/{{7}}`
- **Sample Values:**
  - `{{1}}`: `Ramesh MST`
  - `{{2}}`: `TICK-1055`
  - `{{3}}`: `Lift 3 Inverter Drive Fault`
  - `{{4}}`: `WorkSquare Hub 1`
  - `{{5}}`: `Otis Elevator India Pvt Ltd (Contact: 9876543210, Visit: Tomorrow 11 AM)`
  - `{{6}}`: `Alok Procurement`
  - `{{7}}` *(Button URL Ticket UUID)*: `d35372d1-bee2-403f-8578-00da66f16984`

---

## 5. Preventive Maintenance (PPM)

### Template 16: `reminder_ppm_v2`
- **Template Name:** `reminder_ppm_v2`
- **Category:** `UTILITY`
- **Language:** `English (en)`
- **Header:** `Text` &rarr; `Preventive Maintenance Reminder 🔧`
- **Body:**
```text
Hello {{1}},

This is a reminder for an upcoming Preventive Maintenance (PPM) schedule.

🔧 System: {{2}}
🏢 Property: {{3}}
📅 Scheduled Date: {{4}}
🏭 Assigned Vendor: {{5}}
📍 Location / Asset: {{6}}

Please ensure vendor coordination and site clearance prior to execution.
```
- **Footer:** `AutoPilot Maintenance`
- **Button Type:** `Quick Reply` &rarr; `View PPM Schedule`
- **Sample Values:**
  - `{{1}}`: `Deepak Admin`
  - `{{2}}`: `Quarterly Chiller Plant Servicing`
  - `{{3}}`: `WorkSquare Hub 1`
  - `{{4}}`: `21/08/2026`
  - `{{5}}`: `Carrier Aircon Services Ltd`
  - `{{6}}`: `Basement 2 Plant Room`


---

## 6. SOP Checklists & Site Inspections

### Template 16A: `checklist_started_v1`
- **Template Name:** `checklist_started_v1`
- **Category:** `UTILITY`
- **Language:** `English (en)`
- **Header:** `Text` &rarr; `Checklist Shift Started 📋`
- **Body:**
```text
Hello {{1}},

The scheduled checklist inspection for {{2}} at {{3}} has started (Shift Start: {{4}}).

Please conduct your inspection rounds, log mandatory parameters, and upload verification photos in the app.
```
- **Footer:** `AutoPilot Operations`
- **Button Type:** `Call to Action (Website URL)`
  - **Button Text:** `Open Checklist`
  - **URL Type:** `Static` &rarr; `https://fms-dev-saas-one.vercel.app/sop`
- **Sample Values:**
  - `{{1}}`: `Harsh Patil`
  - `{{2}}`: `Daily Morning MST Shift Inspection`
  - `{{3}}`: `Mafatlal Chambers`
  - `{{4}}`: `09:00 AM`

---

### Template 16B: `checklist_slot_reminder_v1`
- **Template Name:** `checklist_slot_reminder_v1`
- **Category:** `UTILITY`
- **Language:** `English (en)`
- **Header:** `Text` &rarr; `Checklist Slot Due Soon ⏰`
- **Body:**
```text
Hello {{1}},

This is a reminder that the checklist inspection for {{2}} at {{3}} is due at {{4}}.

Please complete and submit all required checklist items before the shift window closes.
```
- **Footer:** `AutoPilot Operations`
- **Button Type:** `Call to Action (Website URL)`
  - **Button Text:** `Complete Checklist`
  - **URL Type:** `Static` &rarr; `https://fms-dev-saas-one.vercel.app/sop`
- **Sample Values:**
  - `{{1}}`: `Harsh Patil`
  - `{{2}}`: `Daily Morning MST Shift Inspection`
  - `{{3}}`: `Mafatlal Chambers`
  - `{{4}}`: `01:00 PM`

---

### Template 16C: `checklist_completed_v1`
- **Template Name:** `checklist_completed_v1`
- **Category:** `UTILITY`
- **Language:** `English (en)`
- **Header:** `Text` &rarr; `Checklist Completed ✅`
- **Body:**
```text
Hello {{1}},

The checklist inspection for {{2}} at {{3}} has been completed.

👤 Completed By: {{4}}
⏰ Completion Time: {{5}}

The submission is now ready for supervisor audit and verification.
```
- **Footer:** `AutoPilot Operations`
- **Button Type:** `Call to Action (Website URL)`
  - **Button Text:** `Review Submission`
  - **URL Type:** `Static` &rarr; `https://fms-dev-saas-one.vercel.app/sop`
- **Sample Values:**
  - `{{1}}`: `Property Admin`
  - `{{2}}`: `Daily Morning MST Shift Inspection`
  - `{{3}}`: `Mafatlal Chambers`
  - `{{4}}`: `Ramesh MST`
  - `{{5}}`: `12:45 PM`

---

### Template 16D: `checklist_overdue_alert_v1`
- **Template Name:** `checklist_overdue_alert_v1`
- **Category:** `UTILITY`
- **Language:** `English (en)`
- **Header:** `Text` &rarr; `Checklist Overdue Alert ⚠️`
- **Body:**
```text
Hello {{1}},

The scheduled checklist inspection for {{2}} at {{3}} was NOT completed on time.

⏰ Scheduled Slot: {{4}}

Please review the missed checklist immediately and ensure compliance.
```
- **Footer:** `AutoPilot Operations`
- **Button Type:** `Call to Action (Website URL)`
  - **Button Text:** `View Escalation`
  - **URL Type:** `Static` &rarr; `https://fms-dev-saas-one.vercel.app/sop`
- **Sample Values:**
  - `{{1}}`: `Harsh Patil (Admin)`
  - `{{2}}`: `Daily Morning MST Shift Inspection`
  - `{{3}}`: `Mafatlal Chambers`
  - `{{4}}`: `21/08/2026, 01:00 PM`

---

### Template 16E: `checklist_rated_v1`
- **Template Name:** `checklist_rated_v1`
- **Category:** `UTILITY`
- **Language:** `English (en)`
- **Header:** `Text` &rarr; `Checklist Audited & Rated ⭐`
- **Body:**
```text
Hello {{1}},

Your checklist submission for {{2}} at {{3}} has been audited and rated.

⭐ Supervisor Rating: {{4}}
👤 Audited By: {{5}}

Keep up the great work in maintaining site standards!
```
- **Footer:** `AutoPilot Operations`
- **Button Type:** `Call to Action (Website URL)`
  - **Button Text:** `View Score`
  - **URL Type:** `Static` &rarr; `https://fms-dev-saas-one.vercel.app/sop`
- **Sample Values:**
  - `{{1}}`: `Ramesh MST`
  - `{{2}}`: `Daily Morning MST Shift Inspection`
  - `{{3}}`: `Mafatlal Chambers`
  - `{{4}}`: `3/3 (Excellent)`
  - `{{5}}`: `Harsh Patil (Supervisor)`

---

## 7. Meeting Room Reservations

### Template 17: `meeting_room_booked_v3`
- **Template Name:** `meeting_room_booked_v3`
- **Category:** `UTILITY`
- **Language:** `English (en)`
- **Header:** `Text` &rarr; `Meeting Room Booking Notice 📅`
- **Body:**
```text
Hello {{1}},

A meeting room reservation has been confirmed.

🚪 Room: {{2}}
🏢 Property: {{3}}
📅 Date: {{4}}
⏰ Time: {{5}} to {{6}}
👥 Booked By: {{7}} (📞 {{8}})

Please ensure facilities and refreshments are arranged if requested.
```
- **Footer:** `AutoPilot Hospitality`
- **Button Type:** `Quick Reply` &rarr; `View Bookings`
- **Sample Values:**
  - `{{1}}`: `Front Desk Team`
  - `{{2}}`: `Executive Boardroom (12 Pax)`
  - `{{3}}`: `WorkSquare Hub 1`
  - `{{4}}`: `19/08/2026`
  - `{{5}}`: `03:00 PM`
  - `{{6}}`: `04:30 PM`
  - `{{7}}`: `Pooja Verma (Design Co)`
  - `{{8}}`: `+91 98200 54321`

---

### Template 18: `meeting_room_cancelled_v2`
- **Template Name:** `meeting_room_cancelled_v2`
- **Category:** `UTILITY`
- **Language:** `English (en)`
- **Header:** `Text` &rarr; `Meeting Room Cancelled ❌`
- **Body:**
```text
Hello {{1}},

The following meeting room booking has been cancelled.

🚪 Room: {{2}}
🏢 Property: {{3}}
📅 Date: {{4}}
⏰ Time: {{5}} to {{6}}
👤 Cancelled By: {{7}}

The room is now released and available for booking.
```
- **Footer:** `AutoPilot Hospitality`
- **Button Type:** `Quick Reply` &rarr; `View Calendar`
- **Sample Values:**
  - `{{1}}`: `Front Desk Team`
  - `{{2}}`: `Executive Boardroom`
  - `{{3}}`: `WorkSquare Hub 1`
  - `{{4}}`: `19/08/2026`
  - `{{5}}`: `03:00 PM`
  - `{{6}}`: `04:30 PM`
  - `{{7}}`: `Pooja Verma`

---

## 7. CRM Sales Leads

### Template 19: `crm_lead_created_v1`
- **Template Name:** `crm_lead_created_v1`
- **Category:** `UTILITY`
- **Language:** `English (en)`
- **Header:** `Text` &rarr; `New Sales Lead 🎯`
- **Body:**
```text
Hello {{1}},

A new sales lead has been registered on AutoPilot CRM.

🏢 Company: {{2}}
👤 Contact Person: {{3}}
📞 Phone: {{4}}
🌐 Source: {{5}}
🏢 Property Interest: {{6}}

Please reach out to qualify the requirement.
```
- **Footer:** `AutoPilot CRM`
- **Button Type:** `Call to Action (Dynamic URL)`
  - **Button Text:** `View Lead`
  - **URL Type:** `Dynamic` &rarr; `https://fms-dev-saas-one.vercel.app/crm/leads/{{7}}`
- **Sample Values:**
  - `{{1}}`: `Sales Team`
  - `{{2}}`: `TechSolutions Pvt Ltd`
  - `{{3}}`: `Vikram Malhotra`
  - `{{4}}`: `+91 98200 12345`
  - `{{5}}`: `Website Enquiry`
  - `{{6}}`: `WorkSquare Hub 1`
  - `{{7}}` *(Button URL Lead UUID)*: `d35372d1-bee2-403f-8578-00da66f16984`

---

### Template 20: `crm_lead_assigned_v1`
- **Template Name:** `crm_lead_assigned_v1`
- **Category:** `UTILITY`
- **Language:** `English (en)`
- **Header:** `Text` &rarr; `Lead Assigned to You 💼`
- **Body:**
```text
Hello {{1}},

A sales lead has been assigned to you.

🏢 Company: {{2}}
👤 Contact Person: {{3}}
📞 Phone: {{4}}
🏢 Property Interest: {{5}}
📅 Next Follow-up: {{6}}

Please initiate contact and update CRM pipeline notes.
```
- **Footer:** `AutoPilot CRM`
- **Button Type:** `Call to Action (Dynamic URL)`
  - **Button Text:** `Open Lead`
  - **URL Type:** `Dynamic` &rarr; `https://fms-dev-saas-one.vercel.app/crm/leads/{{7}}`
- **Sample Values:**
  - `{{1}}`: `Rohan Sales`
  - `{{2}}`: `TechSolutions Pvt Ltd`
  - `{{3}}`: `Vikram Malhotra`
  - `{{4}}`: `+91 98200 12345`
  - `{{5}}`: `WorkSquare Hub 1`
  - `{{6}}`: `21/08/2026, 04:00 PM`
  - `{{7}}` *(Button URL Lead UUID)*: `d35372d1-bee2-403f-8578-00da66f16984`

---

## 8. FMS Welcome & Onboarding Broadcast

### Template 21: `fms_welcome_onboarding_v1`
*(Welcome and onboarding message sent from UI to all users, tenants, and staff introducing what the FMS system has and how to use it)*

- **Template Name:** `fms_welcome_onboarding_v1`
- **Category:** `UTILITY`
- **Language:** `English (en)`
- **Header:** `Text` &rarr; `Welcome to AutoPilot FMS 🏢`
- **Body:**
```text
Hello {{1}},

Welcome to AutoPilot FMS powered by AutoPilot Offices!

Your complete Facility Management System (FMS) is now active. Here is what you can do:

🎫 Service Tickets: Raise maintenance requests & track resolution live with instant SLA updates
📅 Meeting Rooms: Check live slot availability and reserve conference spaces instantly
📋 SOP Checklists: Complete daily site inspection checklists & quality audits
⚡ Utility Logs: Track and monitor electricity and energy meter consumption
📦 Material Requests: Request procurement and track delivery receipts seamlessly

Our on-site facility team is dedicated to providing you a hassle-free, world-class workplace experience.

Need support? Contact our site helpdesk at {{2}} for prompt assistance.
```
- **Footer:** `AutoPilot Facility Management`
- **Button Type:** `Call to Action (Website URL)`
  - **Button Text:** `Open FMS Portal`
  - **URL Type:** `Static` &rarr; `https://fms-dev-saas-one.vercel.app/dashboard`
- **Sample Values:**
  - `{{1}}`: `Rahul Sharma`
  - `{{2}}`: `contact.autopilotoffices@gmail.com`
