# Monthly requisition drafts

Branch: `feat/monthly-requisition-drafts`, based on main commit `f5487e2`.

The creation sheet now has Save Draft / Save Changes, automatic browser backup,
debounced online saving, and a Resume saved draft selector. Reopening the sheet
for a property restores its most recently edited draft. The selector can resume
another saved month/floor. Quantities, available stock, custom lines and notes
are included. Current catalog prices replace matching restored row prices;
submission still uses the existing server-side price validation and workflow.
Drafts accept existing free-text catalog categories, including custom or older
labels, and preserve incomplete rows. Category differences must not prevent
quantities from being saved. Submission checks remain separate.

Drafts are private to their creator. Separate keys isolate users, organizations,
properties, months, years and floors. They are stored in a separate table and do
not become submitted requisitions, affect approval counts, generate Excel files,
or trigger notification events. Existing submitted requisitions are unchanged.

## Deployment

Apply `supabase/migrations/20261005000001_monthly_requisition_drafts.sql` before
deploying this branch. It adds the private draft table and scoped row-level
policies; it does not modify existing requisition rows or triggers. This migration
has been tested only in isolated PGlite, not applied to production.

Without the migration or during a network failure, browser backup can preserve
recent edits on the same device. Online Save Draft cannot succeed until the table
exists and access is granted. The status banner explicitly reports failures.
Successfully saved online drafts can be resumed on another device after login.

Browser backups use localStorage, so shared-device browser storage can contain
the user's unfinished entries. User-specific keys avoid restoring another account's
draft in the app; storage isolation is not encryption. Browser storage restrictions,
clearing browser data or private browsing can remove unsynced backups.

Concurrent saves use the prior server timestamp. A stale session receives a
conflict instead of overwriting another session's draft. The user can explicitly
reload the online version after reviewing the warning. Queueing saves prevents
older same-session requests from overwriting later edits. After successful
submission, matching local and online copies for that month/floor are removed;
newer edits from another tab are preserved. Form fields are disabled during
loading and submission to prevent restore or cleanup races. Failed
submission retains the draft. Draft cleanup failure does not change a successful
submission into a failure; a stale draft may remain if cleanup cannot reach the
server. Such a draft is work in progress and never a new submitted request by itself.

## Verification

Install dependencies including dev dependencies, then run:

```sh
npm run test:requisition-drafts
npm run lint:sql
node --max-old-space-size=6144 node_modules/typescript/bin/tsc --noEmit --incremental false
```

Tests cover incomplete entries, storage scope, RLS ownership and revoked access,
leaving before the debounce finishes, resuming browser edits, manual save,
network failure/retry, field reversions, preservation of another tab's offline
edits during submission cleanup, and concurrent-version conflict recovery.
Tests also cover autosaving free-text catalog categories and restoring October
from the cloud in November with no browser backup. The hook tests run the
production hook in React's test renderer; SQL tests use the actual
migration in an isolated database. A live deployed browser acceptance test is
still needed after migration.

Known baseline checks on current main: the requisition sheet has pre-existing
lint errors/warnings; this change adds no new findings. The WhatsApp suite has
seven pre-existing route-test failures because its harness lacks the new
`@/task-manager/TaskMessageRouter` import. This branch does not change those files.
