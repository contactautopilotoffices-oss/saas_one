# Review Petty Cash before production merge

Source branch: `feat/petty-cash-allocation-wallet`. The user authorized pushing this branch and wants to review it before a production merge. Keep the PR in draft and do not merge or enable auto-merge as part of preview review.

## Open the preview

The repository has an active Vercel integration for project `saas-one` in team `autopilot-offices-projects` (confirmed from the feature branch's existing successful Vercel commit status).

1. Open the feature PR on GitHub. Its Vercel bot comment normally shows **Visit Preview**. The Vercel check's **Details** link opens deployment status/build logs.
2. Alternatively, open Vercel → `saas-one` → Deployments, filter branch `feat/petty-cash-allocation-wallet`, and choose the latest successful **Preview** deployment matching the PR head commit. Use **Visit** to open its generated URL.
3. Sign in using an authorized account. Open `/<organization-id>/petty-cash`, or Management Hub → Petty Cash. Review Dashboard ↔ Grievance and User Directory as well.

A feature-branch push can trigger its preview when Vercel Git previews are enabled. A merge into the configured Production Branch can trigger production. Verify the Production Branch in Vercel's Git settings; this workspace cannot inspect those account settings. GitHub's default branch is `main`, but that alone does not prove Vercel's production-branch setting.

## Database preparation

This project's Preview environment uses the same Supabase database as production, as confirmed by the user. The user authorized reviewing this branch against that database. Preview isolates the application deployment; payment, expense, routing and membership actions still save to the shared database.

The previously reviewed Petty Cash migrations are required for the workflow. Apply only pending migrations; the UI/search/primary-routing update adds no SQL migration and changes no storage buckets. The separate membership-approval migration concerns User Management, not the Petty Cash UI update.

Configure the allocator and approver from Property Routing using an org or ops super admin account. Each dropdown has its own search. The actors must be different. Saving a property's routing clears that property's old backup selections, while existing request assignments remain intact until explicitly reassigned.

Local automated checks use isolated PGlite fixtures and Chromium, including proof uploads; they never write to the shared Supabase database.

## Review and release

Test the requester → allocator → approver → accounts Paid → wallet → expense-with-proof flow. Retry payment/expense actions and verify one credit/debit, no negative balance and zero balance/proof-complete replenishment before finance closure. Check role-specific sidebars, Payment Tracker separation, mobile/direct links/refresh/history, pending directory rows, failed fetch Retry, cross-scope denial and scoped approvals. Petty-cash outbound notifications remain disabled.

After preview acceptance, deploying this code to production remains a separate decision requiring an explicitly authorized merge/deployment. No merge, production promotion or database migration occurs merely by creating the draft PR in this task.
