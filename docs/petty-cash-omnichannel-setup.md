# Petty Cash Omnichannel setup

Local branch: `feat/petty-cash-allocation-wallet`. This change does not activate live messages or modify saved organization settings automatically.

## Database

Apply the existing Petty Cash workflow migrations first. Apply these new migrations in order if not already applied:

1. `supabase/migrations/20261006000001_petty_cash_pending_counts.sql`
2. `supabase/migrations/20261007000001_petty_cash_omnichannel.sql`
3. `supabase/migrations/20261007000002_petty_cash_push_notifications.sql`

The notification migration adds Petty Cash audit-trigger outbox events, recipient authorization and delivery tracking. It preserves optional bills and partial expenses. It does not change buckets, organization memberships or ticket notification settings. Existing requests are not replayed as notifications.

## Organization Super Admin configuration

Open **Omnichannel → Petty Cash → Templates**. Import the seven live campaign names, check that these are the actual AiSensy API campaign names and edit any that differ. Click **Save Campaign Templates**. Fifteen event mappings share seven approved templates. Importing does not enable channels or recipients.

Email uses the built-in event templates unless a custom template is saved in the same section. Named variables are escaped; unknown variables fail delivery. The ticket templates remain in the Tickets section.

Open **Channel & recipient rules**, select Email, WhatsApp and/or Push for each event, then select roles or search for specific internal users. Contextual recipients such as Assigned Allocator, Assigned Approver and Requester are explicit opt-ins. Click **Save Settings**. A specific user must still have active access and be eligible for that event: an allocation alert goes to its assigned allocator, approval to its assigned approver, and Accounts actions to authorized Accounts users. Selecting a name never grants financial permissions.

Property overrides inherit unspecified settings; explicitly empty recipient lists and disabled channels suppress delivery.

## Runtime

Notification links use `https://fms-dev-saas-one.vercel.app/{organization_id}/petty-cash?request_id={request_id}`. An authenticated user must retain request access. Override the application origin with `PETTY_CASH_APP_URL` if deploying elsewhere.

Use the project's existing outbox webhook/sweeper and email/AiSensy provider credentials. Configure `CRON_SECRET` for the new delivery retry cron. These secrets are not included in source or SQL.

Delivery status appears in the Petty Cash Omnichannel section. Sent channels are deduplicated; explicit failures retry up to three attempts. Unknown provider outcomes are marked **ambiguous** and require provider reconciliation before any manual resend. Channels and recipient access are rechecked before each send. Financial API notification hooks have been removed; only the database activity trigger creates notification events.

## Verification

- `npx tsc --noEmit`
- `npm run test:petty-cash`
- `npm run test:petty-cash:notifications`
- `npm run test:petty-cash:browser`
- `npm run test:notifications:browser`

Browser and notification tests use isolated database/provider fixtures, not production accounts or live messages.

Push uses the existing Firebase device service and standard in-app notifications. Users without an active registered device retain the in-app notification. Each event/user has a stable notification ID; duplicate processing preserves read state and skips devices already sent. Unknown device outcomes require reconciliation. The Push migration only extends the delivery channel constraint; the original database outbox trigger covers Push as well.
