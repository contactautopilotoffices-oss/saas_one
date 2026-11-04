# HR Grievance: Property-wise Escalation Routing (Plan)

Status: **Plan, decisions mostly agreed. No code changed yet.**
Branch: `feat/hr-property-wise-escalation`

## 0. Decisions so far

| # | Question | Decision |
|---|---|---|
| 1 | Where does the ticket's property come from? | From the employee's **property membership**. Org-level staff (procurement, design, etc.) with no single property fall back to the org's **primary property: D Mafatlal Chambers**. See section 3. *(Waiting for final OK on the multi-property case.)* |
| 2 | Property or city? | **Per property, grouped freely.** At each level the admin picks a set of properties and the people for them. Example: HR Query L1, ETPL + Rabale go to HR A, SS Plaza goes to HR B. |
| 3 | Which ticket types? | **Grievance and HR Query only.** Confidential and Anonymous keep the org-wide chain. |
| 4 | Should property HR see only their property's tickets? | Not decided. **No access change** unless explicitly approved. |
| 5 | Existing open tickets? | **Not touched.** Only tickets raised after release use property routing. |

## 1. The requirement

Today every HR ticket type has one escalation chain for the whole organisation. The business
wants the people at each level to depend on the employee's property:

| Ticket type | Level | ETPL, Rabale | SS Plaza | Any other property |
|---|---|---|---|---|
| HR Query | L1 | HR A | HR B | Default L1 people |
| HR Query | L2 | Default L2 people | Default L2 people | Default L2 people |

A level with no property rule simply uses the default people, exactly like today.

## 2. How it works today

### 2.1 Where the escalation people are stored

`organization_settings.hr_escalation_config` (JSONB, also mirrored inside
`notification_matrix.hr_escalation_config`):

```json
{
  "flow_assignees": { "hr_query": { "1": ["<id>"], "2": ["<id>"] } },
  "flow_levels": { "hr_query": [ { "level": 1, "slaText": "..." } ] },
  "manual_escalation": { "hr_query": true }
}
```

One list of people per ticket type per level, for the whole organisation.

### 2.2 Every place that reads this config

| # | File | What it does with the level people |
|---|---|---|
| 1 | `app/api/hr/tickets/route.ts` (POST, ~line 705) | Picks the **Level 1 owner** when a ticket is raised |
| 2 | `app/api/hr/tickets/[id]/route.ts` (PATCH, ~line 949) | Picks the next owner on **manual escalation** |
| 3 | `backend/lib/hr/slaEscalation.ts` (~line 50) | Picks the next owner on **auto escalation** (SLA cron) |
| 4 | `app/api/hr/tickets/[id]/route.ts` (GET, ~line 142) | Lets configured level people **open the ticket** (access check) |
| 5 | `app/api/hr/tickets/[id]/route.ts` (GET, ~line 319) | Builds the **level roster** shown on the ticket |
| 6 | `backend/services/NotificationService.ts` (~line 2808) | **Email** recipients for a level |
| 7 | `backend/services/WhatsAppEventProcessor.ts` (~line 2354) | **WhatsApp** recipients for a level |
| 8 | `app/api/hr/admin/escalation-config/route.ts` | Admin config read / save |
| 9 | `frontend/components/hr/HRAdminConfigPanel.tsx`, `HREscalationTreeVisualizer.tsx` | Admin UI |

Places 1 to 7 each repeat `flowAssignees[ticketType][level]` inline. All of them must use the
same property-aware rule, otherwise the ticket goes to HR A but the email goes to someone else.

### 2.3 How a ticket knows its property today

- `TicketCreateModal.tsx` does not send `property_id`.
- The ticket saves `employee_snapshot.location` (free text from the employee master,
  default `'Lower Parel'`) and `employee_snapshot.property_id`, which is almost always `null`.
- The HR ticket list already filters by `employee_snapshot->>property_id`
  (`app/api/hr/tickets/route.ts` ~line 148), it just never gets a value.

## 3. Where the ticket's property comes from

The employee does **not** pick anything on the ticket form. The property is worked out on the
server when the ticket is raised, in this order:

| Step | Who it covers | Property used |
|---|---|---|
| 1 | Employee has exactly **one** property membership (`property_memberships`) | That property |
| 2 | Employee has **no** property membership (org-level roles: procurement, design, accounts, etc.) | Org **primary property** (D Mafatlal Chambers) |
| 3 | Employee has **several** property memberships (e.g. a cluster manager) | Org primary property *(see open point below)* |
| 4 | Primary property not set in config | No property, so the default chain is used (same as today) |

**Primary property is a setting, not hard-coded.** Admin Config gets one field:
"Primary property for org-level employees", set to D Mafatlal Chambers. If the head office
moves later, HR changes the setting, no code change.

**Open point for the multi-property case (step 3).** Two choices:
- **3a. Use the primary property** (simplest, no form change). Recommended to start.
- **3b. Show a "Property" dropdown on the ticket form** only for these employees, listing just
  their own properties.

**Frozen on the ticket.** The property found above is saved once into
`employee_snapshot.property_id` (plus `property_name` for display) at creation time. Later
escalations, reopen and notifications all use this saved value, even if the employee moves
property afterwards. This needs **no database migration**, because `employee_snapshot` already
exists and the list filter already reads it.

Side effect to be aware of: the HR ticket list's property filter starts working for new
tickets. Filtering by SS Plaza will no longer show a new Rabale ticket. Old tickets have no
property and keep showing under every property, as today.

## 4. How the property rules are stored

Keep `flow_assignees` exactly as it is. It stays the **default for all properties**.
Add a sibling key with property rules per type and level:

```json
{
  "flow_assignees": {
    "hr_query": { "1": ["<default L1>"], "2": ["<HR Manager>"], "3": ["<HR Head>"] }
  },
  "flow_assignees_by_property": {
    "hr_query": {
      "1": [
        { "property_ids": ["<ETPL id>", "<Rabale id>"], "assignees": ["<HR A>"] },
        { "property_ids": ["<SS Plaza id>"],            "assignees": ["<HR B>"] }
      ]
    },
    "grievance": {}
  },
  "primary_property_id": "<D Mafatlal Chambers id>"
}
```

Rules:
- Only `grievance` and `hr_query` are read. Other types ignore this key.
- **A property can be in only one rule per level** (the save API rejects duplicates), so routing
  is never ambiguous.
- Levels with no rules use the default list.
- No database migration: it is all inside the existing JSONB column, and the save API already
  deep-merges per flow.

## 5. Routing rule (one shared helper, used in all 7 places)

New helper `backend/lib/hr/resolveLevelAssignees.ts`. For ticket type `T`, level `L`, frozen
property `P`:

1. If `T` is Grievance or HR Query, `P` is set, and a rule at level `L` contains `P`, use that
   rule's people.
2. Otherwise use the default `flow_assignees[T][L]`.
3. Otherwise use the existing role-based fallback (reporting manager, HR authority, director),
   unchanged.
4. Never assign the person who raised the ticket: skip to the next person in the list, then to
   the default list.

Places 1 to 7 in section 2.2 call this helper instead of their own inline lookup. It also reads
the config the same way everywhere (today `slaEscalation.ts` reads only the
`hr_escalation_config` column while the others read `notification_matrix` first).

Place 4 (access check) keeps today's behaviour: anyone configured anywhere in that type's chain,
default or property rules, can open tickets of that type. Narrowing that is decision 4.

## 6. Admin UI

In `HRAdminConfigPanel`, for the **Grievance** and **HR Query** flows only:

- New setting at the top: **Primary property for org-level employees** (property dropdown).
- Each level card keeps its current **Default people** picker.
- Under it, a new **"Property-wise routing"** block:
  - "+ Add property rule" opens a row with a **multi-select of properties** and a
    **people picker**.
  - Properties already used in another rule at the same level are disabled in the dropdown.
  - Each row can be edited or removed.
  - Small note: "Properties not listed here use the default people."
- `HREscalationTreeVisualizer` gets a property dropdown so the admin can see the full chain for
  one property.

## 7. Edge cases

| Case | Behaviour |
|---|---|
| No property found | Default chain |
| Property rule only at L1 | L1 from the rule, L2+ from default |
| Rule person is the submitter | Next person in the rule, then default |
| Rule person inactive or no user account | Skipped, then default |
| Employee moves property after raising | Ticket keeps its frozen property |
| Reopened ticket | Same frozen property |
| Existing open tickets | Untouched, keep the default chain |
| New property added | Uses default until a rule is added |
| Property deleted but still in a rule | Ignored at routing time; Admin UI shows it as "removed" so HR can clean up |
| Confidential / Anonymous | Not affected, org-wide chain as today |

SLA days (`flow_levels`) stay the same for all properties.

## 8. Delivery phases

| Phase | Work | DB migration |
|---|---|---|
| 1. Shared resolver | `resolveLevelAssignees` + wire places 1 to 7 + unit tests. With no rules configured it behaves exactly like today | No |
| 2. Property on ticket | Resolve property at creation (section 3), freeze into `employee_snapshot` | No |
| 3. Config API + Admin UI | `flow_assignees_by_property`, `primary_property_id`, duplicate check, property rules UI, tree view dropdown | No |
| 4. Verification | Extend `scripts/verify_all_4_ticket_types_assignment.ts`: ETPL vs SS Plaza vs org-level employee, for L1 create, manual escalation, SLA escalation, email and WhatsApp recipients | No |

Nothing in phases 1 to 4 needs a database migration.

## 9. Still open

1. **Multi-property employees:** use the primary property (3a, recommended) or show a dropdown
   on the form (3b)?
2. **Visibility:** should property HR see only their own property's tickets? (No change unless
   approved.)
