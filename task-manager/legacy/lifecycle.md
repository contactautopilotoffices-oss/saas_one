# Head Office Task Manager — Simplified Daily Lifecycle

A lightweight, zero-friction WhatsApp workflow for head-office employees across all 12 corporate departments.
Employees chat completely naturally—no complex commands or rigid syntax required:
1. **Enrollment:** Employee is added on the dashboard and instantly receives a WhatsApp welcome message.
2. **Morning:** Just message what they're working on (e.g. *"Today I will be working on project deployment"*).
3. **Evening:** State completion (e.g. *"Finished project deployment"*) and submit their daily recap.

---

```
  [ Employee Phone ]                     [ System Engine ]                    [ Superuser Dashboard ]
        │                                       │                                        │
        ├── 0. [Enrollment Trigger] <───────────┴────────────────────────────────────────┤ Admin clicks "Enroll Member"
        │<── Welcome WhatsApp Message ──────────┤                                        │
        │                                       │                                        │
        ├── 1. "today he will be working on     │ LLM extracts "Project deployment"      │
        │       project deployment" ───────────>│ Stores in DB (`tm_tasks`)              │
        │<── Bot: "✅ Added to tasks (Pending)" ──┼───────────────────────────────────────>│ Appears on Deliverables Board [Pending]
        │                                       │                                        │
        ├── 2. "finished project deployment" ──>│ LLM matches task & marks 'completed'  │
        │<── Bot: "🎉 Task Completed!" ─────────┼───────────────────────────────────────>│ Status changes to [Completed] ✅
        │                                       │                                        │
        ├── 3. "Wrapped up deployment & tested" >│ Stores in DB (`tm_daily_reports`)      │
        │<── Bot: "📝 Daily Report Logged" ─────┼───────────────────────────────────────>│ Drops off "Missing Radar",
        │                                       │                                        │ appears in Daily Reports Feed
```

---

### Step 0: Instant WhatsApp Welcome on Enrollment
When leadership or HR adds an employee in the Super Admin Cockpit:
* An automated WhatsApp message is instantly delivered to the employee's phone:
  ```text
  👋 Hi Rohan! Welcome to AutoPilot Task Manager for Tech.

  You can chat with me here naturally throughout your day—no special commands needed:
  • Morning: Just text what you'll be working on (e.g. "Today I will be working on project deployment")
  • Updates: Let me know when something is finished (e.g. "Finished project deployment")
  • Evening: Share your daily summary or recap
  • Text "tasks" anytime to see your active list.

  Have a productive day! 🚀
  ```

---

### Step 1: Morning — Log Deliverables Naturally
The employee sends whatever they are working on in natural language (1st person, 3rd person, or action note):

> **Employee:** `Today I will be working on project deployment`  
> *(or in 3rd person: "today he will be working on project deployment")*  
> *(or multiple items: "Working on project deployment and database migration")*

* **What the LLM & Bot do:**
  1. Identifies the employee by their phone number from `tm_members`.
  2. Uses LLM to extract clean, professional titles without conversational filler words (e.g. *"Project deployment"*).
  3. Tags the deliverable to their department (*e.g., Tech*).
  4. Inserts row(s) into `tm_tasks` with `status: pending`.
* **WhatsApp Reply to Employee:**
  ```text
  ✅ Task Added to Your Day!

  📋 Task: Project deployment
  🏢 Department: Tech
  Status: 📋 Pending

  _When completed, simply message "Finished Project deployment" or "done"._
  ```
* **What happens on the Dashboard:**
  The task appears immediately on the **Deliverables Board** under the **Tech** department with a clean **Pending** badge.

---

### Step 2: Evening — Give Completion Status
When finishing work for the day, the employee simply marks what was finished:

> **Employee:** `done #1`  
> *(or conversationally: "Finished task 1" / "I completed the cloud migration architecture")*

* **What the Bot does:**
  1. Updates `tm_tasks` for Task #1: `status = completed`, `completed_at = NOW()`.
* **WhatsApp Reply to Employee:**
  ```text
  🎉 Task Completed!

  📋 Task: Finalize cloud migration architecture
  Status: ✅ Completed

  _Reply "tasks" to view your remaining tasks for today._
  ```
* **What happens on the Dashboard:**
  The task status flips to **Completed ✅**, and the **"Completed Today"** counter on top of the dashboard increments by +1.

---

### Step 3: Evening (6:00 PM) — End-of-Day (EOD) Daily Report
Before logging off, the employee shares their daily summary:

> **Employee:** `daily report: Finalized cloud architecture specs, resolved 2 blocker PRs, and onboarded new backend engineer.`

* **What the Bot does:**
  1. Saves the daily report to `tm_daily_reports` tagged to today's date in Indian Standard Time (`Asia/Kolkata`).
  2. Acknowledges the employee.
* **WhatsApp Reply to Employee:**
  ```text
  📝 Daily Work Report Submitted!
  📅 Date: 2 Oct 2026
  👤 Employee: Sahil Gorde
  📋 Summary: Finalized cloud architecture specs, resolved 2 blocker PRs, and onboarded new backend engineer.

  Your report has been logged and shared with management. Great work today!
  ```
* **What happens on the Dashboard:**
  1. The employee's name **disappears from the "Missing Today's EOD" radar**.
  2. Their summary instantly appears in the **Daily Reports Feed**.
  3. If they wrote any blocker notes, it highlights in red so management can act on it tomorrow morning.

---

### Step 4: Accountability (If an Employee Forgets)
If an employee forgets to submit their daily report by 6:30 PM:
1. **Automated Cron / 1-Click Dashboard Nudge:**  
   The system identifies anyone who has not logged a report today and fires a polite WhatsApp reminder:
   ```text
   ⏰ Evening Check-in: Daily Work Report
   Hi Rohan! Please remember to share your work summary for today.
   👉 Simply reply: daily report: <summary of what you accomplished today>
   ```
2. Or the Superuser opens the dashboard, looks at the **Missing Today's EOD Radar**, and clicks **"Nudge All (WhatsApp)"**.

---

### Step 5: Night — Co-Founder / Leadership Oversight
The co-founder can review company-wide output in two ways:

* **Way A (Web Cockpit):**
  Open the Super Admin Console → click **Task Manager**. Filter by department (*Tech, BD, Operations*) to see completed deliverables, pending tasks, and read everyone's daily reports.
* **Way B (On WhatsApp directly):**
  While on the go, the co-founder can simply text the bot:
  * *"What did Tech work on today?"* → Bot replies with Tech's completed tasks, pending tasks, and EOD report summaries.
  * *"Who hasn't submitted their daily report today?"* → Bot replies with a list of missing employees.
  * At 8:00 PM, the co-founder automatically receives the **Executive Evening Rollup** WhatsApp message summarizing the entire company's daily output.