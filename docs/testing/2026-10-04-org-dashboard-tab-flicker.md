# Organization dashboard tab stability and Petty Cash shells

Recreated locally on 5 October 2026 on `feat/petty-cash-allocation-wallet`. Historical commit objects were unavailable, so current role dashboards were extended without replacing their established navigation.

## Behavior

OrgAdminDashboard derives its active tab from the validated URL search parameter. Invalid/bare values resolve to Overview; existing ops restrictions remain. Removed competing state setters, localStorage restoration and mount-time history writes. User tab changes preserve unrelated parameters, use history entries with null state, and never manually copy Next.js __NA/_N markers. Subordinate request filters still restore from the URL.

The parent dashboard layout keeps PettyCashShell mounted across Dashboard ↔ Petty Cash. DashboardContentSlot replaces only the main body inside the existing role dashboard. Petty Cash sits in Management Hub and has active navigation state. Accounts users retain their established finance sidebar; internal FMS roles retain their FMS sidebar. Eligible BD roles use their established shared BD sidebar. Property-only memberships resolve their organization from the selected property's verified membership. Roles and redirects use the selected organization. Mixed external/internal membership users use an eligible internal shell for Petty Cash, while external-only users remain denied.

## Regression commands

```sh
npm run test:dashboard
npm exec --package=esbuild -- node --test --test-isolation=none tests/dashboard/org-tab-browser.test.mjs
```

The six focused tests cover URL validation, history without copied framework state, source ownership of active tabs, mixed internal/external shell scope, property-only navigation and selected-organization role/redirect context.

The browser fixture renders actual parent layout and role dashboard/sidebar components under React StrictMode at desktop/mobile widths. It mocks authentication, Supabase, auxiliary data and child module content, with no outbound messages or live records. Cases cover initial grievance URL, stale localStorage ignored, overview/grievance changes, preserved query parameters, refresh and Back/Forward, sidebar DOM persistence, mobile closing, direct Petty Cash loads, active links, and external-role denial. It exercises org/ops super admin, property admin, accounts, staff, MST, security, soft-service manager, procurement, master admin and BD. Current passing counts are recorded in petty-cash-recreation-local.md after integration.

Browser fixtures provide a controlled Next navigation boundary; they do not establish behavior of an authenticated live Next/Supabase deployment. Manual acceptance should repeat the documented flow in an authorized isolated preview database. No deployment or migration application occurred.
