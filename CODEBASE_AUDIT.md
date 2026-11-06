# Codebase Audit

**Project:** SaaS One — Next.js, TypeScript, React, Supabase  
**Audit date:** 10 October 2026  
**Mode:** Read-only inspection; this report is the only new file authorized by this request.

## 1. Executive summary

The best cleanup opportunity is a combination of obsolete UI islands, unused dependency candidates, root-level operational clutter, and overly large active components. There is no evidence supporting blanket deletion of hundreds of files or a guaranteed percentage reduction.

Start with reference-free deprecated components and generated historical outputs. Then remove verified unused direct dependencies in small batches. Refactor active dashboards and services last, preserving their behavior and permissions.

**Do not delete a file simply because it is large, named “legacy”, absent from an import graph, or duplicated byte-for-byte.** Routes, migrations, assets, manual scripts, tests, and local tooling have different entry mechanisms.

### Evidence labels

- **Verified fact:** measured file size, exact hash match, explicit import, configuration entry, or observed source behavior.
- **High-confidence unused candidate:** no import/re-export/require/literal dynamic-import caller found, no route reachability, and no meaningful external source/text reference found. This is a candidate for a separately authorized cleanup, not a runtime guarantee.
- **Review candidate:** unreachable from the main Next app but referenced in tests/docs, part of an isolated feature, a manual tool, or potentially externally used.
- **Active:** explicit application, framework, configuration, test, or operational reference exists.

### Risk levels

Risk below means **risk of cleanup/refactoring causing harm**:

- **Low:** historical generated outputs or isolated reference-free UI candidates.
- **Medium:** feature islands, direct dependency changes, asset URL consolidation, tooling relocation.
- **High:** auth/session boundaries, live business logic, migration history, notification/AI pipelines, external URLs, operational scripts.

## 2. Scope, method, and limitations

Inspected the working tree across app, frontend, backend, brain, task-manager, lib, tests, scripts, SQL/schema/migration locations, public assets, documentation, root files, and the standalone ai-orchestrator package.

Used:
1. Filesystem inventory and physical line counts.
2. TypeScript AST parsing of imports, re-exports, require calls, and literal dynamic imports.
3. Resolution of aliases in tsconfig.json, relative paths, index files, and JS-to-TS module references.
4. A main-app graph rooted at 575 recognized Next.js/configuration entry files. It reached 1,289 source files.
5. Repository text searches to check non-import uses, including tests that read source files, script file paths, public asset URLs, documentation, and Vercel cron configuration.
6. SHA-256 content hashes to identify exact duplicate non-empty files.
7. Review of package scripts, Next/TypeScript/ESLint configuration, migration tooling, and representative component/service responsibilities.

Import reachability is intentionally conservative: it includes type imports and does not prove whether conditional branches execute. It cannot establish that externally called APIs, manually run scripts, historical migrations, computed imports, or public URLs are unused.

Skipped .git, node_modules, .next, and environment files in the source inventory. Read installed package metadata only where useful for verifying bundled types. No secrets or environment values were read. No database/network actions, packages, migrations, seeds, fixes, or refactors were performed.

Metrics include tracked, ignored, and untracked local files outside the skipped locations. They describe this working tree, not a clean Git checkout or shipped bundle. Physical lines include comments, blanks, declarations, tests, and scripts; they are not executable LOC.

The prior UX audit's no-emit TypeScript check passed. No new build, lint, browser, or behavior test was run for this report. Existing uncommitted work was present and preserved.

### Current inventory

- **2,354 files** in the inventory, excluding the skipped locations/environment files and before this report.
- **1,737 JS/TS-family files**, including declarations, tests, scripts, prototypes, and public JavaScript.
- **402,123 physical lines** across those JS/TS-family files.
- **136 root files** under the same exclusions; this is not “136 removable files”.
- Four exact duplicate groups were found.

| Area | Files | JS/TS-family physical lines |
|---|---:|---:|
| `.agents` | 9 | 0 |
| `.claude` | 8 | 0 |
| `(root)` | 136 | 2,664 |
| `.vscode` | 2 | 0 |
| `ai-orchestrator` | 8 | 323 |
| `app` | 581 | 97,921 |
| `backend` | 372 | 49,273 |
| `brain` | 20 | 508 |
| `Commercial Calculator` | 2 | 1,257 |
| `docs` | 72 | 0 |
| `evals` | 5 | 0 |
| `frontend` | 547 | 210,276 |
| `knowledge` | 6 | 0 |
| `lib` | 2 | 46 |
| `public` | 42 | 137 |
| `sample_images` | 4 | 0 |
| `scripts` | 137 | 10,634 |
| `sql` | 10 | 0 |
| `supabase` | 168 | 0 |
| `task-manager` | 131 | 23,431 |
| `tests` | 88 | 5,421 |
| `whatsapp-test` | 4 | 232 |

### Why the existing cleanup report should not be used as a deletion list

`codebase_cleanup_audit.md` claims 372 immediately cleanable files and describes scripts, SQL, evals, and prototypes as disposable. Current references contradict blanket removal:

- `EVAL.md` references `evals/`.
- `docs/COST_INTELLIGENCE_SPEC.md` explicitly references both Commercial Calculator prototypes and a proposed consolidation.
- `CLAUDE.md` and `docs/AGENT_DOCTRINE.md` reference `AI Agents Handbook .pdf`.
- `output.json` is referenced by `scripts/find-the-9-json.js` and `scripts/find-today.js`.
- `audit.json` is referenced by `tmp_audit.ts`.
- `tests/petty-cash/sidebar.test.mjs:23` reads `OrgDashboard.tsx`.
- Both logos and `public/loader-icon.jpg` have active uses.

Keep the old report as historical evidence if needed, but do not carry forward its savings numbers or “100% dead” claims.

## 3. Unused/dead-code candidates

### D1. Strongest first-pass candidates — Low cleanup risk

The following files have **no inbound code import found**, are outside the main-app reachable graph, and have no meaningful caller found in the checked source/test/script/documentation text. Generated architecture inventories listing a filename are not callers.

| Affected files | Evidence | Proposed later action |
|---|---|---|
| `frontend/components/deprecated/MstActiveTicketCard.tsx` (286 lines), `SharedActiveTicketCard.tsx` (286), `OpsTicketCard.tsx` (134), `SharedTicketListItem.tsx` (194) in the same directory | No callers; deprecated directory; first two are exact duplicates. | First deletion-review batch. Validate current ticket cards and run ticket/MST smoke checks before removal. |
| `frontend/components/command-center/CommandCard.tsx` (226), `CommandHeader.tsx` (98), `CommandSidebar.tsx` (165) | No callers. Active command center lives under `frontend/components/dashboard/command-center/`. | Review visual differences, then retire unused wrappers. Do not remove the active command center. |
| `frontend/components/dashboard/DashboardContainer.tsx` (25), `DashboardHeader.tsx` (55), `ESSLRawDataView.tsx` (247), `PropertySelectionView.tsx` (85), `TabNavigation.tsx` (63) | No callers found. | Review in small batches; confirm no pending feature depends on them. |
| `frontend/components/crm/CrmStatTiles.tsx` (138), `LeadViews.tsx` (252) | No inbound imports. LeadViews imports ViewBuilder, so deleting its feature requires reviewing that whole island. | Retire standalone unused tile; handle saved-view feature separately. |
| `frontend/components/diesel/DieselHistoryModal.tsx` (743) | No callers found. Large size alone was not the basis. | Compare active diesel history flow before retirement. |
| `frontend/components/hr/SearchableCategoryDropdown.tsx` (309) | No callers found. | Check active category-selection components for required behavior. |
| `frontend/components/landing/BuildingFloorsOverlay.tsx` (193) | No callers found. | Confirm intended landing design before retirement. |
| `frontend/components/ops/FlowLane.tsx` (126) | No callers found. | Confirm current flow-map implementation. |
| `frontend/components/procurement/MailboxIntelligenceTile.tsx` (135) | No callers found. | Check active mailbox/finance presentation before retirement. |
| `frontend/components/ui/AutopilotLogo.tsx` (80), `ModernClock.tsx` (244), `Snowfall.tsx` (108), `ThemeToggle.tsx` (27) | No callers found. Theme functionality itself remains active elsewhere. | Retire unused visual widgets after checking planned design work. |
| `frontend/components/vms/VMSOrgSummary.tsx` (190) | No callers found; other VMS dashboards are active. | Compare current organization visitor view before removal. |

These line counts are candidate footprints, not promised net savings. Imports/helpers shared with active features must remain.

### D2. Unreachable feature islands — Medium cleanup risk

These have no main-app route path in the resolved graph, but their own internal imports or documentation make them a **review** rather than automatic deletion.

| Island / affected files | Verified evidence | Decision required |
|---|---|---|
| Old operations widgets: `frontend/components/dashboard/widgets/OpsBoard.tsx`, `WidgetGrid.tsx`, `WidgetShell.tsx`, `AopSpendWidget.tsx`, `ElectricityBillsWidget.tsx`, `ElectricityPaceWidget.tsx`, `MailDigestWidget.tsx`, `MaterialRequestsWidget.tsx`, `PurchaseOrdersWidget.tsx`, `StockWidget.tsx`, `TicketsWidget.tsx`; `frontend/lib/dashboard/registry.ts`, `types.ts`, `useWidgetLayout.ts` | OpsBoard owns the grid/registry/layout path; no external mount found. `docs/DESIGN_AUDIT_OPS_BOARD.md` discusses the feature. | Confirm whether customizable widgets are intentionally retained. Keep `useWidgetData.ts` if active cards still import it; do not delete by directory. |
| Legacy MST UI: `frontend/components/mst/index.ts`, `MstTicketDashboard.tsx`, `DepartmentTicketList.tsx`, `MstLoadBadge.tsx`, `TicketPauseModal.tsx` | Barrel not imported; internal imports remain; `COMPONENT_CONTRACT.md` and `TICKET_CARD_MIGRATION.md` reference parts. | Compare with active MstDashboard and current unified cards; update contracts/tests before retirement. |
| Older ticket UI: `frontend/components/tickets/index.ts`, `TicketDetail.tsx`, `TicketList.tsx`, `EnhancedClassificationBadge.tsx` | Old detail/list are reached only through the unused barrel/island. Barrel also exports active components. | Remove only obsolete exports/files if approved. Preserve TicketCreateModal and active tenant/admin screens. Names appearing inside TicketDetailsModal are not proof of importing TicketDetail. |
| Saved CRM views: `frontend/components/crm/LeadViews.tsx`, `ViewBuilder.tsx`, `frontend/lib/crm/views.ts` | Internal imports only in main-app graph. API `app/api/crm/views/route.ts` independently exists. | Decide whether UI should be restored or retired. Do not infer the API or persisted views table is unused. |
| Older property dashboard: `frontend/components/dashboard/PropertyDashboard.tsx`, `EmployeeHeatmapTile.tsx`, `TicketSLATile.tsx`; old property-selection path `PropertySelectionView.tsx` → `frontend/components/shared/PropertyCard.tsx` | No root caller of either parent found; child imports remain. | Compare current dashboard behavior and keep shared children if newly referenced. |
| Old organization dashboard: `frontend/components/dashboard/OrgDashboard.tsx`, `PropertyManagement.tsx`, `UserManagement.tsx` | UnifiedDashboard imports OrgAdminDashboard, not OrgDashboard. However `tests/petty-cash/sidebar.test.mjs` directly reads OrgDashboard. Documentation and stale route comments also reference it. | Test contract must be updated before any deletion. This is not “unreferenced”. |
| `frontend/components/ops/KanbanBoard.tsx`, `KanbanColumn.tsx`, `KanbanCard.tsx` | Internal imports only; HRKanbanBoard is a separate implementation. | Compare drag/drop and permission behavior before consolidating. |
| `frontend/components/ui/PermissionPromptProvider.tsx` → `PermissionPromptModal.tsx` | Provider has no external mount. Actual notification handling exists separately. | Consolidate prompt ownership only after verifying active notification flow. |
| `frontend/components/accounts/MailDigest.tsx`, `frontend/components/procurement/ElectricityTrackerTab.tsx` | No inbound imports; explicitly mentioned in testing/automation documents. | Confirm these were replaced rather than awaiting integration. |
| `frontend/components/pettyCash/PettyCashTracker.tsx`, `RequestDetailDrawer.tsx` | No inbound imports; both referenced in allocation-wallet plans. | Compare implemented petty-cash module against planned functionality before removal. |
| `frontend/components/sop/SOPDueAlerts.tsx` | No inbound import; text reference in checklist route needs interpretation. | Verify active reminder/alert behavior; no blanket SOP cleanup. |

Additional small candidates:
- `frontend/components/dashboard/KPICard.tsx` and `StatTile.tsx`: design-plan references remain.
- `frontend/components/ui/GooeyNav/index.tsx`: no caller found; review associated CSS/assets together.
- `frontend/components/DESIGN_SYSTEM_GUIDE.tsx`: one physical line, documentation reference remains; move a guide to docs only if it contains useful content.

**Not unused:** `frontend/types/react-liquid-gauge.d.ts`. Ambient declarations can be included by tsconfig without an import. The active LiquidDieselGauge imports react-liquid-gauge.

### D3. Local unused variables/functions — not certified

The scan did not run a complete symbol-level unused-export/local-variable analysis. No function is marked removable solely because a text search did not find its name. Future cleanup can use the installed TypeScript compiler and ESLint in scoped read-only checks, then inspect callbacks, exports, JSX, registrations, and side effects. Whole-file candidates above have stronger evidence than a guessed list of unused functions.

## 4. Exact duplicates and overlapping implementations

### X1. Verified SHA-256 duplicates

| Exact duplicate group | References / risk | Recommendation |
|---|---|---|
| `frontend/components/deprecated/MstActiveTicketCard.tsx` and `SharedActiveTicketCard.tsx` | No code callers found. Low risk. | Both are candidates; do not merge them into another active card without behavior comparison. |
| `backend/db/migrations/20260824_property_monthly_requisition_budgets.sql` and `supabase/migrations/20260824000001_property_monthly_requisition_budgets.sql` | Both migration locations are scanned by scripts/lint_sql_migrations.js. Two manual runner scripts name the Supabase copy. **High risk.** | Choose a canonical source for future changes, document legacy mapping, and preserve migration history until applied versions are reconciled. |
| `public/autopilot-logo.png` and `public/logo.png` | Root metadata uses autopilot-logo; auth recovery pages use logo. Medium risk. | Consolidate references first; preserve externally cached/bookmarked asset URLs if needed. Neither copy is currently unused. |
| `public/loader-icon.jpg` and root `test-image.jpg` | Loader and test routes use loader-icon; root test-image only appears in generated file inventory. Low risk for root copy. | Root copy is a cleanup candidate. Preserve the active public file. |

No other non-empty byte-identical file groups were found in this scan. Similar filenames and v2 suffixes do not establish content duplication.

### X2. Functional overlap — requires comparison, not automatic merging

- Three command-center locations coexist: `frontend/components/command-center/`, active `frontend/components/dashboard/command-center/`, and old `frontend/components/dashboard/widgets/`.
- Ticket views coexist in `tickets/`, `ai-tickets/`, `hr/`, `ops/`, `mst/`, and `deprecated/`. Some are role-specific active views.
- Multiple role dashboards repeat sidebar/header/modal/state patterns. Extract shared primitives and navigation configuration only where behavior is truly equivalent.
- Electricity/Diesel spreadsheet logger components repeat presentation patterns, but calculations, units, and data contracts differ.
- Multiple dialog systems exist, including shared UI, @reach/dialog, and PettyCash WorkflowModal. Accessibility and busy-state behavior differ.
- `frontend/components/ui/Skeleton.tsx` directly uses clsx/tailwind-merge while `backend/lib/utils.ts` defines a shared cn utility. This is a small deduplication opportunity, but a UI helper should live in a neutral shared location rather than pull UI toward server code.

## 5. Dependency audit

### P1. No source/config/tool use found — Medium removal risk

The following direct root dependencies have no import or usage found outside their package declarations/lockfiles in the inspected code/config/scripts/tests. This is verified absence in the scanned repository, not proof of external deployment usage.

| Dependency | Evidence and next check |
|---|---|
| `@auth0/auth0-react` | No references found; existing authentication uses Supabase. |
| `@supabase/auth-helpers-nextjs` | No references found; SSR clients use @supabase/ssr. |
| `@serwist/next` | No import/config integration found. |
| `serwist` | Only an explanatory next.config.ts comment mentions it; current sw.js is a minimal custom service worker. |
| `rimraf` | No import or package-script use found. |
| `web-push` | No source use found; active push implementation uses Firebase. |
| `@types/web-push` | Review with web-push removal, not as an unrelated change. |

Before a future removal: inspect CI/deployment commands and standalone integrations, remove only direct declarations in an authorized task, regenerate the lockfile with the existing package manager, then type-check/build/smoke-test. A dependency can remain transitively required after direct removal.

### P2. Other dependency hygiene candidates

- `@types/qrcode.react`: installed qrcode.react package declares its own types. Review removal of the older separate type package; keep the actively imported qrcode.react runtime.
- `@types/fluent-ffmpeg`, `@types/js-cookie`, `@types/nodemailer`, `@types/papaparse` appear in dependencies. They support used libraries and must not be labeled unused merely because they are not imported. Consider devDependencies placement after verifying production build installation behavior.
- Root `@anthropic-ai/sdk` is imported only by `ai-orchestrator/src/ai.js` in this scan. The standalone package also declares its own version. Review root removal only after confirming ai-orchestrator has independent installation/deployment and is not intentionally resolving root dependencies.
- `pg` and `qrcode` imports found here are in operational scripts. Consider tooling dependency ownership rather than deletion if those scripts are retained.
- Browser test commands use `npm exec --yes --package=esbuild`. This is a reproducibility concern, not an unused dependency: the compiler is fetched by command rather than pinned directly. No package was fetched in this audit.
- Keep @types/node, @types/react, @types/react-dom, tailwindcss, and react-test-renderer. They have ambient/config/runtime test uses that simple import counts miss.

### P3. Overlapping but actually used packages

| Package | Verified examples | Recommendation |
|---|---|---|
| `@gsap/react` | `frontend/components/landing/ScrollVideoLanding.tsx` | Keep until the owning workflow is deliberately consolidated. |
| `@napi-rs/canvas` | `backend/lib/electricity/billOcr.ts`, `backend/lib/ocr/rasterize.ts` | Keep until the owning workflow is deliberately consolidated. |
| `@reach/dialog` | `frontend/components/dashboard/ProcurementStatusModal.tsx` | Keep until the owning workflow is deliberately consolidated. |
| `chart.js` | `app/property/[propertyId]/reports/requests/page.tsx`, `app/property/[propertyId]/reports/[importId]/page.tsx`, `frontend/components/shared/ExecutiveSummaryPanel.tsx` | Keep until the owning workflow is deliberately consolidated. |
| `exceljs` | `app/(dashboard)/[orgId]/properties/[propertyId]/guest-requests/page.tsx`, `app/api/aop/export/route.ts`, `app/api/properties/[propertyId]/water/export/route.ts` | Keep until the owning workflow is deliberately consolidated. |
| `fluent-ffmpeg` | `backend/lib/whatsapp/processMessage.ts` | Keep until the owning workflow is deliberately consolidated. |
| `framer-motion` | `app/(auth)/forgot-password/page.tsx`, `app/(auth)/login/page.tsx`, `app/(auth)/reset-password/page.tsx` | Keep until the owning workflow is deliberately consolidated. |
| `gsap` | `frontend/components/landing/ScrollVideoLanding.tsx` | Keep until the owning workflow is deliberately consolidated. |
| `pdfjs-dist` | `backend/lib/documentBank/ocr.ts`, `backend/lib/electricity/billOcr.ts`, `backend/lib/ocr/rasterize.ts` | Keep until the owning workflow is deliberately consolidated. |
| `pg` | `scripts/run_approval_migration.js`, `scripts/run_hr_migrations.js`, `scripts/run_property_budgets_migration.js` | Keep until the owning workflow is deliberately consolidated. |
| `qrcode` | `scripts/fix-battery-pdf.js`, `scripts/generate-ss-plaza-asset-qr.js` | Keep until the owning workflow is deliberately consolidated. |
| `react-liquid-gauge` | `frontend/components/diesel/LiquidDieselGauge.tsx` | Keep until the owning workflow is deliberately consolidated. |
| `recharts` | `Commercial Calculator/Claude Commercial Calculator.tsx`, `frontend/components/aop/AopTrendChart.tsx`, `frontend/components/assets/AssetReportsView.tsx` | Keep until the owning workflow is deliberately consolidated. |
| `sharp` | `app/api/procurement/catalog/import/preview/route.ts`, `app/api/properties/upload-image/route.ts`, `app/api/properties/[propertyId]/sop/checklist-items/[itemId]/reference-photo/route.ts` | Keep until the owning workflow is deliberately consolidated. |
| `xlsx` | `app/api/crm/import/route.ts`, `app/api/ppm/upload/route.ts`, `app/api/procurement/catalog/bulk/route.ts` | Keep until the owning workflow is deliberately consolidated. |

Choosing one chart/export/animation library could reduce dependency surface, but migration cost and feature differences must be measured. No bundle-size or security claim is made here.

## 6. Root-directory clutter and tooling

### R1. Historical outputs — Low to Medium cleanup risk

Tracked historical output exists at:
`lint_output.txt` (853,406 bytes), `lint_output_2.txt` (1,753,872), `orgadmin_lint.txt` (233,914), `orgadmin_lint_final.txt` (165,726), `notif_lint.txt`, `audit_output.txt`, `check_output.txt`, `check_output_full.txt`, `debug_output.txt`, `push.log`, and `tunnel.txt`.

These are output/archive candidates, not application source. Inspect retention and sensitive operational content privately before a later removal. No secret-bearing contents were reproduced in this report.

Do not lump `Errors before go live.txt` or `QA_CHECKLIST_PHASES_0-3.txt` into disposable logs: they contain project QA knowledge. Preserve their useful content in docs/qa if cleanup is authorized.

`output.json` and `audit.json` have explicit script references. `roles.json` and `lint_errors.json` have no consumer found beyond generated inventories. Treat JSON separately from generic log cleanup.

Generated `.next/`, `node_modules/`, and `tsconfig.tsbuildinfo` are already ignored. Removing local caches saves disk space, not maintained source LOC. No cache was deleted.

### R2. Ad hoc scripts — Medium to High cleanup risk

Examples:
- Diagnostics: `check_amr.js`, `check_amr2.js`, `check_amr3.js`, `check_db.js`, `check_rls.js`, `check_sop_rls.js`, `check_ticket.js`, `check_ticket_v2.js`, `check_user.js`, `check_user_v2.js`, `test_fks.js` through `test_fks4.js`, `sc.ts`, `sc2.ts`, `debug_procurement.ts`.
- Patching scripts: `add_selected_date_state.js`, `add_sop_date_filter.js`, `cleanup_ui.js`, `finalize_sop_ui.js`, `fix_history_props_ui.js`, `fix_history_props_ui_v2.js`, `fix_is_due_transition.js`, `fix_is_due_transition_v2.js`, `inject_historical_missed.js`, `inject_historical_missed_v2.js`, `update_completed_ui.js`.
- Database/operational helpers: `apply.js`, `run_water_sql.js`, `tmp_fix_templates.js`, root loose SQL files, and numerous scripts/ runners.

They are not Next route entries and no package script schedules the named root helpers, but manual invocation remains possible. Several diagnostics import the missing `./frontend/utils/supabase/admin.js` path; the actual privileged client is `backend/lib/supabase/admin.ts`. This is evidence of stale tooling, not permission to execute or rewrite it.

Future action: classify read-only diagnostics, mutation tools, import/export tools, historical one-time patches, and regression tests. Keep maintained diagnostics under scripts/diagnostics; archive superseded patches with provenance; preserve data/migration history. Document working directory assumptions before moving anything.

### R3. Documentation, reference material, and independent projects

- Root walkthrough/task/implementation-plan Markdown should be indexed or archived under docs, after checking references.
- Keep CLAUDE.md, repository instructions, component contracts, and documentation required by those instructions discoverable.
- `AI Agents Handbook .pdf` is explicitly referenced by doctrine; move only with reference updates and an approved storage plan.
- `Commercial Calculator/` has two distinct TSX prototypes totaling 1,257 lines. It is ignored and excluded from type-checking, but referenced in COST_INTELLIGENCE_SPEC. This is future feature/reference work, not verified waste.
- `ai-orchestrator/` is a separate Express package with its own manifest/lockfile/start command; lack of Next imports does not make it dead.
- `evals/` is linked by EVAL.md. Preserve evaluation assets.
- `sample_images/` has no directory-string consumer found, but individual asset/external/manual uses were not exhaustively established. Review before archiving.
- Root office/business documents are not application code. Some are tracked despite .gitignore patterns; ignoring a previously tracked file does not untrack it.

### R4. Development routes and public previews — Medium to High risk

Actual routable folders include `app/design-lab/`, `app/cc-preview/`, `app/loader-test/`, `app/simple-test/`, and `app/test-loader/`. They are **active framework routes**, even if no menu links to them.

Public preview files include `public/email_preview.html` and `public/test-image.html`; public files are addressable by URL without imports.

Recommend deciding which previews belong in deployed environments, checking protection/external links, then retiring or isolating them in a separate task. Keep privacy/terms/data-deletion routes and public worker/manifest assets; these may be required by integrations or browser conventions.

## 7. Oversized files and components

These are measured, active-or-review source files. **Large files are refactoring candidates, not deletion candidates.**

| File | Physical lines | Bytes |
|---|---:|---:|
| `app/tickets/[ticketId]/page.tsx` | 5,033 | 248,015 |
| `frontend/components/dashboard/OrgAdminDashboard.tsx` | 4,553 | 273,944 |
| `frontend/components/task-manager/TaskManagerTestingDashboard.tsx` | 3,699 | 214,827 |
| `frontend/components/dashboard/MasterAdminDashboard.tsx` | 3,110 | 178,694 |
| `backend/services/NotificationService.ts` | 3,079 | 155,218 |
| `frontend/components/dashboard/PropertyAdminDashboard.tsx` | 2,694 | 171,513 |
| `backend/services/WhatsAppEventProcessor.ts` | 2,629 | 144,473 |
| `frontend/components/admin/OmnichannelNotificationSettings.tsx` | 2,530 | 164,909 |
| `frontend/components/hr/HRTicketsContent.tsx` | 2,327 | 157,876 |
| `frontend/components/agents/AgentConsole.tsx` | 2,062 | 101,694 |
| `frontend/components/procurement/CatalogManagerTable.tsx` | 1,943 | 113,468 |
| `frontend/components/agents/AgentCredentials.tsx` | 1,814 | 87,462 |
| `app/property/[propertyId]/reports/requests/page.tsx` | 1,812 | 105,722 |
| `frontend/components/hr/HREmployeeDirectory.tsx` | 1,722 | 112,778 |
| `frontend/components/task-manager/TaskAssignmentDashboard.tsx` | 1,699 | 103,303 |
| `frontend/components/hr/HRTicketDetailModal.tsx` | 1,643 | 130,840 |
| `frontend/components/agents/AgentTriView.tsx` | 1,637 | 75,298 |
| `frontend/components/dashboard/ProcurementDashboard.tsx` | 1,608 | 100,607 |
| `frontend/components/crm/LeadDetailDrawer.tsx` | 1,600 | 106,174 |
| `frontend/components/dashboard/MstDashboard.tsx` | 1,595 | 88,123 |
| `frontend/components/sop/SOPChecklistRunner.tsx` | 1,584 | 93,597 |
| `frontend/components/procurement/ProcurementCatalogModal.tsx` | 1,566 | 110,328 |
| `frontend/components/hr/HROrgChartTree.tsx` | 1,526 | 91,576 |
| `frontend/components/electricity/ElectricitySpreadsheetLogger.tsx` | 1,483 | 87,817 |
| `frontend/components/dashboard/TenantDashboard.tsx` | 1,470 | 85,320 |
| `backend/services/EmailService.ts` | 1,456 | 89,657 |
| `frontend/components/dashboard/UserDirectory.tsx` | 1,451 | 91,195 |
| `frontend/components/dashboard/StaffDashboard.tsx` | 1,393 | 82,395 |
| `frontend/components/agents/AgentReinforcement.tsx` | 1,392 | 65,966 |
| `frontend/components/procurement/MonthlyRequisitionsTab.tsx` | 1,313 | 85,019 |
| `frontend/components/diesel/DieselSpreadsheetLogger.tsx` | 1,311 | 82,288 |
| `frontend/components/dashboard/SuperTenantDashboard.tsx` | 1,303 | 80,682 |
| `frontend/components/crm/ExecutiveImpactReport.tsx` | 1,297 | 65,360 |
| `app/api/agents/registry/route.ts` | 1,209 | 56,870 |
| `backend/services/EventProcessor.ts` | 1,206 | 59,839 |

### Priority extraction plan — High refactor risk

| Files | Responsibilities to separate | Required preservation checks |
|---|---|---|
| `app/tickets/[ticketId]/page.tsx` | Route wrapper, ticket loading/mutations, action permissions, activity/comments, media, materials, and section UI. | Role-specific actions, ticket state transitions, SLA handling, uploads, navigation. |
| OrgAdminDashboard, MasterAdminDashboard, PropertyAdminDashboard | Shared shell/navigation primitives, role configuration, individual tabs, selectors/modals, query hooks. | Same URL/tab behavior, role gating, tenant/property scope, sign-out and drawer behavior. |
| TaskManagerTestingDashboard | Test-lab panels and scenario editors separated from operational state. | Existing uncommitted voice/task work and evaluation workflows. |
| NotificationService, WhatsAppEventProcessor | Channel adapters, rendering/templates, event handlers, delivery/retry orchestration. | Delivery deduplication, outbox semantics, scheduled processing, recipients and template contracts. |
| OmnichannelNotificationSettings | Independent channel forms, template tools, anomaly panes. | Notification tests, credentials boundaries, settings persistence. |
| HRTicketsContent, HREmployeeDirectory, HRTicketDetailModal | Query/filter logic, list/board/detail presentation, reusable domain types. | Employee scope and HR-specific permissions; do not blindly merge with facility tickets. |
| CatalogManagerTable, ProcurementCatalogModal | Import preview, row editing, pagination/search, upload helpers. | Item/unit integrity and requisition/catalog workflows. |
| AgentConsole and large agent panels | Tab composition, draft hooks, focused controls, shared display widgets. | Existing agent doctrine, spec blocks, credential boundaries, draft/evaluation contracts. |

Extraction normally improves maintainability without reducing total LOC immediately. Real line reduction comes from removing obsolete alternatives and sharing demonstrated repeated logic. Do not strip useful comments, tests, or domain rules to hit a line-count target.

## 8. Architectural issues

| ID | Verified evidence / affected areas | Cleanup/refactor risk | Recommendation |
|---|---|---|---|
| A1 | Server session factory lives in `frontend/utils/supabase/server.ts`, imported throughout API/backend access modules; privileged client is separately in backend/lib. | High | Centralize browser/server/admin clients with explicit boundary naming and server-only ownership. Preserve cookie and RLS behavior. |
| A2 | Broad aliases map @/* to project root; @lib maps to backend/lib, while frontend/lib and root lib also exist. | Medium | Use a small set of explicit feature/shared/server aliases; migrate incrementally rather than globally rewriting imports. |
| A3 | Frontend components import backend utilities/domain helpers, e.g. deprecated ticket cards and shared utility patterns. These are not all privileged imports, but ownership is unclear. | High | Separate pure domain types/utilities from server-side implementations. Review actual client bundles before asserting a server-code leak. |
| A4 | AuthContext and useAppSession coexist; multiple caches and independent dashboard fetching/state patterns exist. | High | Establish one session authority and document derived hooks/cache ownership. Preserve expiry, role switching, and logout invalidation. |
| A5 | Many large API handlers own orchestration directly; app/api/agents/registry/route.ts alone is 1,209 lines. Other domain access helpers already exist. | High | Make handlers thin and extract into their existing domain services; reuse access helpers before creating parallel abstractions. |
| A6 | SQL lives in supabase/migrations, backend/db/migrations, backend/db/schema, sql, scripts/migrations, and root. SQL linter scans two migration roots. | High | One authoritative forward-migration location, explicit legacy history and schema snapshots; no automatic deletion/replay/squashing. |
| A7 | `task-manager/`, `brain/`, `backend/lib/agents/`, and council/IRA/WhatsApp modules have distinct but related boundaries. | High | Document ownership and contracts before consolidation. Names or similar “brain/router” responsibilities are insufficient evidence of duplication. |
| A8 | tsconfig broadly includes all TS/TSX/MTS, excludes scripts and task-manager/tests, but can still include root scratch TS and the standalone package's TS files. allowJs is enabled. | Medium | Separate application/tool/test configs if authorized, preserving Next-generated types and all test compilation mechanisms. |
| A9 | ESLint only explicitly ignores standard build outputs; scripts/tests/prototype scopes have no tailored configuration. | Medium | Define lint targets by ownership; do not hide failing production source behind broad ignores. |
| A10 | Next routes, tests, UI previews, ops scripts, and business documents share the root project with inconsistent organization. | Medium | Keep framework/config at root, organize maintained tooling/docs, isolate standalone applications without forcing a monorepo toolchain. |

## 9. Recommended scalable directory structure

This is a target design, not an instruction to move everything immediately. It fits the existing single Next.js application and keeps its current routing model.

```text
saas_one/
├── src/
│   ├── app/                         # Next pages/layouts and thin API adapters
│   │   ├── (auth)/
│   │   ├── (dashboard)/
│   │   ├── org/[orgId]/
│   │   ├── property/[propertyId]/
│   │   ├── tickets/[ticketId]/
│   │   └── api/
│   ├── proxy.ts                     # Same-level Next proxy convention
│   ├── features/
│   │   ├── tickets/
│   │   │   ├── components/
│   │   │   ├── hooks/
│   │   │   ├── types.ts             # Pure domain types
│   │   │   ├── validation.ts        # Pure validation
│   │   │   └── server/              # Access, queries, mutations
│   │   ├── dashboards/
│   │   ├── crm/
│   │   ├── procurement/
│   │   ├── finance/
│   │   ├── petty-cash/
│   │   ├── utilities/
│   │   ├── hr/
│   │   ├── visitors/
│   │   ├── assets/
│   │   ├── sop/
│   │   └── task-manager/
│   ├── shared/
│   │   ├── ui/                      # Truly cross-feature primitives
│   │   ├── layouts/
│   │   ├── providers/
│   │   ├── hooks/
│   │   ├── types/
│   │   └── utils/                   # Pure/client-safe helpers
│   ├── lib/
│   │   └── supabase/
│   │       ├── browser.ts
│   │       ├── server.ts
│   │       └── admin.ts             # Privileged, server-only
│   └── server/
│       ├── integrations/            # Email, Firebase, Zoho, WhatsApp, LLM
│       ├── agents/                  # Shared agent runtime infrastructure
│       ├── jobs/                    # Cron/workers; API cron routes call here
│       └── observability/
├── public/                          # Stable URLs, manifest/workers/assets
├── supabase/
│   ├── migrations/                  # Canonical future migration stream
│   └── schema/                      # Clearly dated schema snapshots
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── browser/
│   └── fixtures/
├── scripts/
│   ├── diagnostics/                # Maintained read-only diagnostics
│   ├── imports/
│   ├── exports/
│   └── maintenance/                # Explicitly documented privileged tooling
├── tools/
│   └── ai-orchestrator/             # Own package; only if retained
├── prototypes/                     # Excluded, documented reference designs
├── docs/
│   ├── architecture/
│   ├── features/
│   ├── decisions/
│   ├── plans/
│   ├── qa/
│   └── archive/
├── evals/                           # Preserve existing eval entry contracts
├── package.json
├── package-lock.json
├── next.config.ts
├── tsconfig.json
├── eslint.config.mjs
├── vercel.json
├── CLAUDE.md
└── CODEBASE_AUDIT.md
```

### Mapping from existing directories

| Current location | Target ownership |
|---|---|
| app | src/app; keep route segments, public URLs, and cron paths unchanged during structural migration. |
| frontend/components/domain + frontend hooks/lib | Relevant src/features/domain; share only demonstrated common primitives. |
| frontend/context | src/shared/providers, with feature-specific providers kept inside features. |
| backend/lib/domain + backend/services/domain | src/features/domain/server; cross-domain integrations/jobs in src/server. |
| frontend/utils/supabase + backend/lib/supabase | Explicit src/lib/supabase boundary. |
| root lib/mcp-client.ts | src/server/integrations if its consumers are server-only; verify before moving. |
| task-manager/brain, brain, backend agent runtime | Keep distinct contracts initially; relocate only after dependency/entrypoint map is agreed. |
| Existing migration roots | Preserve applied history; canonicalize future work before any historical consolidation. |
| Root walkthroughs/scratch outputs | docs/archive or approved local output storage, after reference review. |

Rules:
- Features may import shared primitives; shared code should not depend on a feature.
- Client components must not import privileged server modules. Use explicit server-only boundaries when implemented.
- Do not export client and privileged server code from the same barrel.
- Keep browser imports small; use direct imports or narrow barrels.
- A single-file helper does not need a framework-sized abstraction.
- Keep Next route wrappers thin, but keep trivial pages inline.
- src migration is optional: these ownership improvements can begin inside frontend/backend first. Currently tsconfig explicitly excludes src, so it must be updated in the same authorized migration; a partial move without config changes would be unsafe.
- No Nx/Turborepo/new state library is required by this recommendation.

## 10. Phased cleanup/refactoring roadmap

| Phase | Scope | Risk | Exit criteria |
|---|---|---|---|
| 0 — Baseline and ownership | Preserve uncommitted work; agree candidate owners; inventory route/asset/cron/public URLs, manual commands, migration deployment history, and test source readers. | Low | Explicit keep/remove/archive decision for each batch; no secret/business artifacts copied into reports. |
| 1 — Historical outputs | Archive/remove approved lint/debug outputs and the reference-free root test image; organize docs without losing contracts. | Low–Medium | No broken script/doc path references; diff contains only approved artifacts. |
| 2 — Isolated UI candidates | Begin with deprecated cards and small no-caller wrappers, then review other D1 candidates in domain batches. | Low–Medium | Re-run import/text checks; type-check/lint and relevant role smoke tests; preserve active children/helpers. |
| 3 — Dependency hygiene | Remove P1 candidates individually; review P2 package ownership/types; update only existing npm manifest/lockfile. | Medium | Clean install/build in an authorized environment; no missing ambient types, external binaries, or worker assets. |
| 4 — Feature islands | Decide restore/retire for widgets, MST, CRM views, old dashboards and planned petty-cash components. | Medium–High | Tests/docs updated; behavior and persisted data preserved; external API callers reconciled. |
| 5 — Active components | Extract ticket page, dashboard shells/tabs, notification/channel logic, and large admin panels one at a time. | High | Characterization checks pass; no role, scope, navigation, timing, delivery, or submission changes. |
| 6 — Directory boundaries | Migrate one feature at a time; move Supabase boundary separately; optionally adopt src after alias/config coordination. | High | No mixed client/server barrels; stable API/public paths; all retained script/test entrypoints work. |
| 7 — Migration/tool governance | Canonical future migrations, documented legacy map, maintained operational command registry. | High | Deployment history reconciled; no replay/squash/delete undertaken without separate approval. |

### Validation commands for a future authorized cleanup

The audit did not execute these or install packages.

- Type-check without generating artifacts: `node --max-old-space-size=8192 node_modules/typescript/bin/tsc --noEmit --incremental false --pretty false`.
- Scoped ESLint using the installed executable and specific changed paths, without --fix.
- Use relevant existing suites: test:users, test:dashboard, test:petty-cash, test:accounts, test:requisition-drafts, test:whatsapp.
- Review each test before execution: some scripts may use services or create data; browser commands may fetch esbuild.
- SQL lint after an approved migration-file reorganization; do not run migration execution scripts.
- Build only in a separately authorized implementation/validation task; it writes .next.
- Verify no route/cron/asset URL was lost simply because it lacks an import.

### Useful success measures

Track removed maintained-source lines, file count per owned feature, active component size, direct dependency count, test/build duration, and broken-reference count separately. Moving files improves organization but does not reduce LOC. Removing generated logs, ignored prototypes, or node_modules should not be reported as reducing application source.

Do not set a numeric deletion target before reviewing candidate ownership and validation results.

## 11. Keep list and final safeguards

Explicitly preserve until separately verified:
- Every Next route/layout and externally consumed API, including Vercel cron routes.
- AuthContext, active session/client factories, access helpers, RLS and permission logic.
- Applied migrations/schema history and seed/reference data needed for reproducibility.
- Active public logos, loader image, PDF worker, Firebase/service workers, and manifest.
- Domain types/ambient declarations with compiler-only uses.
- Tests and fixtures, including those reading apparently obsolete source.
- CLAUDE.md, doctrine/contracts, evals, and referenced reference material.
- Independent ai-orchestrator package and Commercial Calculator prototypes until their owners decide their future.
- All existing uncommitted voice/task-manager work.

**No deletion, dependency removal, code movement, refactoring, package installation, or database operation was performed.** This report distinguishes cleanup candidates from confirmed active assets and high-risk architectural work; it is a reviewable plan for a future authorized change.

