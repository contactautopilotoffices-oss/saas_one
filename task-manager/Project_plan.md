# WhatsApp Employee Task Manager

## Phased Implementation Plan for Antigravity

## Project Goal

Build a WhatsApp-based employee task management system using the existing:

* Next.js + TypeScript
* Supabase/PostgreSQL
* AiSensy
* Existing AiSensy webhook
* Existing Facility Bot on the same WhatsApp number

The system must allow:

* Employees to receive daily tasks through WhatsApp.
* Employees to complete individual tasks or all tasks through WhatsApp.
* Supabase to remain the source of truth for task status.
* Reporting Managers to assign tasks only to employees in their own department.
* Superusers to assign tasks across the entire organisation.
* Managers and Superusers to monitor progress through a dashboard.
* Employee → Department → Organisation progress to be shown as a 3-level hierarchy.
* Superusers to ask natural-language questions about company/task status through WhatsApp.
* The existing Facility Bot to continue working without routing conflicts.

---

# IMPORTANT DEVELOPMENT RULE

Implement this project **phase by phase**.

Do NOT build everything in one pass.

After completing each phase:

1. Run TypeScript checks.
2. Run the application.
3. Test the relevant functionality.
4. Verify the Supabase records.
5. Verify WhatsApp behaviour where applicable.
6. Stop and report what was implemented.
7. Wait for approval before starting the next phase.

Do not rewrite unrelated existing code.

Do not break the existing Facility Bot.

---

# PHASE 0 — Inspect the Existing Project

Before writing new code, inspect the existing application.

Find:

* Current Next.js structure.
* Current Supabase client/server setup.
* Existing employee/user tables.
* Existing department data.
* Existing authentication and roles.
* Existing AiSensy webhook.
* Existing custom WhatsApp reply functionality.
* Existing Facility Bot state/session logic.
* Existing dashboard components.
* Existing environment variables.
* Existing scheduled jobs/cron infrastructure.

Create a short internal implementation summary:

```text
Existing relevant files:
- ...
- ...
- ...

Existing database tables:
- ...
- ...

Existing AiSensy integration:
- ...

Existing Facility Bot state:
- ...
```

Reuse existing code wherever possible.

Do not create duplicate utilities if equivalent functionality already exists.

---

# PHASE 1 — Database Foundation

Create or adapt the database structure required for the Task Manager.

Reuse existing tables where possible.

## Departments

Required departments:

* Operations
* Procurement
* Tech
* Business Development & Growth
* Human Resources
* Accounts
* Legal
* Design

## Employees / Users

Each employee should have:

* id
* name
* phone_number
* department_id
* role
* reporting_manager_id
* active
* created_at

Roles:

```text
employee
reporting_manager
superuser
```

`reporting_manager_id` identifies the reporting manager responsible for that employee.

A reporting manager may belong to a department and manage employees in that department.

---

## Task Templates

Create a concept for reusable/fixed tasks.

Example:

```text
Clean Room 101
Clean Room 102
Submit daily procurement report
Check FMS tickets
```

A task template should contain:

* id
* title
* description
* department_id if applicable
* created_by
* task_type
* created_at

Task types:

```text
fixed
assigned
```

---

## Task Assignments

This is the most important task table.

Each assignment represents an actual task assigned to an employee for a particular date.

Fields:

* id
* task_template_id or task_id
* employee_id
* assigned_date
* status
* assigned_by
* completed_at
* created_at
* updated_at

Statuses:

```text
pending
in_progress
completed
```

Example:

```text
Employee: Rahul
Date: 2026-10-03
Task: Clean Room 101
Status: completed
```

Do not store only a generic task status.

The assignment must belong to a specific employee and date.

---

# PHASE 2 — Role and Permission System

Implement backend permission checks.

## Employee

Can:

* Read their own tasks.
* Complete their own tasks.
* See their own progress.

## Reporting Manager

Can:

* Do everything an employee can do.
* Create tasks.
* Assign tasks to employees in their own department.
* View employees in their own department.
* View department progress.

Cannot:

* Assign tasks to another department.
* Modify another department's tasks.

## Superuser

Can:

* View all departments.
* View all employees.
* Create tasks.
* Assign tasks to any employee.
* View organisation progress.
* Query organisation-wide task data.

IMPORTANT:

Do not enforce these restrictions only in the frontend.

Every protected operation must be checked in the backend/server.

---

# PHASE 3 — Basic Task Assignment Dashboard

Build the first working dashboard functionality.

## Reporting Manager dashboard

Show:

```text
My Department
     ↓
Employees
     ↓
Today's Tasks
```

Provide:

```text
Create Task
Assign Task
View Employee Tasks
```

A reporting manager can only select employees belonging to their own department.

## Superuser dashboard

Allow:

```text
Department selection
        ↓
Employee selection
        ↓
Task assignment
```

The superuser can select any employee.

At this stage, do not build the advanced analytics or AI.

Focus only on reliable task creation and assignment.

---

# PHASE 4 — Daily Fixed Tasks

Implement daily task generation.

Example:

```text
Cleaning Staff
Fixed Tasks:

1. Clean Room 101
2. Clean Room 102
3. Clean Meeting Room A
4. Clean Pantry
```

Each morning, generate that employee's task assignments for the current date.

Example:

```text
2026-10-03
Rahul
Room 101        pending
Room 102        pending
Meeting Room A  pending
Pantry          pending
```

The process must be idempotent.

If the job runs twice, it must NOT create duplicate assignments.

Use database constraints and/or safe upsert logic.

---

# PHASE 5 — Morning WhatsApp Task Notification

Connect daily assignments to the existing AiSensy integration.

Flow:

```text
Scheduled job
    ↓
Get today's employee tasks
    ↓
Create task summary
    ↓
Send WhatsApp notification
```

Use the existing approved AiSensy template mechanism for outbound notifications.

Example:

```text
Good morning Rahul.

Today's tasks:

1. Clean Room 101
2. Clean Room 102
3. Clean Meeting Room A
4. Clean Pantry

You can reply:
"done 1"
or
"done all"
```

Do not break the already-working custom inbound reply mechanism.

---

# PHASE 6 — Task Manager WhatsApp Routing

This is a critical phase because the same WhatsApp number is also used by the Facility Bot.

Create a central message router.

Conceptually:

```text
AiSensy Webhook
      ↓
Parse incoming message
      ↓
Identify phone number
      ↓
Identify user
      ↓
Determine active system/context
      ↓
Task Manager OR Facility Bot
```

Create separate state/context for:

```text
TASK_MANAGER
FACILITY
```

Do not use one generic session state shared by both systems.

---

## Example

An employee has:

```text
Facility context:
BOOKING_MEETING_ROOM

Task Manager context:
DAILY_TASKS
```

Both may exist at the same time.

If the employee says:

```text
done all
```

the router sends it to:

```text
TASK_MANAGER
```

If the employee says:

```text
book a meeting room
```

the router sends it to:

```text
FACILITY
```

---

## Context Table

Create or reuse a table similar to:

```text
conversation_context
```

Possible fields:

* id
* phone_number
* system
* context_type
* context_data
* expires_at
* created_at
* updated_at

Example:

```text
Phone: +91XXXXXXXXXX
System: TASK_MANAGER
Context: DAILY_TASKS
```

The context should expire rather than permanently locking the user into one system.

---

# PHASE 7 — Employee Task Commands

Implement deterministic commands first.

Support:

```text
tasks
status
done 1
done 2
done 3
done all
cancel
```

## `tasks`

Return today's tasks.

Example:

```text
Today's tasks:

1. Clean Room 101 - Completed
2. Clean Room 102 - Pending
3. Clean Meeting Room A - Pending
4. Clean Pantry - Completed
```

## `done 2`

Backend:

1. Identify the employee from the WhatsApp number.
2. Find task #2 for today.
3. Confirm that the task belongs to the employee.
4. Mark it completed.
5. Save `completed_at`.
6. Recalculate employee progress.
7. Reply to the employee.

## `done all`

Mark all currently incomplete tasks for that employee and date as completed.

Then send:

```text
All your tasks have been completed.
Have a good day!
```

---

# PHASE 8 — Employee Progress

Create one central progress calculation service.

Do not calculate progress independently in different components.

## Level 1 — Employee

```text
completed tasks
----------------
total assigned tasks
```

Example:

```text
8 / 10 = 80%
```

The employee reaches the first level when all assigned tasks are complete.

---

# PHASE 9 — Department Progress

Aggregate all employees within a department.

Example:

```text
Tech

Total tasks: 100
Completed: 82

Progress: 82%
```

This is Level 2.

Example dashboard:

```text
Tech
████████░░ 82%
```

---

# PHASE 10 — Organisation Progress

Aggregate all departments.

Example:

```text
Organisation

Total assigned tasks: 500
Completed: 435

Progress: 87%
```

This is Level 3.

Hierarchy:

```text
LEVEL 1
Employee
   ↓
LEVEL 2
Department
   ↓
LEVEL 3
Organisation
```

Use the same backend progress service everywhere.

The WhatsApp responses, dashboard, reports, and AI answers should use the same calculation logic.

---

# PHASE 11 — Manager Dashboard

Expand the dashboard for reporting managers.

They should see:

```text
Department progress
        ↓
Employees
        ↓
Individual task progress
        ↓
Individual tasks
```

Example:

```text
TECH

Rahul      100%
Amit        80%
Sneha       60%
```

Managers should only see employees from their own department.

Add:

* Create task
* Assign task
* View pending tasks
* View completed tasks
* View employee progress

---

# PHASE 12 — Superuser Dashboard

Build the organisation-wide dashboard.

Show:

## Level 3

```text
Organisation Progress
████████░░ 87%
```

## Level 2

```text
Operations                90%
Procurement               78%
Tech                      82%
Business Development      87%
Human Resources           95%
Accounts                  88%
Legal                     91%
Design                    84%
```

## Level 1

Click a department to view employees.

Example:

```text
Tech

Rahul      100%
Amit        75%
Sneha       50%
```

Click an employee to view the underlying tasks.

---

# PHASE 13 — Natural Language Task Updates

Only after deterministic commands are stable, add LLM support.

Examples:

```text
"I completed everything today"

"I finished Room 101 and Room 102"

"All my work is done"

"I haven't finished the pantry yet"
```

The LLM should convert the user's message into structured intent.

Example:

```json
{
  "intent": "COMPLETE_TASKS",
  "task_numbers": [1, 2]
}
```

or:

```json
{
  "intent": "COMPLETE_ALL_TODAY_TASKS"
}
```

The backend then validates and performs the actual database update.

IMPORTANT:

The LLM must NOT directly modify the database.

---

# PHASE 14 — Superuser AI Assistant

Build this only after the core task system is stable.

Example:

```text
Superuser:
"What is the Tech team working on?"
```

Flow:

```text
WhatsApp
    ↓
AiSensy Webhook
    ↓
User identification
    ↓
Permission check
    ↓
LLM
    ↓
Determine required information
    ↓
Backend tool
    ↓
Supabase
    ↓
Actual task data
    ↓
LLM formats answer
    ↓
WhatsApp reply
```

Initial supported questions:

```text
What is the Tech team working on?

How is Operations doing today?

Who has not completed today's tasks?

How many tasks are completed today?

Which department has the most pending tasks?

Show me today's pending tasks.

What tasks are assigned to Rahul?
```

---

# PHASE 15 — Controlled AI Tools

Do not give the LLM direct SQL access.

Create controlled backend functions such as:

```text
get_employee_tasks()
get_employee_progress()
get_department_tasks()
get_department_progress()
get_organisation_progress()
get_pending_tasks()
get_task_summary()
```

The backend determines which tools a user can access.

Example:

```text
Employee
→ own tasks

Reporting Manager
→ own department

Superuser
→ organisation
```

The LLM chooses what information it needs, but the backend controls what information it can actually retrieve.

---

# PHASE 16 — WhatsApp Conversation Switching

Add explicit system switching for ambiguous situations.

Support commands such as:

```text
TASKS
FACILITY
CANCEL
```

Examples:

```text
TASKS
```

→ activate Task Manager context.

```text
FACILITY
```

→ activate Facility Bot context.

```text
CANCEL
```

→ clear/close the current conversational flow where appropriate.

If a message is ambiguous and there is no clear context, ask:

```text
What would you like to do?

1. Manage tasks
2. Facility services
```

Do not guess when routing would create a harmful or confusing action.

---

# PHASE 17 — Audit and Logging

Create an audit trail for important actions.

Examples:

```text
task_created
task_assigned
task_completed
task_bulk_completed
manager_assignment
superuser_assignment
whatsapp_received
whatsapp_sent
permission_denied
ai_query
ai_tool_call
```

Avoid logging sensitive information unnecessarily.

Mask phone numbers in application logs.

Never log API keys or secret credentials.

---

# PHASE 18 — Error Handling

Implement clear user-facing responses.

### Invalid task number

```text
I couldn't find task #7 for today.

Reply "tasks" to see your current tasks.
```

### No tasks

```text
You don't have any tasks assigned for today.
```

### Already completed

```text
Task #2 is already marked as completed.
```

### Ambiguous message

```text
I'm not sure what you'd like to do.

You can use:
- tasks
- done 1
- done all
- facility
```

### Permission failure

The backend should reject the operation and log it.

Never trust the frontend alone.

---

# PHASE 19 — Idempotency and Reliability

Make all important operations safe against duplicate requests.

Examples:

* Duplicate webhook delivery must not complete a task twice.
* Morning scheduler must not create duplicate daily assignments.
* Repeated `done all` should remain safe.
* Repeated assignment requests should not create unintended duplicates.

Use appropriate database constraints, unique identifiers, and server-side validation.

---

# PHASE 20 — Final End-to-End Testing

Test the full lifecycle.

## Employee

```text
Morning notification
    ↓
Receive tasks
    ↓
"tasks"
    ↓
"done 1"
    ↓
Supabase updated
    ↓
Confirmation
    ↓
"done all"
    ↓
All tasks completed
```

Verify:

* WhatsApp
* Supabase
* Dashboard
* Progress

---

## Reporting Manager

Test:

```text
Manager creates task
    ↓
Assigns to employee in own department
    ↓
Employee receives task
    ↓
Employee completes task
    ↓
Manager sees updated status
```

Also verify that the manager cannot assign tasks outside their department.

---

## Superuser

Test:

```text
Superuser creates task
    ↓
Assigns across department
    ↓
Employee receives task
    ↓
Employee completes task
    ↓
Organisation dashboard updates
```

---

## Facility Bot

Test:

```text
Facility conversation active
+
Task Manager conversation active
```

Then send:

```text
done all
```

Verify:

```text
Task Manager receives it
```

Then send:

```text
book a meeting room
```

Verify:

```text
Facility Bot receives it
```

No state should be corrupted.

---

# FINAL ARCHITECTURE

```text
                         WHATSAPP
                            │
                            ▼
                         AiSensy
                            │
                     Inbound Webhook
                            │
                            ▼
                   ┌─────────────────┐
                   │ Next.js Router  │
                   └────────┬────────┘
                            │
                  ┌─────────┴─────────┐
                  │                   │
             Task Manager        Facility Bot
                  │
                  ▼
               Supabase
                  │
        ┌─────────┼─────────┐
        │         │         │
    Employee   Department  Organisation
     Level 1    Level 2      Level 3
        │         │         │
        └─────────┼─────────┘
                  ▼
              Dashboard

Superuser WhatsApp Question
            │
            ▼
           LLM
            │
            ▼
      Controlled Tools
            │
            ▼
         Supabase
            │
            ▼
      Natural-language
           answer
```

# Recommended Build Order

Implement in exactly this order:

```text
PHASE 0  → Inspect existing project
PHASE 1  → Database
PHASE 2  → Roles & permissions
PHASE 3  → Task assignment
PHASE 4  → Fixed daily tasks
PHASE 5  → Morning WhatsApp
PHASE 6  → WhatsApp routing
PHASE 7  → Task commands
PHASE 8  → Employee progress
PHASE 9  → Department progress
PHASE 10 → Organisation progress
PHASE 11 → Manager dashboard
PHASE 12 → Superuser dashboard
PHASE 13 → LLM task understanding
PHASE 14 → Superuser AI assistant
PHASE 15 → Controlled AI tools
PHASE 16 → Conversation switching
PHASE 17 → Audit/logging
PHASE 18 → Error handling
PHASE 19 → Reliability/idempotency
PHASE 20 → End-to-end testing
```

## First milestone

Do not start with AI.

The first milestone is:

**Assign task → morning WhatsApp message → employee replies → Supabase updates → WhatsApp confirmation → dashboard updates.**

Once this loop works reliably, add the AI layer.

note: Ask questions if you have any doubts or need any suggestions.

Note: Clear dead code while making any updatations so that we keep the coding clean and follow the best coding practices. 