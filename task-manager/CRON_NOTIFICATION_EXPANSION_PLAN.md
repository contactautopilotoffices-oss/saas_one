# Task Manager Cron Notifications — Expansion Plan & Technical Analysis

This document analyzes the proposed multi-rule cron notification architecture against the actual tech stack, database schema, Meta WhatsApp API constraints, and Vercel infrastructure of `saas_one`.

---

## 1. Executive Summary & Stack Reality Check

ChatGPT provided a solid feature wishlist, but assumed an unconstrained environment. In our actual production architecture, we operate under three critical technical realities:

| Real-World Constraint | What ChatGPT Assumed | How Our Project Actually Works |
| :--- | :--- | :--- |
| **Meta WhatsApp 24h Window** | "Create freeform custom templates dynamically in the dashboard and send anytime." | **WhatsApp Cloud API / AiSensy enforces strict rules**: Outbound messages sent to employees who haven't messaged within 24 hours **MUST use pre-approved Meta Templates**. Freeform text only works if the employee replied recently. Arbitrary templates created on a web dashboard cannot be delivered without Meta approval in Meta Business Suite. |
| **Vercel Cron Infrastructure** | "Create independent cron schedules for every rule (e.g., 9:00 AM, 2:00 PM, 6:30 PM, every 2 hours)." | **Vercel Cron runs on fixed schedules in `vercel.json`** (`*/15 * * * *`). You cannot dynamically create cron jobs at runtime on Vercel. We must use a **Central Heartbeat Engine**: Vercel triggers `/api/cron/task-manager?action=auto` on a cadence, and our code checks which rules match the current IST time. |
| **Database Schema (`task_assignments`)** | "Filter by priority, project, category, tags." | In our actual Supabase database, `task_assignments` only has: `id`, `title`, `description`, `employee_id`, `assigned_date`, `status` (`pending` \| `in_progress` \| `completed`), and `task_template_id`. **There are currently NO `priority`, `project`, or `category` columns**. Filtering by those requires either a database migration or must be deferred. |
| **WhatsApp Number Health** | "Remind employees every 2 hours until finished." | Spamming employees every 2 hours on WhatsApp leads to employees blocking the business number or reporting it as spam. Meta penalizes your WhatsApp Quality Rating, resulting in account suspension. **Maximum 2–3 structured touchpoints per day is the recommended enterprise limit.** |

---

## 2. Detailed Feasibility Scorecard (Item-by-Item)

| # | Feature Proposed by ChatGPT | Feasibility | Technical Assessment & Project Adaptation |
| :- | :--- | :---: | :--- |
| **1** | **Multiple Notification Schedules** | ✅ **100% Feasible** | Replace the single `cronTiming` string with an array of `NotificationRule[]`. The 15-minute Vercel heartbeat evaluates which rules are due. |
| **2** | **Task Selection Rules** | ⚠️ **85% Feasible** | **Supported**: Today's tasks, pending from yesterday, pending from last X days, fixed vs manual tasks, overdue tasks, completed tasks.<br>**Requires Migration**: Priority, project, and category filters (since columns don't exist yet on `task_assignments`). |
| **3** | **Carry-Forward Controls** | ✅ **100% Feasible** | Query tasks where `assigned_date < today` and `status != 'completed'`. Recommended implementation: **Include in the notification digest without cloning DB rows** (avoids database clutter and duplicate task IDs). |
| **4** | **Notification Types** | ✅ **100% Feasible** | Pre-configure 4 core templates in code:<br>1. *Morning Digest* (Kickoff)<br>2. *Midday Pending Reminder*<br>3. *Overdue Alert*<br>4. *Evening Wrap-up / Completion Summary*. |
| **5** | **Custom Template Management** | ⚠️ **Adapted** | We can allow custom text formatting **within active 24h WhatsApp sessions**. For cold outbound alerts outside the 24h window, it must use parameter substitution into approved AiSensy/Meta templates (e.g. `{{1}} = Name`, `{{2}} = TaskList`). |
| **6** | **Recipient Controls & Whitelist** | ✅ **100% Feasible** | Can target: All Tech staff, specific employees, reporting managers, or the Testing Whitelist (Sahil Gorde). |
| **7** | **Conditional Rules** | ✅ **100% Feasible** | "Only send if pending tasks > 0", "Skip if 0 tasks", "Only send if overdue exists". Trivial to implement and prevents spam. |
| **8** | **Repeat / 2-Hour Reminders** | ⚠️ **Modified** | Do **not** do uncontrolled 2-hour loops. Support at most **1 midday reminder** and **1 evening wrap-up** to protect WhatsApp sender reputation. |
| **9** | **Per-Rule Deduplication** | ✅ **100% Feasible** | Store `lastRunDate` and `lastRunSummary` **per rule** instead of a single global date. This allows Morning (9:00 AM) and Evening (6:30 PM) to run on the same day without colliding. |
| **10** | **Notification History Log** | ✅ **100% Feasible** | Query existing `task_audit_logs` table (filtered by `event_type = 'whatsapp_sent'`) and show a dedicated History audit feed in the UI. |
| **11** | **Manual Controls (Dry-run / Instant)** | ✅ **100% Feasible** | Add a "Run Now", "Dry-Run", and "Reset Today" button for each individual rule card in the Testing Dashboard. |
| **12** | **Dashboard Rules UI** | ✅ **100% Feasible** | Evolve the "Schedule Settings" card in `TaskManagerTestingDashboard.tsx` into a **Notification Rules Engine** tab. |
| **13** | **Extra Controls (Days of Week, Quiet Hours)**| ✅ **100% Feasible** | Add `daysOfWeek: [1, 2, 3, 4, 5, 6]` (e.g. Mon–Sat, skip Sunday) and IST operational windows (08:00–20:00). |

---

## 3. Recommended Architecture for `saas_one`

### A. Central Heartbeat Workflow

```mermaid
flowchart TD
    A[Vercel Cron Trigger<br>*/15 * * * *] --> B[/api/cron/task-manager?action=auto]
    B --> C{Master Automation Toggle ON?}
    C -- No --> D[Skip: Paused]
    C -- Yes --> E[Fetch Active Notification Rules from DB]
    E --> F[Loop Over Each Rule]
    F --> G{Rule Enabled & Active Today?}
    G -- No --> H[Skip Rule]
    G -- Yes --> I{Already Run Today?<br>rule.lastRunDate == todayIST}
    I -- Yes --> H
    I -- No --> J{Current Time >= Target Time?}
    J -- No --> H
    J -- Yes --> K[Execute Rule Pipeline]
    K --> L[1. Query Filtered Tasks<br>Today + Carry-Forward]
    L --> M{Match Conditions Met?<br>e.g. pending > 0}
    M -- No --> N[Skip: No matching tasks]
    M -- Yes --> O[2. Format Message<br>Digest / Reminder / EOD]
    O --> P[3. Dispatch via TaskMessagingService<br>AiSensy / Whitelist filter]
    P --> Q[4. Stamp rule.lastRunDate & Summary]
    Q --> R[5. Log to task_audit_logs]
```

---

## 4. Proposed Data Model (`NotificationRule`)

Instead of altering database tables immediately, we can extend the existing `context_data` inside `conversation_context` (`phone_number = 'TEST_CONFIG'`), making it 100% backward compatible without database migration risks:

```typescript
export type NotificationRuleType = 
    | 'morning_digest'       // 09:00 AM: Tasks for today + optional yesterday carry-forward
    | 'pending_reminder'     // 14:00 PM: Midday reminder for unfinished tasks
    | 'overdue_alert'        // Escalation for tasks past due date
    | 'eod_summary';         // 18:30 PM: Daily completion recap & outstanding items

export interface NotificationRule {
    id: string;                     // e.g. "rule_morning_digest"
    name: string;                   // "Morning Task Kickoff"
    enabled: boolean;               // Master toggle for this specific rule
    targetTimeIST: string;          // "09:00", "14:30", "18:30"
    daysOfWeek: number[];           // [1, 2, 3, 4, 5, 6] (1=Mon ... 6=Sat, 0=Sun)
    ruleType: NotificationRuleType;
    
    // Task Selection Filters
    taskFilters: {
        includeTodayFixed: boolean;
        includeTodayAssigned: boolean;
        includeYesterdayPending: boolean;
        lookbackDays: number;       // 1 = yesterday only, 3 = last 3 days
        onlyPending: boolean;       // Ignore completed
    };

    // Conditions
    conditions: {
        skipIfZeroTasks: boolean;   // Don't message if 0 tasks match
        requirePendingOnly: boolean;// Don't message if user already completed all tasks
    };

    // Recipients
    recipients: {
        target: 'whitelist' | 'tech_all' | 'specific_employees';
        employeeIds?: string[];
        notifyReportingManager: boolean;
    };

    // Run State Tracking (Deduplication)
    lastRunDate?: string | null;    // "2026-10-05"
    lastRunSummary?: string | null; // "Sent 3 digests (0 skipped)"
}
```

---

## 5. Phased Implementation Roadmap

### Phase 1: Core Multi-Rule Engine (Backend)
- [ ] Update `TestingConfig` in `task-manager/types.ts` to include `rules: NotificationRule[]`.
- [ ] Migrate existing single schedule (`cronTiming: "09:00"`) to a default `Morning Digest` rule.
- [ ] Refactor `app/api/cron/task-manager/route.ts` to loop over all enabled rules rather than evaluating a single hardcoded time.
- [ ] Add per-rule deduplication (`rule.lastRunDate`).

### Phase 2: Task Filter & Carry-Forward Engine
- [ ] Enhance `TaskNotificationService.ts` to accept `taskFilters`:
  - Fetch today's tasks (`assigned_date = today`).
  - Fetch yesterday's uncompleted tasks (`assigned_date >= (today - lookbackDays) AND status != 'completed'`).
- [ ] Format different message types:
  - **Morning Digest**: Numbered list + quick reply guide (`done 1`, `done all`).
  - **Midday Reminder**: Friendly check-in on remaining items (`⏳ 2 of 4 tasks pending`).
  - **EOD Summary**: Daily accomplishment tally + carried-forward items.

### Phase 3: Dashboard Management UI
- [ ] In `TaskManagerTestingDashboard.tsx`, replace the single schedule input with a **Notification Rules List**.
- [ ] Each rule card displays:
  - Rule name & badge (Morning, Reminder, EOD).
  - Target IST time & active weekdays.
  - Per-rule toggle (Enable/Disable).
  - Status badge: `✅ Dispatched (Today)` or `⏳ Pending for [Time] IST`.
  - Action buttons: **⚡ Run Now**, **🛡️ Dry-Run**, and **🔄 Reset Today's Run**.
- [ ] Modal or inline form to Add / Edit a notification rule.

### Phase 4: History & Audit Log Tab
- [ ] Connect `task_audit_logs` where `event_type = 'whatsapp_sent'`.
- [ ] Display the last 20 notification dispatches with employee name, message type, time, and status.

---

## 6. What NOT to Build (Avoid Traps)

1. ❌ **Do NOT build a dynamic "Custom Meta Template Creator"**:
   Meta does not allow dynamic unapproved outbound templates outside 24h. Use structured code-level parameter templates.
2. ❌ **Do NOT set up a 2-hour repeating cron loop**:
   Excessive messages trigger spam complaints and risk getting the AiSensy number blocked by Meta.
3. ❌ **Do NOT create separate Vercel cron endpoints for each rule**:
   Vercel cron is static; stick to the single central heartbeat (`/api/cron/task-manager?action=auto`) that evaluates multiple rules.
