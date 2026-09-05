# People Desk — HR Ticketing & Grievance Management

**Status:** Proposal for approval. Module not built. Two role-cleanup migrations written and awaiting apply (§5.4) — no migration applied by me.
**Prepared:** 4 September 2026
**Scope basis:** Live introspection of this platform's Supabase database (2 organisations,
24 properties, 235 users, 5,313 existing facility tickets) — not a generic design.

---

## 1. Abstract — what has to be achieved

Employee concerns today live in email, WhatsApp, phone calls and corridor conversations.
Nothing is timed, nothing is owned, nothing is countable, and the most sensitive category —
a complaint about a manager, or about senior management — has no safe route at all, because
every existing channel passes through the person being complained about.

People Desk replaces that with a single intake point whose behaviour is **decided by the
category of the concern, not by one common workflow**. One form produces three
fundamentally different journeys:

| Journey | First owner | Ladder | Who can read it |
|---|---|---|---|
| **Grievance** (work environment, workload, role clarity, conflict, managerial concerns) | Reporting Manager / HOD | RM → HR → HR Head → Director | The ladder position only |
| **HR query** (payroll, leave, PF/ESIC, letters, HRMS, benefits…) | HR owner for that category | HR Exec → HR Manager → HR Head → Management | HR team + the raiser |
| **Confidential / Anonymous feedback** | Named Director(s) | No ladder — direct | Named Directors only, by explicit ACL |

Three things must be true when we are done, and each is a hard acceptance test, not an aspiration:

1. **Every ticket has a clock and an owner.** A grievance that sits with a manager for four
   working days escalates itself to HR without anyone remembering to do it.
2. **Nobody outside the employee ↔ employer line can read a ticket — including us.** Not the
   platform super admin, not a property admin, not a colleague, not a tenant, not a vendor,
   not an AI agent, not a WhatsApp notification. Enforced in the database with Row Level
   Security, not in application code that a future route could forget to call.
3. **Anonymous means anonymous.** The employee's identity is not merely hidden on screen — it
   is not stored on the ticket at all, and a two-way conversation still works.

Everything else in this document is the mechanism for those three sentences.

---

## 2. Module name

**People Desk.**

- Product/UI name: **People Desk** ("Raise a request" for employees; "People Desk" workspace for HR).
- Route: `app/(dashboard)/[orgId]/people-desk`
- API namespace: `app/api/people-desk/*`
- Table prefix: `people_desk_*` — consistent with `document_bank`, `petty_cash_*`, `electricity_*`.
- Private schema for identity data: `people_desk_private`
- Ticket ID format: `HR-2026-00001` (prefix configurable per org, sequence resets per year).

Rejected: "HR Helpdesk" (reads as an IT queue), "Grievance Portal" (an employee will not open a
tab that publicly announces they are aggrieved; the neutral name matters for adoption).

---

## 3. What our database already gives us, and what it does not

This is the part that determines cost. Introspected live.

### 3.1 Reusable as-is

| Asset | What it is | How People Desk uses it |
|---|---|---|
| `organizations`, `properties`, `organization_memberships`, `property_memberships` | Tenancy + role membership, RLS already on, 3 policies each | Tenancy scoping and role resolution. No change. |
| `app_role` enum (19 values) | Membership role type | Extend with 3 HR roles; Director reuses the existing `org_super_admin` (§5). |
| `notifications` + `NotificationService` | In-app notification store with deep links | Ticket alerts — **title and deep link only, never body text**. |
| `audit_logs` | Generic `event_by / object_type / action / payload` | Not sufficient alone; People Desk gets its own append-only log (§8). |
| Cron infrastructure | 28 Vercel crons; `check-sla` and `check-escalation` already run every minute | Add one People Desk sweep; the pattern, `CRON_SECRET` guard and retry semantics already exist. |
| `backend/lib/documentBank/storage.ts` | Private bucket + short-lived signed URLs | Copy the pattern for attachments, with a shorter TTL. |
| `backend/lib/accounts/access.ts` | Per-module access resolver (authenticate → resolve capabilities → return typed context) | Copy the shape for `backend/lib/peopleDesk/access.ts`. |
| `frontend/components/pettyCash/*` | Tracker + detail drawer + modal | Reuse the interaction shapes; do not reinvent the list/drawer. |

### 3.2 What does **not** exist and must be built

These are the real costs. Each is a genuine gap, verified:

1. **There is no employee master.** `users` has `full_name, email, phone, metadata, team` and
   nothing else. No employee code, no date of joining, no department, no designation, no grade,
   no work location. `users.metadata` contains only OAuth payload (`sub`, `provider`, `avatar_url`).
2. **There is no reporting-manager mapping anywhere in the schema or the codebase.** A repo-wide
   search for reporting manager / HOD returns nothing. This is the single largest dependency —
   §4A of the requirement ("assign to the employee's Reporting Manager") has nothing to resolve against.
3. **There is no working-day calendar.** All existing SLA is in *hours* (`sla_hours`,
   `sla_deadline`). The grievance ladder is specified in **working days**, which needs a weekly-off
   pattern and a per-location holiday list. Neither exists.
4. **No confidentiality primitive.** Nothing in the schema distinguishes "restricted to an
   explicit list of people" from "visible to the org".

### 3.3 Why we must NOT reuse the existing `tickets` table

Two findings make this non-negotiable:

- **`tickets` is org-wide readable.** The live policy `tickets_select_clean` grants SELECT to any
  user whose `organization_id` matches an active `organization_memberships` row. Every one of the
  42 active org members can read every one of the 5,313 tickets. Correct for a facility helpdesk;
  catastrophic for a grievance about a manager.
- **`tickets` has 78 columns** of facility-maintenance concerns (diesel, floors, vendor
  procurement, photo before/after, skill groups, WhatsApp message ids). Adding HR confidentiality
  to it means every future facility feature is one careless `select *` away from leaking a grievance.

People Desk gets its own tables with their own policies. Separation is the security control.

### 3.4 Two pre-existing issues found while scoping (worth fixing regardless)

- **`ops_super_admin` is not in the `app_role` enum**, but is referenced in `frontend/types/rbac.ts`,
  `frontend/lib/auth/silos.ts`, `backend/lib/accounts/access.ts`, and in the live RLS policy added by
  `20260804000002_electricity_validation_and_ops_role.sql`. Because `organization_memberships.role`
  is the enum type, the role can never be granted, so every policy branch testing for it is dead code.
  Directly relevant to us: `ALTER TYPE ... ADD VALUE` cannot be used in the same transaction that
  references the new value, so **our three new roles ship as their own migration, committed and applied
  before any policy that names them.**
- **The outbox trigger copies ticket body text off-platform.** `fn_tickets_outbox()` puts
  `NEW.description` verbatim into `event_outbox.payload`, which `sweep-outbox` (every 5 min) fans out
  to the omnichannel notification service including the WhatsApp queue. Triggers are per-table, so
  nothing picks up new tables automatically — but this is exactly the mistake to avoid. **No People
  Desk table gets an outbox trigger.** Recorded here as a binding rule.

---

## 4. Core requirements, broken down

Grouped by what they actually demand of the system.

### R1 — Intake
- One form, four fields that drive everything: Type → Category → Sub-category → Confidentiality.
- Subject, description, optional attachment.
- Auto-populated and **frozen at creation**: employee name, code, department, designation,
  location, reporting manager, HOD. Frozen because a grievance must stay attached to the manager
  it was raised against, even after a re-org.
- Ticket ID `HR-2026-00001`, sequential per org per year.

### R2 — Category-driven routing
- The category record — not code — decides first owner, ladder, SLA and confidentiality.
- Owner kinds: `reporting_manager`, `hod`, `hr_pool`, `named_user`, `director_pool`.
- HR Admin can add a category and its whole workflow without a deployment.

### R3 — Escalation ladder with a clock
- Grievance: RM/HOD 3d → HR 7d → HR Head 10d → Director 12d (working days).
- HR queries: per-category ladder, configurable (HR Exec → HR Manager → HR Head → Management).
- Reminder before expiry; automatic escalation on breach; escalation also on explicit employee
  dissatisfaction at any level.
- Full history retained at every level.

### R4 — Confidentiality as a first-class property
- Three sensitivities: `normal`, `confidential`, `anonymous`.
- Confidential: identity stored, readable only by a named ACL.
- Anonymous: identity not stored on the ticket at all; two-way thread still works.
- Both bypass the RM → HR ladder entirely and land on named Directors.

### R5 — Two conversation channels
- Reply to employee (visible) and internal note (never visible to the employee). Enforced by an RLS
  predicate on the message row, not by a UI filter.

### R6 — Status model with attribution
`new, assigned, in_progress, awaiting_employee, awaiting_manager, awaiting_hr,
awaiting_internal_approval, awaiting_external, escalated, resolved, closed, reopened, cancelled`
— every transition writes who and when.

### R7 — Role-scoped dashboards
Employee, Reporting Manager, HR, HR Head, Director — five distinct views (§12).

### R8 — MIS
Volume, grievance-vs-query split, category/location/department cuts, average resolution time, SLA
compliance and breach %, escalation depth, reopen rate, ageing, recurring concerns, owner performance.
**Anonymous data appears only in aggregate, and only above a minimum cohort size.**

### R9 — Immutable audit trail
Every create, assign, reassign, reply, note, status change, escalation, attachment, resolution,
closure, reopen — with actor and timestamp, not editable by anyone including admins.

### R10 — Admin configuration without IT
Categories, sub-categories, owners, SLAs, ladders, alternates, confidential categories,
notification templates, closure and reopening windows.

---

## 5. User roles to be added

### 5.1 Three new `app_role` enum values

| Role | Purpose | Sees grievance content | Sees confidential/anonymous |
|---|---|---|---|
| `hr_executive` | Level-1 owner for HR-category queries | Only from L2, and only tickets routed to them | No |
| `hr_manager` | Level-2 for HR queries; reassignment; SLA monitoring | Only tickets at/above their level | No |
| `hr_head` | Level-3 grievance authority; **owns all People Desk configuration** | Yes, from L3; metadata for all | Only if explicitly added to the recipient list |

### 5.1a Director = the existing `org_super_admin` role

**Confirmed with the business: in this organisation the Directors are Saniel Golechha
(`saniel@worksquare.in`) and Rushab Shah (`rushab@worksquare.in`), and both hold
`org_super_admin`.** So no `director` enum value is created — Level 4 and the confidential /
anonymous inbox attach to `org_super_admin`.

One qualification, and it is the important one. **`org_super_admin` is a platform role, not a
board seat.** Eight active memberships hold it today (§5.4). If People Desk granted Director
content rights by role alone, all eight would receive every confidential and anonymous
grievance — including a test account.

So the rule is:

> **`org_super_admin` opens the door; `people_desk_confidential_recipients` decides who walks
> through it.** Role gates the *route*; the named list gates the *content*.

| Check | Enforced by | Effect |
|---|---|---|
| Can load `/people-desk/confidential` | `org_super_admin` membership | Route-level gate |
| Can read a confidential or anonymous ticket | Row in `people_desk_confidential_recipients` | RLS predicate |
| Can act as Level-4 grievance authority | `people_desk_sla_policies` level 4 → named user | Ladder resolution |

Seeded at go-live with exactly two rows: Saniel and Rushab. Adding a third is an HR Head action
that writes an audit row. This is deliberately *not* the pattern used elsewhere in this codebase —
`document_bank`, `electricity` and `accounts` all grant on `role = 'org_super_admin'` directly.
People Desk must not copy that, and the P7 test suite asserts it: an `org_super_admin` who is not
in the recipients list gets zero rows.

**This holds regardless of what happens to the role cleanup in §5.4.** Even if every one of the
other six keeps `org_super_admin`, none of them can read a grievance.

### 5.2 Roles that are NOT added, deliberately

- **"Employee"** is not a role. Every existing employee-type membership (`staff`, `mst`, `security`,
  `soft_service_staff/supervisor/manager`, `property_admin`, `procurement`, `accounts`, `org_admin`,
  `org_super_admin`) can raise a ticket. Adding an `employee` role would mean re-tagging 135 property
  memberships and would break existing dashboards.
- **"Reporting Manager"** is not a role — it is a *relationship* read from the employee master. A
  `property_admin` is a Level-1 grievance owner because three people report to them, not because of
  their role name. This is what makes the routing work without HR maintaining a parallel role tree.
- **"HR Admin"** is not a separate role — it is `hr_head` plus `org_super_admin` for enable/disable.

### 5.3 Roles explicitly denied all access

Non-employees must not be able to reach People Desk at all — no route, no API, no RLS grant:
`tenant`, `super_tenant`, `vendor`, `food_vendor`, `maintenance_vendor`, `bd_rep`, `bd_admin`.

### 5.4 Role cleanup — DECIDED (option C), migrations written, not yet applied

The business intent is: *only Saniel and Rushab should be Directors / `org_super_admin`; demote the
rest to `ops_super_admin`.* Here is what that means against live data, and why it cannot be executed
as stated today.

**Who actually holds `org_super_admin` right now — 8 active memberships:**

| # | Name | Email | Org | Proposed |
|---|---|---|---|---|
| 1 | Saniel Golechha | `saniel@worksquare.in` | Autopilot Offices | **Keep — Director** |
| 2 | Rushab Shah | `rushab@worksquare.in` | Autopilot Offices | **Keep — Director** |
| 3 | Dipti Walanj | `dipti.walanj@worksquare.in` | Autopilot Offices | Demote |
| 4 | Naresh Laxman | `naresh.laxman@worksquare.in` | Autopilot Offices | Demote |
| 5 | Shailesh Kashyap | `shailesh.kashyap@worksquare.in` | Autopilot Offices | Demote |
| 6 | Shriharii | `shriharii@autopilotoffices.com` | Autopilot Offices | Demote |
| 7 | Test Account Credentials | `test.autopilotoffices@gmail.com` | Autopilot Offices | **Remove entirely — see B4** |
| 8 | jonny | `jonny@123gmail.com` | **tcs** | **Do not touch — different tenant (B3)** |

So the instruction touches **4 real colleagues**, not six.

#### Blocker 1 — `ops_super_admin` does not exist in the database

It is referenced 48 times across 26 files, but it was never added to the `app_role` enum. Verified
live: `enum_range(null::app_role)` does not contain it, and **0 RLS policies** reference it.

`organization_memberships.role` is that enum type, so:

```
UPDATE organization_memberships SET role = 'ops_super_admin' WHERE ...
→ ERROR: invalid input value for enum app_role: "ops_super_admin"
```

The demotion is not merely risky, it is **impossible until a migration adds the value**. That
migration must land and be applied before any membership update, because `ALTER TYPE ... ADD VALUE`
cannot be used in the same transaction that references the new value (§3.4).

#### Blocker 2 — `ops_super_admin` is not "one step down", it is an empty role

| | `org_super_admin` | `ops_super_admin` |
|---|---|---|
| Code references | **264 refs / 123 files** | 48 refs / 26 files |
| RLS policies granting it | many (`document_bank`, `electricity`, `accounts`, …) | **zero** |
| Capability matrix | full across users, properties, tickets, procurement, CRM, petty cash, accounts | `users:[view]`, `tickets:[view, approve]`, `dashboards:[view]`, `reports:[view]` |
| Practical scope | runs the platform | electricity validation sign-off + dispute accept/reject, view-only elsewhere |

`ops_super_admin` was introduced for one narrow job: the electricity bill checker. Demoting four
operational leads into it would remove, at minimum: procurement approval, user management and
invitations, property management, petty cash approval, meeting-room credit administration, vendor
management and Document Bank write access.

**That is an operational change to four people's day jobs, not an HR-privacy change.** It is very
likely not what was intended — and it is not needed for People Desk, because §5.1a already
guarantees that only Saniel and Rushab can read a grievance, whatever role the other six hold.

#### Blocker 3 — `jonny@123gmail.com` belongs to a different organisation

`tcs`, not Autopilot Offices. A blanket "demote everyone else" would strip another tenant's admin.
Any script must be filtered to the Autopilot Offices `organization_id`.

#### Blocker 4 — a test account holds production super-admin

`test.autopilotoffices@gmail.com` has active `org_super_admin` on the live organisation. This is
worth fixing on its own merits, ahead of and independent of People Desk. Recommend deactivating the
membership rather than demoting it.

#### The three options

| | Action | Blast radius | Achieves HR privacy goal? |
|---|---|---|---|
| **A — recommended** | Change nothing. Seed `people_desk_confidential_recipients` = Saniel + Rushab. | None | **Yes, completely** |
| **B** | Demote the four to **`org_admin`** — a real, populated one-step-down role (users, properties, tickets, procurement approve, petty cash approve) | Moderate, reviewable | Yes |
| **C — as literally instructed** | Add `ops_super_admin` to the enum, demote the four to it | **Severe** — four people drop to view-only | Yes, but at high cost |

Option A is recommended because the two goals are separable: *who reads grievances* is settled by
the recipients list, and *how many platform super admins we have* is a governance question that
deserves its own decision rather than riding along on an HR module.

If tightening the super-admin count is genuinely wanted, Option B is the honest version of it, and
should be scoped as its own change with a per-person review of what each of the four actually does.

#### Decision taken — 4 September 2026

**Option C, chosen by the business with the consequences above stated in advance.** Blocker 4
(the test account) is actioned at the same time. Two migrations are written and awaiting the user
to apply them, in this order and in separate transactions:

| Order | File | Effect |
|---|---|---|
| 1 | `supabase/migrations/20260904000001_app_role_ops_super_admin.sql` | `ALTER TYPE app_role ADD VALUE 'ops_super_admin'`. Makes the role grantable for the first time. Grants nothing to anyone. Must be committed on its own — Postgres refuses to use a new enum value in the transaction that adds it. |
| 2 | `supabase/migrations/20260904000002_director_role_cleanup.sql` | Demotes Dipti, Naresh, Shailesh, Shriharii to `ops_super_admin`; deactivates the test account's membership; writes a `user_management_audit_logs` row per change. |

Safety properties built into migration 2, since it edits live access for real people:

- **Aborts** unless both Saniel and Rushab are present and active as `org_super_admin`, rather than
  leaving the organisation without a super admin.
- **Aborts** if migration 1 has not been applied, with the reason spelled out.
- Every statement is filtered on the Autopilot Offices `organization_id`, so it cannot reach the
  `tcs` tenant (Blocker 3).
- The test account is **deactivated, not deleted** — reversible, audit trail intact.
- `shailesh.kashyap@worksquare.in`'s separate active `property_admin` property membership is
  deliberately untouched; he keeps site-level authority.
- Per-user rollback SQL is included as a comment in the file.

Verified before writing: no triggers on `organization_memberships`, and none of the five users has a
`role` key in `users.metadata`, so the membership row is the sole source of truth and the demotion
takes effect cleanly. Affected users must re-authenticate for their session to pick up the new role.

**None of this changes People Desk's privacy guarantee, which never depended on it** (§5.1a).

### 5.5 The System Admin exclusion (§13 of the brief)

Now that Director maps to `org_super_admin`, the "System Admin" of the brief is **`master_admin`** —
the platform-level account, one active holder today.

`master_admin` gets **module enable/disable and technical configuration rights, and zero content
rights**. It cannot read a ticket subject, body, message or attachment. It has no SELECT policy on
`people_desk_tickets`. This is the requirement "System Admin manages technical configuration without
automatically getting access to confidential HR content", implemented literally.

`org_super_admin` is *not* excluded — it is the Director role — but neither is it admitted by role.
It is admitted only through the named recipients list (§5.1a).

Consequence to accept up front: **a production support request about a specific ticket cannot be
answered by looking at the ticket.** Debugging happens on metadata (`people_desk_ticket_index`, §9.3)
and audit rows. If content access is ever genuinely needed, it goes through the break-glass path (§9.2)
which notifies the HR Head and writes a permanent record.

---

## 6. Sub-modules to be built — twelve

| # | Sub-module | Core content | Phase |
|---|---|---|---|
| 1 | **Employee Master & Reporting Hierarchy** | Employee profile, manager/HOD lines with history, alternate mapping | P0 |
| 2 | **Working-Day Calendar** | Weekly-off patterns, per-location holidays, working-day arithmetic | P0 |
| 3 | **Configuration & Routing Engine** | Categories, owner resolution, SLA ladder, fallbacks, templates | P1 |
| 4 | **Ticket Intake & Lifecycle** | Form, ID generation, snapshot, status machine, attachments | P2 |
| 5 | **Conversation & Internal Notes** | Employee-visible replies vs internal notes | P2 |
| 6 | **SLA & Escalation Engine** | Dual clocks, reminders, auto-escalation, dissatisfaction trigger | P3 |
| 7 | **Confidential & Anonymous Channel** | Private identity schema, alias threads, Director inbox, break-glass | P4 |
| 8 | **Access Control & RLS Layer** | Policies, ACL table, definer RPCs, storage policies | P0→P4, hardened P7 |
| 9 | **Dashboards** | Five role-scoped views | P5 |
| 10 | **MIS & Analytics** | Reports with cohort suppression on anonymous data | P6 |
| 11 | **Audit Trail & Retention** | Append-only log, exports, retention/redaction | P6 |

| 12 | **Notification & follow-up engine** | Assignment mail, 3-touch chase, breach escalation, digests (§10) | P2→P3 |

Twelve sub-modules. Notifications was originally scoped as a thin reuse of the existing service; the
requirement for *"needs your action"* plus *"follow up if not done"* makes it a real build — a
chase engine modelled on `electricity/chase.ts` — so it is listed as its own module (§10).

---

## 7. Workflow — how a ticket actually moves

### 7.1 Routing decision (at creation)

```
Employee submits
  ↓
Read category → owner_kind
  ↓
┌── reporting_manager / hod ──→ resolve from employee_reporting_lines (current row)
│         ↓ manager missing / inactive / on long leave / is the subject of the complaint
│         └──→ people_desk_owner_fallbacks → alternate HOD → HR pool (last resort)
├── hr_pool ────────────────→ HR owner configured for that category
└── director_pool ──────────→ people_desk_confidential_recipients (named Directors)
  ↓
Stamp: current_level=1, current_owner, level_due_at, overall_due_at
  ↓
Notify owner (title + link only)  ·  Write audit row  ·  Grant ACL row if confidential/anonymous
```

### 7.2 Escalation

```
cron (every 15 min) reads people_desk_sla_queue  ← metadata-only view, no subject/body
  ↓
level_due_at - reminder_window ≤ now  → reminder to current owner
level_due_at < now                    → escalate: level+1, resolve next authority,
                                        recompute level_due_at, write people_desk_escalations,
                                        notify new owner + employee ("moved to Level 2")
  ↓
Employee presses "Not resolved" on a resolved ticket within the reopen window
                                      → same escalation path, reason='employee_dissatisfied'
  ↓
Level 4 (Director) is terminal — breach raises a flag on the Director dashboard, no further hop
```

### 7.3 The gap in the requirement we should close

**A grievance about the reporting manager currently routes to the reporting manager.** The
requirement lists "Interpersonal conflicts", "Managerial concerns" and "Reporting structure" as
Level-1 → Reporting Manager. For a complaint *about* that manager, this is the fastest way to kill
adoption of the whole module.

Proposed fix, cheap to build: a checkbox on the grievance form — *"This concern involves my
reporting manager"* — plus a per-category flag `bypass_l1_when_subject_is_manager`. When set, the
ticket opens at Level 2 (HR) and the manager never sees it. **Needs HR's decision (§14, Q3).**

### 7.4 SLA model — answering the question in requirement §8

**Recommendation: track both clocks, report on the cumulative one.**

The stated TATs are only coherent as cumulative — 3 / 7 / 10 / 12 working days from ticket creation.
Read as separate windows they would total 32 working days, roughly six and a half weeks, which is not
what "resolution within 12 working days" means to anyone.

So:
- `overall_due_at` — creation + 12 working days. This is the number on the Director dashboard, the
  number in "SLA compliance %", and the number the employee sees as *Expected Resolution Date*.
- `level_due_at` — the current level's own window, derived from the cumulative ladder (L1 due at
  day 3, L2 at day 7, L3 at day 10, L4 at day 12). This drives reminders and auto-escalation.

Two consequences to state plainly, because they surprise people later:
- A grievance escalated to HR on day 3 has **4 working days at Level 2, not 7.** That is what
  cumulative means. HR should confirm they accept it (§14, Q5) — the alternative is per-level windows,
  which we can support with one config flag but which pushes worst-case resolution to 32 days.
- Clocks pause while status is `awaiting_employee` (we are waiting on the raiser) and while the
  location is on a holiday or weekly off. `total_paused_minutes` mirrors the pattern already on `tickets`.

---

## 8. Data model

~22 new tables, one new private schema. Grouped by sub-module.

### 8.1 Shared foundation (not prefixed — other modules will want these)

```
employee_profiles
  user_id PK/FK→users, organization_id, employee_code (unique per org), date_of_joining,
  department, sub_department, designation, grade, work_location_property_id,
  employment_status (active|on_leave|notice|exited), exit_date, is_employee bool

employee_reporting_lines            -- history-preserving; never UPDATE in place
  id, organization_id, employee_user_id, reporting_manager_user_id, hod_user_id,
  effective_from, effective_to NULL, is_current

org_working_calendars               -- property_id NULL = org default
  id, organization_id, property_id, name, weekly_off int[]   -- e.g. {0} Sunday, {0,6} Sat+Sun

org_calendar_holidays
  calendar_id, holiday_date, name

fn working_days_add(from timestamptz, n int, calendar_id uuid) → timestamptz
fn working_days_between(a timestamptz, b timestamptz, calendar_id uuid) → int
```

### 8.2 Configuration & routing

```
people_desk_categories
  id, organization_id, parent_id, ticket_type (grievance|hr_query|confidential|anonymous),
  code, name, owner_kind (reporting_manager|hod|hr_pool|named_user|director_pool),
  owner_role, owner_user_id, sensitivity_default (normal|confidential|anonymous),
  allows_anonymous, bypass_l1_when_subject_is_manager, requires_attachment,
  is_active, sort_order

people_desk_sla_policies            -- one row per level; this IS the escalation ladder
  id, organization_id, category_id, level_number, authority_kind, authority_role,
  authority_user_id, tat_working_days, reminder_before_hours, is_final

people_desk_owner_fallbacks         -- manager vacant / inactive / long leave
  id, organization_id, primary_user_id, fallback_user_id, reason, effective_from, effective_to

people_desk_confidential_recipients -- the named Director ACL
  id, organization_id, user_id, scope (confidential|anonymous|both), added_by, added_at, removed_at

people_desk_notification_templates
  id, organization_id, event_code, channel (in_app|email), subject, body, is_active

people_desk_settings
  organization_id PK, ticket_prefix, reopen_window_days, auto_close_days,
  retention_months, min_cohort_for_analytics, anonymous_enabled
```

### 8.3 Tickets & conversation

```
people_desk_tickets
  id, organization_id, ticket_no,                      -- HR-2026-00001
  ticket_type, category_id, subcategory_id,
  subject, description,
  sensitivity (normal|confidential|anonymous),
  raised_by            -- NULL when anonymous. The whole anonymity design rests on this.
  alias_code,          -- 'Anon-7F3K', shown to the Director instead of a name
  -- frozen snapshot, captured at creation:
  snap_employee_code, snap_department, snap_designation, snap_location_property_id,
  snap_reporting_manager_id, snap_hod_id,
  status, current_level, current_owner_id, owner_pool,
  level_due_at, overall_due_at, calendar_id,
  first_response_at, resolved_at, closed_at, reopened_count,
  sla_paused, total_paused_minutes,
  resolution_summary, employee_satisfaction (satisfied|dissatisfied),
  created_at, updated_at

people_desk_ticket_messages
  id, ticket_id, author_id (NULL for anonymous employee), author_alias,
  visibility (employee|internal),                      -- 'internal' is invisible to the raiser, by policy
  body, created_at

people_desk_attachments
  id, ticket_id, message_id, file_path, file_name, mime_type, size_bytes,
  uploaded_by (nullable), created_at

people_desk_ticket_counters
  organization_id, year, last_number                   -- mirrors ticket_counters
```

### 8.4 Escalation & audit

```
people_desk_escalations
  id, ticket_id, from_level, to_level, from_owner_id, to_owner_id,
  reason (sla_breach|employee_dissatisfied|manual_reassign|owner_unavailable),
  triggered_by (NULL = system), created_at

people_desk_audit                    -- append-only
  id, organization_id, ticket_id, actor_id, action, from_value, to_value, meta jsonb, created_at
  -- REVOKE UPDATE, DELETE FROM PUBLIC, authenticated, service_role
  -- plus a BEFORE UPDATE OR DELETE trigger that RAISEs, so even a superuser leaves a trace
```

### 8.5 The private schema — identity

```
SCHEMA people_desk_private
  -- Not added to PostgREST's exposed schemas. No GRANT to anon or authenticated.
  -- Unreachable from any Supabase client, including one holding the service-role key
  -- via the REST API. Reachable only through SECURITY DEFINER functions in public.

people_desk_private.anonymous_authors
  ticket_id PK, user_id, created_at
  -- RLS enabled with ZERO policies: default-deny for every role that could reach it.

public.people_desk_ticket_access      -- explicit ACL for confidential + assigned investigators
  id, ticket_id, user_id, granted_by, granted_at, reason, revoked_at

public.people_desk_identity_reveals   -- break-glass log; append-only
  id, ticket_id, revealed_to, revealed_by, reason, created_at
```

---

## 9. Privacy and access control — the technical core

This is the section the requirement leans hardest on: *apart from the employee (single) and the
employer side (Director, HR Head, HR team), no one needs access; no trial or public scope; RLS on;
anonymity vs confidentiality applied at the required junctures.*

### 9.1 Three levels, three different mechanisms

| | **Normal** | **Confidential** | **Anonymous** |
|---|---|---|---|
| Identity on ticket | `raised_by` set | `raised_by` set | **`raised_by` is NULL** |
| Shown to owner | Full profile | Full profile, but only to ACL members | `alias_code` only |
| Who can read | Raiser + current ladder position | Only rows in `people_desk_ticket_access` | Only named Directors, via ACL |
| Reporting Manager | Level-1 owner | **Never** | **Never** |
| HR team | From Level 2 | **Never**, unless explicitly granted | **Never** |
| Enforcement | RLS predicate on ladder | RLS predicate on ACL table | RLS + private schema + definer RPC |
| Reverse lookup | n/a | n/a | Break-glass only, logged and notified |

The distinction is real and structural: **confidential is an access-control problem; anonymous is a
data-modelling problem.** Confidentiality can be revoked or granted. Anonymity cannot be undone by
changing a policy, because the link is not in the table.

### 9.2 Anonymous two-way conversation — feasibility (requirement §5 asks IT to confirm)

**Confirmed feasible.** Mechanism:

1. On submit, `people_desk_tickets` is inserted with `raised_by = NULL` and a random
   `alias_code`. The author link is written to `people_desk_private.anonymous_authors` inside the
   same transaction, by a `SECURITY DEFINER` function. No API route ever holds both halves.
2. **Employee side:** their inbox comes from `public.pd_my_tickets()` — a definer function that
   returns `own tickets WHERE raised_by = auth.uid()` **UNION** `tickets joined to
   anonymous_authors WHERE user_id = auth.uid()`. The employee sees their anonymous ticket and its
   full thread. The function filters on `auth.uid()` internally, so it cannot be asked about anyone else.
3. **Employee replies** via `pd_post_anonymous_reply(ticket_id, body)` — definer, asserts the caller
   owns the ticket, inserts the message with `author_id = NULL, author_alias = <ticket alias>`.
4. **Director replies** normally. Notification to the employee is dispatched by
   `pd_notify_anonymous_author(...)` — definer, resolves the recipient internally and writes a
   `notifications` row. The Director's session never receives the recipient id.
5. The Director UI reads through a view that does not expose `raised_by` at all.

Three honest limits, which must be told to employees in the form itself rather than discovered later:

- **Content self-identifies.** "As the only night-shift technician at SS Plaza, I…" defeats any
  technical control. The form should carry a one-line warning.
- **Small cohorts re-identify.** With 24 properties and some sites holding a handful of staff, a
  category + location pair can be a name. Mitigation: analytics suppress any cell below
  `min_cohort_for_analytics` (default 5), and the Director view shows category and severity but not
  location for anonymous tickets unless the cohort clears the threshold.
- **Break-glass exists.** Someone with direct Postgres access (not the app, not the API — the
  database itself) can join the two tables. We cannot make that impossible; we make it *loud*: the
  private schema is unreachable via PostgREST, every definer reveal writes `people_desk_identity_reveals`,
  and the HR Head is notified on every reveal.

### 9.3 RLS design

RLS on for every People Desk table, default deny, with these predicates on `people_desk_tickets` SELECT:

```
raised_by = auth.uid()                                        -- my own ticket
OR ( sensitivity = 'normal'
     AND organization_id IN (my active orgs)
     AND ( current_owner_id = auth.uid()
           OR auth.uid() IN (authorities for this category at levels ≤ current_level) ) )
OR EXISTS ( SELECT 1 FROM people_desk_ticket_access a
            WHERE a.ticket_id = id AND a.user_id = auth.uid() AND a.revoked_at IS NULL )
```

Note what is **absent**: no branch for `master_admin`, `org_admin`, `property_admin` — **or
`org_super_admin`**. Role alone never grants sight of a ticket. Only three things do — you raised it,
you are its current owner or a prior authority in its ladder, or someone explicitly granted you access.

`org_super_admin` deserves the emphasis, because it is the Director role and the instinct will be to
add it to the predicate. It must not be added. Saniel and Rushab reach a confidential ticket through
the third branch — a `people_desk_ticket_access` / `people_desk_confidential_recipients` row — which
is exactly what stops the other six holders of the same role from reaching it too (§5.1a).

`people_desk_ticket_messages` adds one more condition, which is what makes internal notes actually
internal rather than merely hidden by the front-end:

```
visibility = 'employee'                          -- everyone who can see the ticket
OR ( visibility = 'internal' AND caller is an owner/authority/ACL member — never the raiser )
```

**`people_desk_ticket_index`** — a metadata-only view (ticket_no, type, category, level, owner,
status, dates, breach flags; **no subject, no description, no message body**). This is what HR and
HR Head read for SLA monitoring of tickets that have not yet reached them, what the escalation cron
reads, and what the analytics layer aggregates. It is the answer to "HR must monitor SLA on Level-1
grievances without reading them."

### 9.4 The service-role problem

**80 of this repo's 391 API routes use the service-role client, which bypasses RLS entirely.** For
People Desk that would make RLS decorative. Binding rules for this module:

1. Every route that reads or writes ticket content uses the **session client**
   (`frontend/utils/supabase/server.ts`). RLS is the enforcement boundary.
2. `backend/lib/peopleDesk/access.ts` performs a second, independent check in the API layer —
   defence in depth, matching the `accounts/access.ts` pattern, never *instead of* RLS.
3. The service-role client appears in exactly three places, each reviewed: the escalation cron
   (operating on `people_desk_ticket_index` — metadata only), the definer-RPC callers for anonymous
   flows, and attachment signing. Nowhere else.
4. A CI grep fails the build if `supabaseAdmin` or `createAdminClient` appears anywhere under
   `app/api/people-desk/` outside those three files.

### 9.5 Storage

Private bucket `people-desk`, path `org/{org_id}/ticket/{ticket_id}/{uuid}-{filename}`, 25 MB cap,
PDF and images only. Signed URLs with a **5-minute TTL** (Document Bank uses an hour; a grievance
attachment forwarded in a chat is a different kind of harm). RLS policies on `storage.objects`
mirroring the ticket predicate, so the bucket is not a side door. **EXIF stripped on upload** —
image metadata carries device and GPS and would de-anonymise an anonymous submission.

### 9.6 No public, no trial, no AI

- No public or unauthenticated route. Nothing under `app/api/public/`. No share links, no email
  deep links that carry a token granting content access (unlike the existing one-click email actions).
- **Not added to `organizations.available_modules`** as a self-serve toggle. Enabled per organisation
  by explicit master-admin action. Trial/`viewer` organisations never get it.
- **No LLM touches People Desk content.** This platform has Anthropic, Groq and Gemini SDKs wired in,
  an agent runtime, and an agent council that reads business context. Grievance text goes to none of
  them. If auto-categorisation is ever wanted, it comes back as a proposal with the Agent Spec Block
  required by `docs/AGENT_DOCTRINE.md` §3, and it runs on the subject line only, never on anonymous tickets.
- **No WhatsApp.** Notification content is a ticket number and a link, in-app and email only. No
  outbox trigger on any People Desk table (§3.4).

### 9.7 Retention

Closed tickets keep full content for `retention_months` (default 24), then a scheduled job redacts
`description`, message bodies and attachments, keeping the audit trail, dates and category for MIS.
Anonymous author rows are hard-deleted at redaction, making re-identification permanently impossible.

---

## 10. Email notifications & the follow-up engine

Requested explicitly: *"a new ticket is raised, this needs your action"* — and *"follow up if not
done."* A ticket that nobody is chased about is a ticket that breaches its SLA quietly.

### 10.1 What already exists and is reused

| Asset | Use here |
|---|---|
| `backend/services/EmailService.ts` | nodemailer over the configured SMTP / Zoho Mail sender. Generic `sendEmail({to, subject, html})`, already used by petty cash and payment intimation. No new mail infrastructure. |
| `backend/lib/electricity/chase.ts` | The proven 3-touch chase engine: spawn task → touch 1 → touch 2 → touch 3 → default + escalate. People Desk copies this shape, email-only. |
| `app/api/cron/electricity-chase` | The hourly cron driver pattern, `CRON_SECRET`-guarded. |
| `notifications` table | In-app bell, deep-linked, alongside every email. |
| `people_desk_notification_templates` | Per-org editable subject/body, so HR changes wording without a deployment. |

Deliberately **not** reused: `event_outbox` / `sweep-outbox` / the WhatsApp queue (§9.6). People Desk
sends its own mail directly, so grievance text never enters a fan-out payload.

### 10.2 The rule that governs every message

> **No email ever contains the ticket body, the subject line, the employee's name, or an
> attachment. It contains the ticket number, the category, the due date, and a link.**

The mailbox is outside our access-control boundary — it is forwarded, auto-filed, read on shared
screens and synced to phones. Everything sensitive stays behind the login. For an anonymous ticket
the email additionally never reveals the raiser, because it is dispatched by the definer function
(§9.2) that resolves the recipient internally.

So the Level-1 email to a manager reads, in full:

> **HR-2026-00042 needs your action**
> A grievance in category *Workload* has been assigned to you.
> Due: **Tue 9 Sep 2026** (3 working days).
> [Open the ticket] — you'll need to sign in.
> *If you are not the right owner, reassign from the ticket. Do not reply to this email.*

### 10.3 Touch schedule

Two independent tracks per ticket. All offsets are working-day aware and pause when the ticket is
`awaiting_employee`.

**A. Assignment**
| Touch | When | To |
|---|---|---|
| T0 — *"needs your action"* | Immediately on assignment or reassignment | Current owner |
| Employee receipt | Immediately | Raiser (never for anonymous — in-app only) |

**B. Follow-up, until the ticket leaves the owner's hands**
| Touch | When | To | Escalates? |
|---|---|---|---|
| F1 — gentle | 50% of the level's TAT elapsed, no first response | Current owner | No |
| F2 — firm | 80% elapsed | Current owner **+ cc HR** (for a grievance at L1) | No |
| F3 — final notice | 4 working hours before `level_due_at` | Current owner + next level | No |
| **Breach** | `level_due_at` passed | New owner (assignment T0 restarts at the next level) + previous owner + HR Head | **Yes — auto-escalation** |
| Cumulative-risk alert | `overall_due_at` at risk | HR Head | No |
| Level-4 breach | `overall_due_at` passed at L4 | Directors in the recipients list | Terminal — flag only |

Digest, to stop the module becoming a mail generator: an owner with more than three open tickets
receives **one daily 9am digest** listing them, instead of one email per touch. Breach notices are
never digested — those always send individually.

### 10.4 Mechanics

- New table `people_desk_followups` — `ticket_id, level, touch_no, due_at, sent_at, channel,
  recipient_id, suppressed_reason`. One row per planned touch, written when a level is entered.
  Idempotent: a cron retry cannot double-send, matching the electricity chase's dedupe.
- New cron `/api/cron/people-desk-sla`, schedule `*/15 * * * *`. Reads **`people_desk_ticket_index`**
  — the metadata-only view (§9.3) — so the follow-up engine never loads a ticket body. It resolves
  recipient email addresses through a definer function and sends.
- Every send writes a `people_desk_audit` row. "HR says they never got the mail" must be answerable.
- **No one-click email actions.** The existing `email_action_tokens` mechanism (used by accounts)
  lets a recipient act straight from the mail without a session. That is right for approving a
  payment and wrong here: it would move an HR action outside the RLS boundary. Every People Desk
  action requires an authenticated session.

### 10.5 Escalation recipients — resolved, not hardcoded

At each breach the next owner is resolved live from `people_desk_sla_policies` → authority for
level+1, falling back through `people_desk_owner_fallbacks` if that person is inactive or on long
leave. For a grievance the ladder ends at **Level 4 = the Directors in
`people_desk_confidential_recipients`** — Saniel and Rushab (§5.1a) — not at "everyone holding
`org_super_admin`".

---

## 11. UI approach

**Employee** — deliberately not a "portal". A `Raise a request` action in the existing dashboard and
a `My Requests` list. Mobile-first: much of the 235-user base is site staff on phones, and the app is
already a PWA. Four-step form (Type → Category → Details → Confidentiality), with the confidentiality
step explaining in plain language what Confidential and Anonymous each mean, and the honest caveat
from §9.2.

**Reporting Manager** — no new workspace. A `People Desk` card on their existing dashboard listing
grievances assigned to them, with due-today / approaching / breached counts. Low friction is the whole
point: a manager who has to learn a new tool will not answer in 3 working days.

**HR / HR Head** — full workspace at `/[orgId]/people-desk`, following the Petty Cash tracker + detail
drawer shapes already in this repo. Tabs: Queue · Escalated · SLA · Categories · Config.

**Director** — separate route `/[orgId]/people-desk/confidential`, visually distinct, with a
**step-up confirmation** before opening the inbox and an audit row on every ticket opened. Anonymous
tickets show `Anon-7F3K` and a category, never a name, never a location below cohort threshold.

**Everywhere** — internal notes rendered in a visually unmistakable style. The single worst failure
mode of a system like this is an HR user typing an internal note into the employee-visible box.

---

## 12. Dashboards

| Dashboard | Content |
|---|---|
| **Employee** | Open · In Progress · Escalated · Resolved · Closed; expected resolution date; current level; full response history |
| **Reporting Manager** | Assigned · Due today · SLA approaching · Breached · Resolved |
| **HR** | HR queries by owner · Escalated grievances · Category-wise · Location-wise · SLA breaches · Ageing buckets |
| **HR Head** | Level-3 escalations · Total volume · SLA compliance % · Recurring issues · Grievance trend |
| **Director** | Level-4 escalations · Confidential inbox · Anonymous inbox · Critical cases · Org-level trend (cohort-suppressed) |

---

## 13. Dependencies

| # | Dependency | Owner | Blocks | Note |
|---|---|---|---|---|
| D1 | **Employee master data** — code, DOJ, department, designation, location, **reporting manager and HOD for all 235 users** | HR | Everything from P0 | The critical path. Engineering cannot infer it. |
| D2 | ~~Named Director list~~ **RESOLVED** — Saniel Golechha + Rushab Shah | HR / Management | P4 | Seeded into `people_desk_confidential_recipients` (§5.1a) |
| D2b | ~~Role cleanup decision~~ **RESOLVED — option C.** User to apply the two migrations, in order | Management / user | P0 | §5.4 |
| D3 | Holiday calendar per location for FY26–27 | HR | P0 | Different states, different lists |
| D4 | Final category → owner → SLA → ladder matrix | HR | P1 | We build the engine; HR supplies the rows |
| D5 | Decision on the manager-as-subject bypass (§7.3) | HR | P3 | Design-affecting |
| D6 | Decision on cumulative vs per-level SLA (§7.4) | HR | P3 | Recommendation: cumulative |
| D7 | Every employee has a working login | HR + IT | P2 pilot | 235 users exist; coverage unverified |
| D8 | HRMS integration decision — sync employee master or maintain in-app | HR + IT | P0 | "HRMS Issues" is a listed category, so an HRMS exists |
| D9 | Email deliverability for HR notifications | IT | P2 | SMTP + Zoho Mail already configured |

---

## 14. Open questions for HR

1. **Is there an HRMS of record?** If yes, employee master syncs from it and D1 becomes an
   integration; if no, we build master maintenance screens and HR keeps it current. This changes
   Phase 0 materially.
2. **Employee code format**, and does it survive re-joining?
3. **Manager-as-subject (§7.3).** Should a grievance naming the reporting manager skip Level 1?
   Our recommendation: yes, via an explicit checkbox.
4. **Should HR see the subject line of a Level-1 grievance still with the manager**, or only its
   metadata? Our default is metadata only. This is a governance choice, not a technical one.
5. **Cumulative SLA confirmation (§7.4)** — Level 2 gets 4 working days, not 7. Acceptable?
6. **Reopening window** after resolution (proposed 7 calendar days) and **auto-closure** if the
   employee does not respond (proposed 5 working days).
7. **Retention** for closed grievances (proposed 24 months, then redact).
8. **Can an anonymous employee choose to reveal themselves later?** Easy to support; needs a policy decision.
9. **Attachments on anonymous tickets** — allow (EXIF-stripped) or block? Metadata is a
   de-anonymisation risk even after stripping.
10. **POSH — please read this one.** Sexual-harassment complaints under the POSH Act, 2013 cannot be
    handled by a Director inbox: they require a constituted Internal Committee, a 90-day inquiry, and
    a complaint that cannot be fully anonymous because the respondent has a right to reply. If POSH
    matters are expected to arrive through this module, the category must route to the IC with its own
    workflow, and the form must say so before the employee types anything. **We should not ship the
    confidential channel without a decision here.** Recommend confirming with legal/compliance.

---

## 15. Phase-wise plan and completion targets

Assumes kickoff **Monday 7 September 2026**, one engineer-equivalent. Dates are engineering
completion; they slip one-for-one with D1 (employee master data), which is on HR's side.

| Phase | Scope | Exit criteria | Target |
|---|---|---|---|
| **P0 — Foundations** | Employee master + reporting lines with history; working-day calendar + arithmetic functions; 3 new roles as a standalone migration (+ `ops_super_admin` if option B/C is chosen); module scaffold; base RLS | All 235 employees have code, department, designation, location, manager, HOD. `working_days_add` passes tests across weekly offs and holidays. New roles grantable. Confidential recipients seeded with Saniel + Rushab. | **Fri 18 Sep** |
| **P1 — Config & routing engine** | Categories, sub-categories, owner resolution, SLA ladder, fallbacks, settings, templates; HR Admin config screens | HR Admin creates a category with owner + SLA + 4-level ladder and it routes correctly, with no deployment. | **Fri 2 Oct** |
| **P2 — Intake & lifecycle** *(HR-query channel pilot)* | Form, ID generation, snapshot, status machine, replies, internal notes, attachments, employee + HR views, **assignment email (§10.3 track A)** | An employee raises a payroll query; it lands with the right HR owner; the owner gets a "needs your action" mail carrying no body text; HR replies; an internal note is provably invisible to the employee; ticket resolves and closes. **Pilot: one property, HR categories only.** | **Fri 16 Oct** |
| **P3 — Grievance ladder, SLA & follow-up engine** | Dual clocks, **3-touch chase + breach escalation + daily digest (§10)**, dissatisfaction reopen, manager dashboard, escalation history | A grievance breaches Level 1 and escalates to HR unattended, with F1/F2/F3 chase mails sent and logged on the way. No mail contains body text. Cumulative clock correct across a holiday. Manager-as-subject bypass works. | **Fri 30 Oct** |
| **P4 — Confidential & anonymous channel** | Private schema, definer RPCs, alias threads, Director inbox, ACL, break-glass + reveal log, EXIF stripping | Two-way anonymous thread works end to end. Director cannot obtain identity through any route, view, API or export. HR and the reporting manager cannot see the ticket exists. Break-glass writes a record and notifies. | **Fri 13 Nov** |
| **P5 — Dashboards** | Five role dashboards with the metrics in §11 | Each role sees exactly its own scope; metadata-only where required. | **Fri 20 Nov** |
| **P6 — MIS, analytics & audit** | Full report set, cohort suppression, exports, append-only audit, retention job | Anonymous aggregates suppress cells below threshold. Audit rows cannot be updated or deleted by anyone, verified by test. | **Fri 4 Dec** |
| **P7 — Hardening & rollout** | RLS test suite (one authenticated session per role, asserting denial); service-role CI guard; penetration pass on the anonymous path; performance; org-wide rollout + training | Every role × every sensitivity combination has a passing allow/deny test. Zero service-role reads of content. Sign-off from HR Head and a Director. | **Fri 18 Dec** |

**Earliest useful value:** 16 October (HR queries, one property). **Grievance ladder:** 30 October.
**Confidential/anonymous:** 13 November, and only after the POSH question (§14, Q10) is answered.

---

## 16. Explicitly out of scope

Stated so nobody assumes it is coming:

- Leave, attendance, payroll or an HRMS. People Desk raises a *ticket about* payroll; it does not
  compute payroll. The eSSL attendance route in this repo is a read-through proxy and stores nothing.
- AI triage, auto-categorisation or sentiment analysis on ticket content (§9.6).
- WhatsApp as a channel for grievances (§9.6).
- A native mobile app — the existing PWA covers it.
- POSH Internal Committee workflow — flagged as a separate decision (§14, Q10).
- Exit interviews, performance appraisal cycles, surveys — adjacent, not this module.
- Retro-fitting the existing facility `tickets` table (§3.3).

---

## 17. Principal risks

| Risk | Impact | Mitigation |
|---|---|---|
| **Employee master never arrives complete** | P0 stalls; grievances cannot route | Start data collection this week; build a bulk-import screen with validation; fall back to HR-pool routing for any employee without a mapped manager rather than failing the ticket |
| **An employee is identified from an "anonymous" ticket** | Total loss of trust; the module dies | Cohort suppression, EXIF stripping, in-form warning, private schema, reveal log |
| **A future feature `select *`s a People Desk table with the service-role client** | Silent leak | Separate tables, CI guard, RLS as the boundary rather than route code |
| **Managers do not respond in 3 days** | Everything escalates; HR drowns | Reminders before expiry; manager SLA visible on the HR Head dashboard; low-friction manager UI |
| **Confidential channel used for POSH without an IC** | Legal exposure | Resolve §14 Q10 before P4 ships |
| **Cumulative SLA feels unfair to Level 2** | HR pushback after launch | Decide in P3, not after; per-level is a config flag if they prefer it |
| **Role cleanup executed as literally instructed (option C)** | Four operational leads drop to view-only; procurement, user management and petty cash approvals stall | §5.4 — pick option A or B; nothing is executed without a decision |
| **`org_super_admin` treated as Director by role** | All 8 holders, incl. a test account, receive every anonymous grievance | Named recipients list is the only content grant (§5.1a); asserted by a P7 test |
| **Chase engine becomes mail spam and gets filtered** | Managers auto-archive; SLAs breach silently | Daily digest above 3 open tickets; breach notices never digested; in-app bell always mirrors |

---

## 18. Doctrine note

This module ships **no AI agent**, so no Agent Spec Block is required under `CLAUDE.md` /
`docs/AGENT_DOCTRINE.md`. That is a deliberate choice, recorded here: grievance content is the one
dataset in this platform that should not reach a model. Any future proposal to auto-categorise or
summarise People Desk tickets must carry the Agent Spec Block with `[BAA p.N]` citations, and must
exclude anonymous tickets entirely.
