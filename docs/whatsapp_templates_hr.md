# HR Helpdesk & Grievances - WhatsApp (Meta / AiSensy) & Email Templates Specification

This document contains the official **Meta WhatsApp Business Manager / AiSensy** submission specifications and clean **HTML Email Templates** for the SaaS One HR Helpdesk, Workplace Grievance, SLA Escalation, and Ticket Acknowledgment Module.

---

## 1. WhatsApp Meta / AiSensy Template Specifications

Submit these exact template specifications to **Meta WhatsApp Business Manager / AiSensy** for approval.

### Template 1: Ticket Submitted (To Submitter)
* **Template Name**: `hr_ticket_created_submitter`
* **Category**: UTILITY
* **Language**: `en`
* **Header**: None (or Text: `HR Portal Update`)
* **Body Text**:
  ```text
  Hello {{1}},
  Your HR ticket *{{2}}* ({{3}}) has been successfully created on {{4}}.
  It has been assigned to *{{5}}* for review.
  You can view and track your ticket progress in the app portal.
  ```
* **Parameters Mapping**:
  * `{{1}}`: Submitter Name (e.g. *Rahul Sharma* or *Anonymous Employee*)
  * `{{2}}`: Ticket Number (e.g. *HR-GRV-2026-0042*)
  * `{{3}}`: Category Name (e.g. *Grievance* or *Confidential Feedback*)
  * `{{4}}`: Created Date (`DD/MM/YYYY`)
  * `{{5}}`: Assigned Handler Name (e.g. *Anita Verma (HR Ops)*)

---

### Template 2: New Ticket Assignment (To Assigned Manager / Handler)
* **Template Name**: `hr_ticket_assigned_handler`
* **Category**: UTILITY
* **Language**: `en`
* **Header**: None
* **Body Text**:
  ```text
  Hello {{1}},
  A new HR {{2}} ticket *{{3}}* has been assigned to you for review.
  Submitted By: {{4}}
  Subject: {{5}}
  Created On: {{6}}
  Please review and resolve within the assigned SLA window.
  ```
* **Parameters Mapping**:
  * `{{1}}`: Handler Name (e.g. *Vikram Mehta*)
  * `{{2}}`: Category Type (e.g. *Grievance*, *HR Query*)
  * `{{3}}`: Ticket Number (e.g. *HR-GRV-2026-0042*)
  * `{{4}}`: Submitter Name / Masked Name
  * `{{5}}`: Ticket Subject (e.g. *Payroll discrepancy for August*)
  * `{{6}}`: Date formatted `DD/MM/YYYY`

---

### Template 3: Escalation Notification (To Higher Level Authority)
* **Template Name**: `hr_ticket_escalated_handler`
* **Category**: UTILITY
* **Language**: `en`
* **Header**: None
* **Body Text**:
  ```text
  Attention {{1}},
  HR Ticket *{{2}}* has been escalated to Level {{3}} under your authority {{4}}.
  Category: {{5}}
  Subject: {{6}}
  Previous Level: Level {{7}}
  Please inspect the ticket details in your dashboard.
  ```
* **Parameters Mapping**:
  * `{{1}}`: Higher Authority Name (e.g. *Priya Nair (HR Head)*)
  * `{{2}}`: Ticket Number (e.g. *HR-GRV-2026-0042*)
  * `{{3}}`: Target Level Number (e.g. *3*)
  * `{{4}}`: Escalation Reason (e.g. *due to SLA timeout or by handler transfer*)
  * `{{5}}`: Category Name
  * `{{6}}`: Subject Snippet
  * `{{7}}`: Previous Level Number (e.g. *2*)

---

### Template 4: Ticket Status Update (To Submitter)
* **Template Name**: `hr_ticket_status_updated`
* **Category**: UTILITY
* **Language**: `en`
* **Header**: None
* **Body Text**:
  ```text
  Hello {{1}},
  The status of your HR ticket *{{2}}* has been updated to *{{3}}*.
  Updated On: {{4}}
  Updated By: {{5}}
  Check your HR dashboard for resolution notes and details.
  ```
* **Parameters Mapping**:
  * `{{1}}`: Submitter Name
  * `{{2}}`: Ticket Number
  * `{{3}}`: New Status (*In Progress*, *Resolved*, *Closed*, *Reopened*)
  * `{{4}}`: Date (`DD/MM/YYYY`)
  * `{{5}}`: Handler / System Name

---

### Template 5: New Reply / Public Comment Added
* **Template Name**: `hr_ticket_comment_added`
* **Category**: UTILITY
* **Language**: `en`
* **Header**: None
* **Body Text**:
  ```text
  Hello {{1}},
  A new reply was posted on HR ticket *{{2}}* by *{{3}}*:
  "{{4}}"
  Updated On: {{5}}
  ```
* **Parameters Mapping**:
  * `{{1}}`: Recipient Name
  * `{{2}}`: Ticket Number
  * `{{3}}`: Commenter Name
  * `{{4}}`: Comment Snippet (First 100 chars)
  * `{{5}}`: Date (`DD/MM/YYYY`)

---

### Template 6: Ticket Resolved & Acknowledgment Required (To Submitter)
* **Template Name**: `hr_ticket_resolved_ack`
* **Category**: UTILITY
* **Language**: `en`
* **Header**: None
* **Body Text**:
  ```text
  Hello {{1}},
  Your HR ticket *{{2}}* has been marked as RESOLVED by *{{3}}*.
  Resolution Note: "{{4}}"
  Resolved On: {{5}}
  Please open your HR portal and click "Acknowledge & Close Ticket" to confirm resolution.
  ```
* **Parameters Mapping**:
  * `{{1}}`: Submitter Name
  * `{{2}}`: Ticket Number
  * `{{3}}`: Resolver Name / HR Handler
  * `{{4}}`: Resolution Note Snippet
  * `{{5}}`: Date (`DD/MM/YYYY`)

---

### Template 7: Ticket Acknowledged & Closed (To Handler / HR Admin)
* **Template Name**: `hr_ticket_acknowledged_closed`
* **Category**: UTILITY
* **Language**: `en`
* **Header**: None
* **Body Text**:
  ```text
  Hello {{1}},
  The submitter *{{2}}* has acknowledged and officially CLOSED HR ticket *{{3}}*.
  Subject: {{4}}
  Closed On: {{5}}
  No further action is required.
  ```
* **Parameters Mapping**:
  * `{{1}}`: Handler / HR Admin Name
  * `{{2}}`: Submitter Name
  * `{{3}}`: Ticket Number
  * `{{4}}`: Subject
  * `{{5}}`: Date (`DD/MM/YYYY`)

---

### Template 8: Department Reportee Alert (To Reporting Manager)
* **Template Name**: `hr_ticket_reportee_alert`
* **Category**: UTILITY
* **Language**: `en`
* **Header**: None
* **Body Text**:
  ```text
  Hello {{1}},
  A new HR ticket *{{2}}* has been assigned to your direct reportee *{{3}}*.
  Subject: {{4}}
  Category: {{5}}
  Date: {{6}}
  This alert is for department oversight. You can review all reportee tickets in your Department Tree tab.
  ```
* **Parameters Mapping**:
  * `{{1}}`: Reporting Manager Name
  * `{{2}}`: Ticket Number
  * `{{3}}`: Reportee Name
  * `{{4}}`: Subject
  * `{{5}}`: Category Name
  * `{{6}}`: Date (`DD/MM/YYYY`)

---

### Template 9: SLA Expiration Warning (To Active Handler)
* **Template Name**: `hr_ticket_sla_warning`
* **Category**: UTILITY
* **Language**: `en`
* **Header**: None
* **Body Text**:
  ```text
  Attention {{1}},
  SLA Warning: HR ticket *{{2}}* assigned to you will reach SLA expiration in {{3}}.
  Subject: {{4}}
  Target SLA Deadline: {{5}}
  Please update or resolve this ticket to avoid automatic level escalation.
  ```
* **Parameters Mapping**:
  * `{{1}}`: Handler Name
  * `{{2}}`: Ticket Number
  * `{{3}}`: Time Remaining (e.g. *2 hours*)
  * `{{4}}`: Subject Snippet
  * `{{5}}`: Target SLA Deadline (`DD/MM/YYYY, hh:mm A`)

---

## 2. HTML Email Templates

Below are clean, responsive HTML email templates for all notification triggers.

### 1. Ticket Creation & Assignment Email
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f4f6f8; margin: 0; padding: 20px; }
    .card { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; padding: 24px; }
    .header { border-bottom: 2px solid #2563eb; padding-bottom: 12px; margin-bottom: 20px; }
    .title { color: #1e293b; font-size: 20px; font-weight: 700; margin: 0; }
    .subtitle { color: #64748b; font-size: 14px; margin-top: 4px; }
    .field { margin-bottom: 12px; font-size: 14px; line-height: 1.5; color: #334155; }
    .label { font-weight: 600; color: #475569; width: 140px; display: inline-block; }
    .badge { background: #eff6ff; color: #1d4ed8; padding: 4px 8px; border-radius: 4px; font-weight: 600; font-size: 13px; }
    .footer { margin-top: 24px; font-size: 12px; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h2 class="title">HR Portal: New Ticket {{ticket_number}}</h2>
      <div class="subtitle">Category: {{category_name}}</div>
    </div>
    <div class="field"><span class="label">Ticket Number:</span> <strong>{{ticket_number}}</strong></div>
    <div class="field"><span class="label">Submitted By:</span> {{submitter_name}}</div>
    <div class="field"><span class="label">Subject:</span> {{subject}}</div>
    <div class="field"><span class="label">Assigned To:</span> <span class="badge">{{assigned_name}}</span></div>
    <div class="field"><span class="label">Date:</span> {{formatted_date}}</div>
    <p style="color: #475569; font-size: 14px; margin-top: 16px;">
      {{message_body}}
    </p>
    <div class="footer">
      Automated notification from SaaS One HR Operations Module. Please do not reply directly to this email.
    </div>
  </div>
</body>
</html>
```

### 2. Escalation Notification Email
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #fff5f5; margin: 0; padding: 20px; }
    .card { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 8px; border: 1px solid #fecaca; padding: 24px; }
    .header { border-bottom: 2px solid #dc2626; padding-bottom: 12px; margin-bottom: 20px; }
    .title { color: #991b1b; font-size: 20px; font-weight: 700; margin: 0; }
    .badge { background: #fee2e2; color: #991b1b; padding: 4px 8px; border-radius: 4px; font-weight: 600; font-size: 13px; }
    .footer { margin-top: 24px; font-size: 12px; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h2 class="title">⚠️ Escalation: Ticket {{ticket_number}} (Level {{target_level}})</h2>
    </div>
    <p style="font-size: 15px; color: #1e293b;">
      Ticket <strong>{{ticket_number}}</strong> has escalated from Level {{from_level}} to <strong>Level {{target_level}}</strong> {{escalation_reason}}.
    </p>
    <div style="background: #f8fafc; padding: 12px; border-radius: 6px; margin: 16px 0;">
      <div><strong>Subject:</strong> {{subject}}</div>
      <div><strong>New Assignee:</strong> <span class="badge">{{assignee_name}}</span></div>
      <div><strong>Date Escalated:</strong> {{formatted_date}}</div>
    </div>
    <div class="footer">
      Automated notification from SaaS One HR Escalation Engine.
    </div>
  </div>
</body>
</html>
```

### 3. Ticket Status Update Email
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f8fafc; margin: 0; padding: 20px; }
    .card { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; padding: 24px; }
    .header { border-bottom: 2px solid #0284c7; padding-bottom: 12px; margin-bottom: 20px; }
    .title { color: #0369a1; font-size: 20px; font-weight: 700; margin: 0; }
    .badge { background: #e0f2fe; color: #0369a1; padding: 4px 8px; border-radius: 4px; font-weight: 600; font-size: 13px; }
    .footer { margin-top: 24px; font-size: 12px; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h2 class="title">HR Ticket Status Update: {{ticket_number}}</h2>
    </div>
    <p style="font-size: 15px; color: #1e293b;">
      Hello {{submitter_name}}, the status of your HR ticket <strong>{{ticket_number}}</strong> has been updated to <span class="badge">{{new_status}}</span> by {{updated_by}}.
    </p>
    <div style="background: #f1f5f9; padding: 12px; border-radius: 6px; margin: 16px 0; font-size: 14px;">
      <div><strong>Subject:</strong> {{subject}}</div>
      <div><strong>Updated On:</strong> {{formatted_date}}</div>
    </div>
    <div class="footer">
      SaaS One HR Operations Module
    </div>
  </div>
</body>
</html>
```

### 4. Ticket Comment Added Email
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f8fafc; margin: 0; padding: 20px; }
    .card { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 8px; border: 1px solid #cbd5e1; padding: 24px; }
    .header { border-bottom: 2px solid #4f46e5; padding-bottom: 12px; margin-bottom: 20px; }
    .title { color: #3730a3; font-size: 20px; font-weight: 700; margin: 0; }
    .quote { background: #f1f5f9; border-left: 4px solid #4f46e5; padding: 12px 16px; font-style: italic; color: #334155; margin: 16px 0; }
    .footer { margin-top: 24px; font-size: 12px; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h2 class="title">New Reply on Ticket {{ticket_number}}</h2>
    </div>
    <p style="font-size: 14px; color: #1e293b;">
      Hello {{recipient_name}}, <strong>{{commenter_name}}</strong> posted a new reply on ticket <strong>{{ticket_number}}</strong>:
    </p>
    <div class="quote">
      "{{comment_body}}"
    </div>
    <div class="footer">
      SaaS One HR Operations Module
    </div>
  </div>
</body>
</html>
```

### 5. Ticket Acknowledged & Closed Email
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f0fdf4; margin: 0; padding: 20px; }
    .card { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 8px; border: 1px solid #bbf7d0; padding: 24px; }
    .header { border-bottom: 2px solid #16a34a; padding-bottom: 12px; margin-bottom: 20px; }
    .title { color: #15803d; font-size: 20px; font-weight: 700; margin: 0; }
    .badge { background: #dcfce7; color: #15803d; padding: 4px 8px; border-radius: 4px; font-weight: 600; font-size: 13px; }
    .footer { margin-top: 24px; font-size: 12px; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h2 class="title">🎉 Ticket Acknowledged & Closed: {{ticket_number}}</h2>
    </div>
    <p style="font-size: 15px; color: #1e293b;">
      Hello {{handler_name}}, the submitter <strong>{{submitter_name}}</strong> has reviewed the resolution and officially <span class="badge">CLOSED</span> ticket <strong>{{ticket_number}}</strong>.
    </p>
    <div style="background: #f8fafc; padding: 12px; border-radius: 6px; margin: 16px 0; font-size: 14px;">
      <div><strong>Subject:</strong> {{subject}}</div>
      <div><strong>Closed On:</strong> {{formatted_date}}</div>
    </div>
    <div class="footer">
      SaaS One HR Operations Module
    </div>
  </div>
</body>
</html>
```

### 6. Department Reportee Alert Email
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #faf5ff; margin: 0; padding: 20px; }
    .card { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 8px; border: 1px solid #e9d5ff; padding: 24px; }
    .header { border-bottom: 2px solid #9333ea; padding-bottom: 12px; margin-bottom: 20px; }
    .title { color: #7e22ce; font-size: 20px; font-weight: 700; margin: 0; }
    .footer { margin-top: 24px; font-size: 12px; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h2 class="title">📌 Department Alert: Ticket Assigned to {{reportee_name}}</h2>
    </div>
    <p style="font-size: 14px; color: #1e293b;">
      Hello {{manager_name}}, HR ticket <strong>{{ticket_number}}</strong> has been assigned to your direct reportee <strong>{{reportee_name}}</strong>.
    </p>
    <div style="background: #f8fafc; padding: 12px; border-radius: 6px; margin: 16px 0; font-size: 14px;">
      <div><strong>Subject:</strong> {{subject}}</div>
      <div><strong>Category:</strong> {{category_name}}</div>
      <div><strong>Assigned Date:</strong> {{formatted_date}}</div>
    </div>
    <div class="footer">
      This automated alert provides department visibility. You can monitor team progress in your Department Tree tab.
    </div>
  </div>
</body>
</html>
```

---

## 3. Omnichannel UI & Trigger Integration

All templates above are fully wired into the **Omnichannel Notification Matrix** UI (`frontend/components/admin/OmnichannelNotificationSettings.tsx`) and the **WhatsApp/Email Event Processor** (`backend/services/WhatsAppEventProcessor.ts`).

Admins can manage channel toggles (WhatsApp, Email, Push), role routing, and template overrides directly from the **Omnichannel Settings Panel**.
