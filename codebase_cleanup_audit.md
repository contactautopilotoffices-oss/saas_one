# Codebase Bloat & Redundancy Audit

## Executive Summary

| Metric | Total in Repository | Redundant / Cleanable | % Reduction |
| :--- | :--- | :--- | :--- |
| **Files** | **1,953** | **~372 files** | **~19.0%** |
| **Lines of Code (LOC)** | **519,122** | **~92,297 lines** | **~17.8%** |
| **Unused Dependencies** | 72 packages | **10 packages** | **13.8%** |
| **Root Directory Files** | 137 files | **122 files** | **89.1%** |

> [!NOTE]
> None of the proposed cleanup items touch or alter active user flows, API endpoints configured in [vercel.json](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/vercel.json), or live UI components. All deletions are isolated to dead code islands, unreferenced files, one-off scratch scripts, leftover logs, and orphaned prototypes.

---

## 1. Inventory of Cleanable Code

```
┌─────────────────────────────────────────────────────────────┬───────────┬──────────────┐
│ Category                                                    │ Files     │ Lines (LOC)  │
├─────────────────────────────────────────────────────────────┼───────────┼──────────────┤
│ 1. Root Clutter (Scratch scripts, test logs, dumps, notes)  │ 122 files │ 56,079 lines │
│ 2. Unreachable Dead App Code (Components, dead widgets)     │ 81 files  │ 15,106 lines │
│ 3. Standalone Prototypes (ai-orchestrator, calculator, evals)│ 15 files  │ 4,971 lines  │
│ 4. Ad-Hoc Scripts & Loose SQL (scripts/, sql/)              │ 144 files │ 16,141 lines │
│ 5. Test QR Codes & Unused Media (public/)                   │ 10 files  │ ~62,000 lines│
├─────────────────────────────────────────────────────────────┼───────────┼──────────────┤
│ TOTAL IMMEDIATELY CLEANABLE                                 │ 372 files │ 92,297 lines │
└─────────────────────────────────────────────────────────────┴───────────┴──────────────┘
```

---

## 2. Category Breakdown

### Category 1: Root Directory Clutter (122 Files, 56,079 Lines)
The root directory has accumulated 137 files, of which only **15** are legitimate project configuration files (`package.json`, `tsconfig.json`, `next.config.ts`, `.env`, etc.). The remaining **122 files** are throwaway artifacts:

1. **65 Scratch Scripts (All in root)**:
   - `check_amr.js`, `check_amr2.js`, `check_amr3.js`
   - `check_ticket.js`, `check_ticket_v2.js`
   - `check_user.js`, `check_user_v2.js`
   - `test_fks.js`, `test_fks2.js`, `test_fks3.js`, `test_fks4.js`
   - `fix_is_due_transition.js`, `fix_is_due_transition_v2.js`
   - `fix_history_props_ui.js`, `fix_history_props_ui_v2.js`
   - `inject_historical_missed.js`, `inject_historical_missed_v2.js`
   - `sc.ts`, `sc2.ts`, `a.py`, `cleanup_ui.js`, `apply.js`, etc.
2. **17 Dumps, Logs & Text Files (> 4 MB of text in root)**:
   - `lint_output_2.txt` (1.75 MB), `lint_output.txt` (853 KB), `orgadmin_lint.txt` (234 KB), `orgadmin_lint_final.txt` (166 KB)
   - `check_output.txt`, `check_output_full.txt`, `debug_output.txt`, `tunnel.txt`, `push.log`
   - `audit.json`, `output.json`, `roles.json`, `lint_errors.json`, `Errors before go live.txt`, `QA_CHECKLIST_PHASES_0-3.txt`
3. **29 AI Walkthrough & Task Files**:
   - `walkthrough.md`, `walkthrough_ai_chatbot.md`, `walkthrough_analytics_fix.md`, `walkthrough_diesel_mobile.md`, `walkthrough_fix_buttons.md`, `walkthrough_keyboard_fix.md`, `walkthrough_mst_electricity.md`, `walkthrough_notification_integration.md`, `walkthrough_notifications.md`, `walkthrough_notifications_redirect.md`, `walkthrough_resolver_sync.md`, `walkthrough_shift_persistence.md`, `walkthrough_user_delete.md`
   - `task.md`, `task_user_delete.md`, `implementation_plan.md`, `implementation_plan_notifications.md`, `performance_diagnosis.md`
4. **7 Media & Office Files in Root**:
   - `AI Agents Handbook .pdf` (2.89 MB)
   - `Autopilot Offices - Performance Marketing Review (1).pdf` (400 KB)
   - `Lead_Qualification_Standard.pdf` (75 KB)
   - `Performance Marketing Leads (1).xlsx` (507 KB)
   - `Autopilot Logo Animation.html` (1.04 MB)
   - `Architectural_Security_Report.html` (269 KB)
   - `test-image.jpg` (21 KB)
5. **4 Loose Root SQL Files**:
   - `APPLY_PAYMENT_TRACKER.sql`, `procurement_schema.sql`, `add_deleted_at.sql`, `add_missing_checklist_columns.sql`

---

### Category 2: Dead / Unreachable Application Source Code (81 Files, 15,106 Lines)
Through automated dependency graph traversal starting from all Next.js entry points (`page.tsx`, `layout.tsx`, `route.ts`, and `proxy.ts`), **81 files** were proven to be 100% dead. They form isolated "dead code islands" where they only import each other or nothing at all:

#### A. Obsolete Dashboard Widget Island (14 files, 2,895 lines)
An entire modular widget framework that was superseded and is never rendered:
- [WidgetGrid.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/dashboard/widgets/WidgetGrid.tsx) (434 lines)
- [WidgetShell.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/dashboard/widgets/WidgetShell.tsx) (245 lines)
- [MailDigestWidget.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/dashboard/widgets/MailDigestWidget.tsx) (276 lines)
- [MaterialRequestsWidget.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/dashboard/widgets/MaterialRequestsWidget.tsx) (238 lines)
- [PurchaseOrdersWidget.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/dashboard/widgets/PurchaseOrdersWidget.tsx) (233 lines)
- [StockWidget.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/dashboard/widgets/StockWidget.tsx) (233 lines)
- [ElectricityBillsWidget.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/dashboard/widgets/ElectricityBillsWidget.tsx) (218 lines)
- [TicketsWidget.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/dashboard/widgets/TicketsWidget.tsx) (216 lines)
- [ElectricityPaceWidget.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/dashboard/widgets/ElectricityPaceWidget.tsx) (173 lines)
- [AopSpendWidget.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/dashboard/widgets/AopSpendWidget.tsx) (147 lines)
- [OpsBoard.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/dashboard/widgets/OpsBoard.tsx) (60 lines)
- [useWidgetLayout.ts](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/lib/dashboard/useWidgetLayout.ts) (203 lines)
- [registry.ts](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/lib/dashboard/registry.ts) (129 lines)
- [types.ts](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/lib/dashboard/types.ts) (107 lines)

#### B. Abandoned Legacy Dashboard Island (14 files, 2,242 lines)
Replaced by role-specific dashboards (`OrgAdminDashboard`, `MasterAdminDashboard`, `PropertyAdminDashboard`):
- [OrgDashboard.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/dashboard/OrgDashboard.tsx) (852 lines)
- [PropertyManagement.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/dashboard/PropertyManagement.tsx) (432 lines)
- [UserManagement.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/dashboard/UserManagement.tsx) (211 lines)
- [PropertyDashboard.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/dashboard/PropertyDashboard.tsx) (94 lines)
- [PropertySelectionView.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/dashboard/PropertySelectionView.tsx) (85 lines)
- [PropertyCard.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/shared/PropertyCard.tsx) (92 lines)
- [TicketSLATile.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/dashboard/TicketSLATile.tsx) (85 lines)
- [EmployeeHeatmapTile.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/dashboard/EmployeeHeatmapTile.tsx) (36 lines)
- [KPICard.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/dashboard/KPICard.tsx) (107 lines)
- [StatTile.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/dashboard/StatTile.tsx) (79 lines)
- [TabNavigation.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/dashboard/TabNavigation.tsx) (63 lines)
- [DashboardContainer.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/dashboard/DashboardContainer.tsx) (25 lines)
- [DashboardHeader.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/dashboard/DashboardHeader.tsx) (55 lines)
- [dashboardService.ts](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/backend/services/dashboardService.ts) (56 lines)

#### C. Abandoned / Deprecated Components (4 files, 900 lines)
Located in `frontend/components/deprecated/` and unmounted:
- [MstActiveTicketCard.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/deprecated/MstActiveTicketCard.tsx) (286 lines)
- [SharedActiveTicketCard.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/deprecated/SharedActiveTicketCard.tsx) (286 lines)
- [SharedTicketListItem.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/deprecated/SharedTicketListItem.tsx) (194 lines)
- [OpsTicketCard.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/deprecated/OpsTicketCard.tsx) (134 lines)

#### D. Dead Old Tickets & MST Modules (9 files, 2,727 lines)
- [TicketDetail.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/tickets/TicketDetail.tsx) (**1,004 lines**) - completely dead, active detail page is in `app/tickets/[ticketId]/page.tsx`
- [MstTicketDashboard.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/mst/MstTicketDashboard.tsx) (467 lines)
- [DepartmentTicketList.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/mst/DepartmentTicketList.tsx) (328 lines)
- [TicketList.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/tickets/TicketList.tsx) (220 lines)
- [TicketPauseModal.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/mst/TicketPauseModal.tsx) (196 lines)
- [MstLoadBadge.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/mst/MstLoadBadge.tsx) (132 lines)
- [EnhancedClassificationBadge.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/tickets/EnhancedClassificationBadge.tsx) (60 lines)
- [frontend/components/tickets/index.ts](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/tickets/index.ts) (7 lines)
- [frontend/components/mst/index.ts](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/mst/index.ts) (8 lines)

#### E. Old CRM ViewBuilder & Kanban Boards (7 files, 1,497 lines)
- [ViewBuilder.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/crm/ViewBuilder.tsx) (446 lines)
- [KanbanBoard.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/ops/KanbanBoard.tsx) (305 lines)
- [LeadViews.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/crm/LeadViews.tsx) (252 lines)
- [views.ts](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/lib/crm/views.ts) (159 lines)
- [KanbanCard.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/ops/KanbanCard.tsx) (135 lines)
- [FlowLane.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/ops/FlowLane.tsx) (126 lines)
- [KanbanColumn.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/ops/KanbanColumn.tsx) (81 lines)

#### F. Standalone Unused Components & Modals (23 files, 4,841 lines)
- [DieselHistoryModal.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/diesel/DieselHistoryModal.tsx) (743 lines)
- [SearchableCategoryDropdown.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/hr/SearchableCategoryDropdown.tsx) (309 lines)
- [MailDigest.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/accounts/MailDigest.tsx) (278 lines)
- [ESSLRawDataView.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/dashboard/ESSLRawDataView.tsx) (247 lines)
- [ModernClock.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/ui/ModernClock.tsx) (244 lines)
- [ElectricityTrackerTab.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/procurement/ElectricityTrackerTab.tsx) (238 lines)
- [GooeyNav/index.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/ui/GooeyNav/index.tsx) (230 lines)
- [CommandCard.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/command-center/CommandCard.tsx) (226 lines)
- [SOPDueAlerts.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/sop/SOPDueAlerts.tsx) (218 lines)
- [BuildingFloorsOverlay.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/landing/BuildingFloorsOverlay.tsx) (193 lines)
- [VMSOrgSummary.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/vms/VMSOrgSummary.tsx) (190 lines)
- [classifyTicketFromDB.ts](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/backend/lib/ticketing/classifyTicketFromDB.ts) (181 lines)
- [CommandSidebar.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/command-center/CommandSidebar.tsx) (163 lines)
- [ticketMedia.ts](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/lib/ticketMedia.ts) (163 lines) + [useTicketMedia.ts](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/hooks/useTicketMedia.ts) (142 lines)
- [PermissionPromptModal.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/ui/PermissionPromptModal.tsx) (158 lines) + [PermissionPromptProvider.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/ui/PermissionPromptProvider.tsx) (34 lines)
- [CrmStatTiles.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/crm/CrmStatTiles.tsx) (138 lines)
- [MailboxIntelligenceTile.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/procurement/MailboxIntelligenceTile.tsx) (135 lines)
- [Snowfall.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/ui/Snowfall.tsx) (108 lines)
- [CommandHeader.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/command-center/CommandHeader.tsx) (98 lines)
- [AutopilotLogo.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/ui/AutopilotLogo.tsx) (80 lines)
- [ThemeToggle.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/ui/ThemeToggle.tsx) (27 lines)
- **Broken API Route**: [app/api/procurement/requests/[id]/upload.ts](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/app/api/procurement/requests/[id]/upload.ts) (41 lines) - In Next.js App Router, routes must be named `route.ts`. Because it was named `upload.ts`, Next.js never registered this endpoint.

---

### Category 3: Standalone Prototypes & Abandoned Directories (15 Files, 4,971 Lines)

1. **`Commercial Calculator/` (2 files, 1,257 lines)**:
   - Contains `Claude Commercial Calculator.tsx` and `Gemini Commercial Calculator.tsx`.
   - Excluded in [tsconfig.json](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/tsconfig.json#L77).
   - Zero imports across the entire codebase.
2. **`ai-orchestrator/` (8 files, 2,022 lines)**:
   - An independent prototype Express app with its own `package.json`, completely disconnected from the Next.js frontend/backend.
3. **`evals/` (5 files, 1,692 lines)**:
   - Claude Code prompt evaluation logs from August 2026 (`claude-code-2026-08-02-1.yaml`, `TARGET-4.5.md`).

---

### Category 4: Ad-Hoc Migration & Backfill Scripts (144 Files, 16,141 Lines)

1. **`scripts/` (135 files, 15,466 lines)**:
   - Only **1 script** is wired into the project: `scripts/lint_sql_migrations.js` (used in `npm run lint:sql`).
   - The other 134 scripts are one-time backfill scripts, database inspection dumps, and manual fix utilities (`check_negative_electricity.js`, `align-facility-meters.js`, `assign_memberships.js`, `create-bd-team.js`, etc.).
   - *Recommendation*: Keep `lint_sql_migrations.js` and move the remaining scripts into an `archive/scripts/` folder or git branch to declutter the workspace.
2. **`sql/` (10 files, 675 lines)**:
   - Loose SQL migration files (`internal_audit_schema.sql`, `seed_meeting_room_slots.sql`, etc.) outside the standard [supabase/migrations/](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/supabase/migrations/) directory.

---

### Category 5: Unused NPM Dependencies (10 Packages)
Audited against all 1,195 TypeScript/JavaScript files:
1. `@auth0/auth0-react` *(Project uses Supabase Auth, Auth0 is 100% unused)*
2. `@supabase/auth-helpers-nextjs` *(Deprecated legacy helper; project uses `@supabase/ssr`)*
3. `@serwist/next` & `serwist` *(PWA worker libraries that are unconfigured)*
4. `web-push` & `@types/web-push` *(Push notifications handled via Firebase)*
5. `@types/fluent-ffmpeg`, `@types/js-cookie`, `@types/nodemailer`, `@types/papaparse` *(Redundant type definitions)*
6. `rimraf` *(Never imported or invoked in package scripts)*

---

## 3. Why Making Changes is Difficult: The "Monolith" Problem

Beyond dead files, the reason modifying this codebase is painful is the existence of **172 files with > 500 lines**, led by **9 massive mega-components** exceeding 2,000 to 5,000 lines:

| File | Lines (LOC) | Why It Causes Pain |
| :--- | :--- | :--- |
| [app/tickets/[ticketId]/page.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/app/tickets/[ticketId]/page.tsx) | **5,024 lines** | Contains all detail tabs, full chat timeline, status transitions, attachments, modals, and mutation states in a single file. |
| [OrgAdminDashboard.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/dashboard/OrgAdminDashboard.tsx) | **4,567 lines** | Combines 12 different administrative sub-views, tables, filters, and modal dialogues into one component. |
| [MasterAdminDashboard.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/dashboard/MasterAdminDashboard.tsx) | **3,090 lines** | Overloaded with global analytics, tenant rosters, and system settings. |
| [NotificationService.ts](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/backend/services/NotificationService.ts) | **3,046 lines** | Handles SMS, Email, WhatsApp, Push, and DB notifications in a single giant class. |
| [PropertyAdminDashboard.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/dashboard/PropertyAdminDashboard.tsx) | **2,671 lines** | Monolithic property management logic. |
| [OmnichannelNotificationSettings.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/admin/OmnichannelNotificationSettings.tsx) | **2,476 lines** | Template editors, rule sets, channel toggles, and form states. |
| [WhatsAppEventProcessor.ts](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/backend/services/WhatsAppEventProcessor.ts) | **2,435 lines** | Deeply nested message routing and decision logic. |
| [HRTicketsContent.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/hr/HRTicketsContent.tsx) | **2,255 lines** | All HR ticket filters, tables, and detail modals. |
| [AgentConsole.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/agents/AgentConsole.tsx) | **2,062 lines** | Multi-agent coordination and playground UI. |

### Architectural Bottleneck: 544 Direct Supabase Client Instantiations
- There are **544 files** directly instantiating `createClient()` / `createBrowserClient()`.
- Every file re-declares cookie handlers, auth token refreshes, and schema typing inline, creating thousands of lines of boilerplate that should be abstracted into unified `useSupabase()` / `getServerSupabase()` helpers.

---

## 4. Recommended Safe Cleanup Roadmap

### Phase 1: Zero-Risk Instant Declutter (Save ~62,000 LOC, 144 Files)
- [ ] Delete root scratch scripts (65 `*.js`, `*.ts`, `*.py` files).
- [ ] Delete root logs, lint text dumps, and JSON test outputs (17 files, frees >4 MB).
- [ ] Move non-code media/books (`AI Agents Handbook .pdf`, `Performance Marketing Leads.xlsx`) to a docs/assets archive.
- [ ] Delete `Commercial Calculator/` and `ai-orchestrator/`.
- **Impact**: Zero runtime changes. Next.js and TypeScript compiler immediately speed up.

### Phase 2: Dead Application Code Pruning (Save 15,106 LOC, 81 Files)
- [ ] Delete `frontend/components/deprecated/` (4 files).
- [ ] Delete obsolete dashboard widget island in `frontend/components/dashboard/widgets/` (14 files).
- [ ] Delete legacy dashboard files (`OrgDashboard.tsx`, `PropertyManagement.tsx`, etc.).
- [ ] Delete unreferenced old ticket components (`TicketDetail.tsx`, `MstTicketDashboard.tsx`, etc.).
- [ ] Remove broken `app/api/procurement/requests/[id]/upload.ts`.
- **Impact**: Dramatically cleans component autocomplete and tree shaking; prevents stale code confusion.

### Phase 3: Script & Dependency Clean Up (Save 16,000+ LOC, 10 Packages)
- [ ] Move one-off `scripts/` (except `lint_sql_migrations.js`) into an `archive/` folder.
- [ ] Remove the 10 unused dependencies from `package.json`.
- [ ] Run `npm install` to shrink `node_modules` and lockfile.

### Phase 4: Refactoring Monoliths (Quality of Life)
- [ ] Break [app/tickets/[ticketId]/page.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/app/tickets/[ticketId]/page.tsx) into sub-components (`TicketTimeline`, `TicketActionBar`, `TicketAttachmentsTab`, `TicketModals`).
- [ ] Break [OrgAdminDashboard.tsx](file:///c:/Users/dhuri/OneDrive/Desktop/sahil/Projects/saas_one/frontend/components/dashboard/OrgAdminDashboard.tsx) into modular tab components.
