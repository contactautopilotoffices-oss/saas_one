# CRM Module Implementation Plan

## Context

Building a native CRM module inside Autopilot FMS for Business Development. Must integrate seamlessly with existing design system, auth, RBAC, and sidebar.

## What Exists

- **Auth**: Supabase-based with AuthContext
- **RBAC**: CapabilityWrapper with domain/action matrix
- **UI**: KPICard, StatTile, ConfirmModal, motion animations
- **Sidebar**: Domain-based navigation with CapabilityWrapper guards
- **API**: Modular route structure under `/app/api/`

## Implementation Phases

### Phase 1: Database & Types

**Files to create:**
- `supabase/migrations/crm_tables.sql` — All CRM tables
- `frontend/types/crm.ts` — TypeScript types for CRM entities

**Tables:**
```sql
crm_leads, crm_activity_log, crm_events, crm_notes, crm_targets, crm_territories, crm_meta_leads
```

### Phase 2: RBAC Extension

**Files to modify:**
- `frontend/types/rbac.ts` — Add `bd_rep`, `bd_admin` to RoleKey + `crm` to CapabilityDomain
- `frontend/constants/capabilities.ts` — Add CRM capabilities for new roles

### Phase 3: API Routes

**Files to create:**
- `app/api/crm/leads/route.ts` — CRUD for leads
- `app/api/crm/leads/[id]/route.ts` — Single lead operations
- `app/api/crm/activities/route.ts` — Activity log
- `app/api/crm/events/route.ts` — Calendar events
- `app/api/crm/notes/route.ts` — Notes
- `app/api/crm/territories/route.ts` — Territory management
- `app/api/crm/stats/route.ts` — Dashboard stats
- `app/api/crm/import/route.ts` — CSV import
- `app/api/crm/webhooks/meta/route.ts` — Meta Lead Ads webhook

### Phase 4: CRM Components

**Files to create:**
- `frontend/components/crm/CRMDashboard.tsx` — BD Rep dashboard
- `frontend/components/crm/BDAdminDashboard.tsx` — Admin dashboard
- `frontend/components/crm/LeadsTable.tsx` — Lead list with filters
- `frontend/components/crm/LeadDetailDrawer.tsx` — Lead detail panel
- `frontend/components/crm/Timeline.tsx` — Activity timeline
- `frontend/components/crm/CalendarView.tsx` — Calendar component
- `frontend/components/crm/LeadForm.tsx` — Create/edit lead
- `frontend/components/crm/ImportWizard.tsx` — CSV import flow
- `frontend/components/crm/AIInsightsPanel.tsx` — AI chat assistant
- `frontend/components/crm/ReportsView.tsx` — Analytics reports

### Phase 5: Sidebar Integration

**Files to modify:**
- `frontend/components/layout/DashboardSidebar.tsx` — Add CRM menu items

### Phase 6: Settings & Configuration

**Files to create:**
- `frontend/components/crm/SettingsView.tsx` — Admin settings (stages, colors, territories)

## File Structure

```
app/
  api/crm/
    leads/route.ts
    leads/[id]/route.ts
    activities/route.ts
    events/route.ts
    notes/route.ts
    territories/route.ts
    stats/route.ts
    import/route.ts
    webhooks/meta/route.ts

frontend/
  types/crm.ts
  components/crm/
    CRMDashboard.tsx
    BDAdminDashboard.tsx
    LeadsTable.tsx
    LeadDetailDrawer.tsx
    Timeline.tsx
    CalendarView.tsx
    LeadForm.tsx
    ImportWizard.tsx
    AIInsightsPanel.tsx
    ReportsView.tsx
    SettingsView.tsx

supabase/
  migrations/
    crm_tables.sql
```

## Verification

1. Run `npm run dev` — Dev server starts
2. Create test user with `bd_rep` role
3. Verify sidebar shows CRM menu
4. Create a lead via form
5. Verify lead appears in table
6. Check activity timeline updates
7. Test CSV import flow
8. Verify admin can see all leads

## Effort Estimate

- **Phase 1**: 2-3 hours (SQL + types)
- **Phase 2**: 1 hour (RBAC updates)
- **Phase 3**: 4-5 hours (API routes)
- **Phase 4**: 8-10 hours (components)
- **Phase 5**: 1 hour (sidebar)
- **Phase 6**: 2-3 hours (settings)

**Total**: ~18-23 hours
