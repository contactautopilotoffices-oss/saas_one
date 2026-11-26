# ABM vendored into saas_one, how it lines up with our CRM

The ABM outbound system was built as a standalone repo
(`bdautopilotoffices-oss/abm-autopilot-offices`) against its **own** Supabase
project. This folder is that repo, vendored unchanged, plus this file.

Nothing here is wired into the app yet, and none of the SQL sits in
`supabase/migrations/`. It is reference material until the port below is agreed.

## Where it lives and why

| Vendored path | Was | Note |
|---|---|---|
| `docs/abm/*.md` | repo root | docs, follows `docs/petty-cash`, `docs/vms-face` |
| `docs/abm/db/*.sql` | `db/` | **not** a migration, see "Why not in migrations" |
| `docs/abm/make/*.json` | `make/` | Make blueprints, secrets are placeholders only |
| `docs/abm/templates/*.md` | `templates/` | message copy, 4 personas, 3 channels |

### Why not in `supabase/migrations/`

Three reasons, all mechanical:

1. Our migrations are `<timestamp>_name.sql` and run as one ordered set.
   `01_schema.sql` … `04_security.sql` would be picked up out of order.
2. `scripts/lint_sql_migrations.js` scans that directory and builds a table
   registry from it. Dropping foreign `abm_*` tables in would put tables in the
   registry that our app never reads.
3. `04_security.sql` runs repo-wide `REVOKE ... ON ALL FUNCTIONS IN SCHEMA
   public FROM public, anon, authenticated` and `ALTER DEFAULT PRIVILEGES`.
   Correct in a single-purpose project. In **our** project that statement hits
   every function in the CRM, procurement, tickets and petty cash modules.
   This file must not be run against our database as written.

## The gap against our CRM

| Concern | ABM repo today | our CRM convention |
|---|---|---|
| Supabase project | separate, `vvozzvbwduoruozsphxa` (`ABM_Project`) | our main project |
| Table prefix | `abm_leads`, `abm_events`, `abm_dnc` | `crm_leads`, `crm_events`, … |
| Tenancy | none, single tenant | `organization_id UUID REFERENCES organizations(id)`, indexed, on leads / events / statuses / sources |
| Row access | RLS on, **zero policies**, `service_role` only | RLS on **with** policies via `is_super_admin()`, `is_bd_admin()`, `is_bd_user()` reading `property_memberships` / `organization_memberships` |
| Pipeline stages | fixed `abm_stage` enum | configurable `crm_lead_statuses` rows, org-scoped, carrying `is_default` / `is_won` / `is_lost` / `is_terminal` |
| Lead source | `campaign` text column | FK to `crm_lead_sources` |
| Ownership | none | `created_by`, `assigned_to` → `auth.users` |
| Function hardening | `search_path` pinned per function | not our current practice; worth keeping |
| Cadence logic | Postgres views + RPCs, Make holds none | no equivalent today |

## Two ways to take this further

Either is a separate piece of work. Pick one before any SQL moves.

### A. Leave it federated

ABM keeps its own project. Our CRM reads it over the API and surfaces it on the
existing `app/(dashboard)/[orgId]/crm/abm/page.tsx` (today a hardcoded mock) via
a new route under `app/api/crm/`. No schema change on our side. Cheapest, and
the ABM test suite stays valid. Cost: two lead databases, dedup and DNC do not
span both.

### B. Port it onto our CRM

`abm_leads` folds into `crm_leads` as extra columns plus an ABM-specific
cadence table, org-scoped, under our RLS helpers, with the stage enum mapped to
`crm_lead_statuses` rows. One lead database, one DNC list, one pipeline. Cost: a
real migration, the 25 ABM tests rewritten against our schema, and the Make
scenarios repointed at our project URL and our RPC names.

## Carried over unchanged, worth knowing

- Dedup is `unique(lower(linkedin_url))` and `unique(phone)`. Our `crm_leads`
  has no such constraint, so a port needs a decision on collisions with
  existing rows.
- `abm_is_sendable_phone()` enforces `^91[6-9][0-9]{9}$`, India mobiles only.
- One reply on any channel stops every channel, via `abm_is_live()`.
- `KNOWN_ISSUES.md` flags the reply webhook's `{{1.phone}}` / `{{1.text}}`
  field names as a guess at AiSensy's payload. Unverified upstream.
- Make blueprints still need `__SUPABASE_SERVICE_ROLE_KEY__` and
  `__AISENSY_API_KEY__` pasted in. Do not commit the filled-in versions.

## Provenance

Vendored from `bdautopilotoffices-oss/abm-autopilot-offices` at commit
`25812c5`, "Correct the placeholder counts in the Make setup notes".
