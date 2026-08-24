# ORG EFFICIENCY METER — module guide

Org super admin console module. Sidebar: **Org Efficiency** (org_super_admin only).
Route: `/{orgId}/org-efficiency`.

## What was built

| Piece | Where |
|---|---|
| DB skeleton (6 tables + progress view) | `supabase/migrations/20260825000001_org_efficiency_meter.sql` |
| Bundle containment guard | `backend/lib/oem/bundle.ts` |
| System prompt generator | `backend/lib/oem/prompt.ts` |
| Shared types | `backend/lib/oem/types.ts` |
| APIs | `app/api/org-efficiency/{goals,tasks,measurements,meter,agents}` |
| Console UI (4 tabs) | `frontend/components/org-efficiency/OrgEfficiencyMeter.tsx` |

## The chain

Goals link upward with `parent_goal_id`:

```
agent goal -> employee goal -> department goal -> tech goal -> org goal
```

The meter shows average progress per level. A goal's progress is
`(current - baseline) / (target - baseline)`, from `v_oem_goal_progress`.

## The three governance filters

- **On expected pace** — `actual_rate >= expected_rate`
- **Behind** — `actual_rate < expected_rate`
- **Data not in chain** — no measurement within one cadence period. These are
  never averaged into the meter as zero; they are surfaced as missing.

## Agent containment (the bundle)

Each agent gets ONE active, versioned bundle in `oem_agent_bundles` — the exact
tables it may read. All agent reads must go through:

```ts
import { readBundleTable } from '@/backend/lib/oem/bundle';

const rows = await readBundleTable(orgId, 'ira', 'material_requests',
    (q) => q.select('id, created_at, delivered_at').eq('organization_id', orgId));
```

Any table outside the bundle throws a bundle violation. No bundle = no reads.

## Registering an agent (Ira, Pratiksha, future agents)

```
POST /api/org-efficiency/agents  { action: 'register',  organization_id, agent_key: 'ira', display_name: 'Ira', department: 'procurement', status: 'shadow' }
POST /api/org-efficiency/agents  { action: 'set_bundle', organization_id, agent_key: 'ira', bundle: { tables: [{ name: 'material_requests', access: 'read', purpose: 'TAT tracking' }] } }
POST /api/org-efficiency/agents  { action: 'regenerate_prompt', organization_id, agent_key: 'ira' }
```

The system prompt is GENERATED from the agent's bound goals (goals where
`agent_key = 'ira'`), the goal chain above them, and the bundle. Never
hand-edited. Every regeneration bumps the version and writes to
`oem_council_log` — the Agent Council's record. Change a goal or a bundle,
regenerate, and the agent evolves with the org: that is the agnostic layer.

## To go live

1. Run the migration in Supabase.
2. Create the first org-level goal in the Goal Tracker, then chain department /
   employee / agent goals under it with `parent_goal_id`.
3. Post weekly/monthly measurements (`/api/org-efficiency/measurements`) —
   manually at first, from agent crons later. The meter moves on the first one.
4. Register Ira and Pratiksha with bundles, keep them in `shadow` until their
   output has been reviewed in the council log.
