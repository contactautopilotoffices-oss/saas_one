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

---

## Organization Progress Meter (UI)

Route `/{orgId}/org-progress` (sidebar: **Org Progress Meter**, org_super_admin only).
Also mounted as the Meter tab of the Org Efficiency module — one component, two mounts.

| File | Role |
|---|---|
| `frontend/components/org-efficiency/ConcentricDial.tsx` | The instrument: 5 nested semicircular rings, pointer arms from a shared hub, linkage polyline, graduated bezel |
| `frontend/components/org-efficiency/OrgProgressTracker.tsx` | Module shell: filters, weights, simulate mode, legend, drill-through table |

### What it does

- **Five nested dials**, agent innermost to org outermost, each with its own pointer and value chip.
- **Contribution weights** — sliders per level with Equal / Inside-out / Outcome presets. Normalised
  across visible levels, stored in `localStorage` only. Each legend card shows that level's actual
  points contributed to the org number.
- **Simulate mode** — drag any ring and watch the org needle move. Nothing is persisted; a
  "simulated" badge appears and a Reset button clears it.
- **Filters** — level, department, cadence, agent. Hovering a ring or legend card focuses it.
- **Table view** — drill-through to the goals behind every level, for accessibility and for disputes.

### Two rules the UI keeps

1. **A level with no fresh measurement is excluded, never counted as zero.** A silent zero would hide
   exactly the problem the meter exists to surface. Unmeasured goals are reported in the red
   "not in the chain" strip and in each card's `measured/total` count.
2. **Weights change how the org number is composed; they never change a measured value.**

### Palette

Reference categorical slots 1-5 in reversed order, so blue lands on the outermost org ring. Validated
with `dataviz/scripts/validate_palette.js` in both modes — all checks pass (dark: worst adjacent CVD
dE 8.4, normal-vision 19.3; light: 9.1 / 19.6). Every ring carries an icon, name and value chip, so
identity is never colour alone. The dial surface is a fixed dark instrument bezel in both app themes.

### Data

Reads `/api/org-efficiency/meter` and `/goals`. Until the migrations are run and goals exist it falls
back to a clearly badged **sample dataset**, so the instrument is reviewable today.
