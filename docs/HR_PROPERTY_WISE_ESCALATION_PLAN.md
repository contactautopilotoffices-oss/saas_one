# HR Grievance: Property-wise Escalation Routing (Plan)

Status: **Plan only. No code changed yet.**
Branch: `feat/hr-property-wise-escalation`

## 1. The requirement

Today every HR ticket type (Grievance, HR Query, Confidential Feedback, Anonymous Feedback)
has one escalation chain for the whole organisation. Level 1 of HR Query goes to the same
people whether the employee sits in Bangalore, Lower Parel, Thane or Rabale.

The business wants to route by property. Example:

| Ticket type | Level | Bangalore | All other properties |
|---|---|---|---|
| HR Query | L1 | HR person A (Bangalore HR) | HR person B |
| HR Query | L2 | same as default | HR Manager |
| HR Query | L3 | same as default | HR Head |

So each level can either have its own people for a property, or fall back to the
organisation-wide default.

## 2. How it works today

### 2.1 Where the escalation people are stored

`organization_settings.hr_escalation_config` (JSONB, also mirrored inside
`notification_matrix.hr_escalation_config`):

```json
{
  "flow_assignees": {
    "hr_query":  { "1": ["<employee or user id>", "..."], "2": ["..."], "3": ["..."] },
    "grievance": { "1": ["..."], "2": ["..."] }
  },
  "flow_levels": { "hr_query": [ { "level": 1, "slaText": "...", "...": "..." } ] },
  "manual_escalation": { "hr_query": true }
}
```

One list of people per ticket type per level. No property dimension.

### 2.2 Every place that reads this config

| # | File | What it does with the level people |
|---|---|---|
| 1 | `app/api/hr/tickets/route.ts` (POST, ~line 705) | Picks the **Level 1 owner** when a ticket is raised |
| 2 | `app/api/hr/tickets/[id]/route.ts` (PATCH, ~line 949) | Picks the next owner on **manual escalation** |
| 3 | `backend/lib/hr/slaEscalation.ts` (~line 50) | Picks the next owner on **auto escalation** (SLA breach cron) |
| 4 | `app/api/hr/tickets/[id]/route.ts` (GET, ~line 142) | Lets configured level people **open the ticket** (access check) |
| 5 | `app/api/hr/tickets/[id]/route.ts` (GET, ~line 319) | Builds the **level roster** shown on the ticket |
| 6 | `backend/services/NotificationService.ts` (~line 2808) | **Email** recipients for a level |
| 7 | `backend/services/WhatsAppEventProcessor.ts` (~line 2354) | **WhatsApp** recipients for a level |
| 8 | `app/api/hr/admin/escalation-config/route.ts` | Admin config read / save |
| 9 | `frontend/components/hr/HRAdminConfigPanel.tsx`, `HREscalationTreeVisualizer.tsx` | Admin UI |

Each of 1 to 7 repeats the same lookup inline:
`flowAssignees[ticketType][level]`. All of them have to become property-aware, otherwise
the ticket goes to the Bangalore HR but the email or WhatsApp goes to the default HR.

### 2.3 How a ticket knows its property today (the weak spot)

- `hr_tickets` has **no `property_id` column**.
- `TicketCreateModal.tsx` does **not** send `property_id` when raising a ticket.
- The ticket stores `employee_snapshot.location`, copied from
  `employee_profiles.location`, which is **free text** ("Lower Parel", "Bangalore",
  "Thane", "Rabale"), and defaults to `'Lower Parel'` when empty.
- `employee_snapshot.property_id` is almost always `null`.
- Anonymous tickets store location as `'Hidden'` and `property_id` as `null`.

So before we can route by property, we need a reliable property on every ticket.

## 3. Decision 1: Where does the ticket's property come from?

| Option | How | Pros | Cons |
|---|---|---|---|
| **A. Employee master location (free text)** | Match `employee_profiles.location` text to a property | Zero UI change, works today | Typos ("Bengaluru" vs "Bangalore"), default 'Lower Parel' silently misroutes |
| **B. Property field on employee master** (recommended) | Add `property_id` to `employee_profiles`, pick from a dropdown in Employee Directory, backfill once from the location text | Reliable, admin controlled, no extra step for employees | Needs a migration and a one-time backfill check by HR |
| **C. Employee chooses property on the ticket form** | Add a "Property" dropdown in `TicketCreateModal` | Handles staff who work across sites | Extra step, employees may pick wrong, risky for anonymous |
| **D. User's property membership** | Use `property_memberships` | Already exists | A user can belong to several properties, so it is ambiguous |

**Recommendation: B, with A as a fallback during the transition.**
At ticket creation the property is resolved once and **frozen on the ticket**, so later
escalations use the same property even if the employee is transferred.

Where to freeze it:
- **B1.** New column `hr_tickets.property_id` (clean, indexable, easy to filter and report). Needs a migration.
- **B2.** Keep it inside `employee_snapshot.property_id` (already exists, no migration for tickets). Harder to query.

Recommendation: **B1**.

## 4. Decision 2: How to store the property-wise people

### Option 1 (recommended for phase 1): extend the existing JSON

Keep `flow_assignees` exactly as it is. It becomes the **default for all properties**.
Add a sibling key for overrides:

```json
{
  "flow_assignees": { "hr_query": { "1": ["B"], "2": ["HR Mgr"], "3": ["HR Head"] } },
  "flow_assignees_by_property": {
    "hr_query": {
      "<bangalore property id>": { "1": ["A"] }
    }
  }
}
```

- No change to existing data, so nothing breaks on day one.
- Override is **per level**: Bangalore can override only L1 and inherit L2 to L4.
- Follows the pattern the module already uses.

### Option 2 (later, if it grows): a proper table

`hr_escalation_assignees (organization_id, ticket_type, level, property_id NULL = default, user_id, sort_order)`

- Easy to query ("which tickets can this HR handle?"), proper foreign keys, audit trail.
- Bigger change: new admin save logic and a data migration from JSON.

Recommendation: **Option 1 now**, move to Option 2 only if we later need per-property
SLA, reports by assignee, or many properties.

## 5. Routing rule (same everywhere)

For a ticket of type `T`, at level `L`, with frozen property `P`:

1. If `P` is set and `flow_assignees_by_property[T][P][L]` has people, use them.
2. Otherwise use the default `flow_assignees[T][L]`.
3. Otherwise use the existing role-based fallback (reporting manager, HR authority, director),
   unchanged from today.
4. Skip the person who raised the ticket (already done today), then move to the next person
   in the list, then to the default list.

This becomes **one shared helper**, for example
`backend/lib/hr/resolveLevelAssignees.ts`, and places 1 to 7 in section 2.2 call it instead
of repeating the lookup. That also fixes a small inconsistency today:
`slaEscalation.ts` reads only the `hr_escalation_config` column while the others read
`notification_matrix` first.

## 6. Admin UI change

In `HRAdminConfigPanel` (escalation flow section):

- Add a **Property selector** above the level cards: "All properties (default)" plus each property.
- With a property selected, each level shows either a **"Using default"** badge with the
  default people greyed out, or the override people.
- Buttons per level: **"Set different people for this property"** and **"Reset to default"**.
- `HREscalationTreeVisualizer` gets the same selector so admins can see the chain per property.
- Save sends only the changed property block. The API deep merges, the same way it already
  merges `flow_assignees`.

## 7. Anonymous and confidential tickets

- An anonymous ticket must not reveal who raised it. At a small site, even the property
  can narrow it down.
- **Recommendation:** property routing switched **on for Grievance and HR Query**, and
  **off by default for Confidential and Anonymous** (they keep the org-wide chain,
  usually director level). Give a per-type toggle `property_routing_enabled` in the config
  so the business can turn it on later.
- If turned on for anonymous, the property is stored on the ticket for routing only and never
  shown in the UI or notifications.

## 8. Visibility (needs explicit approval)

Today any person configured at any level of a ticket type can open **every** ticket of that
type (place 4 in section 2.2). After this change the Bangalore L1 HR would still be able to
open Lower Parel tickets.

Two choices:
- **Keep as is** (no access change). Simple, but Bangalore HR can see other properties' tickets.
- **Restrict:** a property-specific person sees only tickets of their property, default people
  see all.

This is an authorization change. As per the repo rules it will **not** be done unless it is
explicitly approved.

## 9. Edge cases

| Case | Behaviour |
|---|---|
| Ticket property unknown | Default chain |
| Property override exists for L1 only | L1 from override, L2+ from default |
| Override person is the submitter | Skip to next override person, then default |
| Override person left / inactive | Skip to next, then default |
| Employee transferred after raising | Ticket keeps its frozen property |
| Reopened ticket | Same frozen property |
| Existing open tickets (no property) | Continue on the default chain; optional one-time backfill |
| New property added | Inherits default until an admin sets an override |
| Email / WhatsApp | Use the same resolver, so the right HR is notified |

SLA days (`flow_levels`) stay per ticket type for all properties. Per-property SLA is out
of scope for now.

## 10. Phased delivery

| Phase | Work | Needs DB migration |
|---|---|---|
| 1. Property on employee and ticket | `employee_profiles.property_id` + dropdown in Employee Directory + backfill from location text; `hr_tickets.property_id` set at creation | Yes (written as a file, applied by a human) |
| 2. Shared resolver | `resolveLevelAssignees` helper, wire places 1 to 7, unit tests for the routing rule | No |
| 3. Config + Admin UI | `flow_assignees_by_property` in the config API; property selector in Admin Config and tree view | No (JSONB) |
| 4. Visibility (optional) | Restrict property HR to their property's tickets | No, but needs approval |
| 5. Verification | Extend `scripts/verify_all_4_ticket_types_assignment.ts`: Bangalore vs Lower Parel ticket for each type and level, manual and SLA escalation, email and WhatsApp recipients | No |

Phases 1 to 3 together deliver the requirement. Phase 2 can be built first and is safe:
with no overrides configured it behaves exactly like today.

## 11. Open questions for the business

1. **Property source:** OK to take it from the employee master (recommended), or should the
   employee choose it on the ticket form?
2. **Property or city?** Route by individual property (each building) or by city / location
   group (all Bangalore properties share one HR)? If city, we add a simple
   "location group" on top of properties.
3. **Which ticket types** get property routing: only Grievance and HR Query, or all four?
4. **Visibility:** should property HR see only their own property's tickets?
5. **Existing open tickets:** leave on the default chain, or backfill their property?
