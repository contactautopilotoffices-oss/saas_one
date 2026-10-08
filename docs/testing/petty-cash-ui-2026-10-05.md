# Petty Cash UI and primary routing review

Branch: `feat/petty-cash-allocation-wallet`.

The page uses the app's shared buttons and theme tokens, a compact header and wallet cards, scrollable navigation, consistent tables/status badges/pagination, and clear loading/empty/error states. Request dialogs, action forms, uploads and activity history share the same field and button styles. Overview filters and My Expenses follow the same presentation.

Property Routing has independent searchable Property, Allocator and Approver dropdowns. User search matches names, emails and returned membership information. Keyboard arrows/Enter select options, Escape restores focus, and outside clicks close the dropdown. Changing allocator to the current approver clears the approver selection so the roles can be swapped without a third user. Saving requires two distinct, eligible users.

Backup controls are removed from routing and reassignment. A routing save submits empty backup arrays through the existing API, clearing old backup configuration for that property. Existing request assignments stay intact until an admin explicitly reassigns them. The database schema and historical compatibility remain unchanged; this update needs no additional SQL or bucket changes.

## Verification

- `npm run test:petty-cash`: 45 regression checks passed using isolated fixtures.
- `npm exec --cache=/tmp/petty-cash-npm-cache --yes --package=esbuild -- node --test tests/petty-cash/browser.test.mjs`: four real React/Chromium checks, including 1440px and 390px request-to-expense lifecycles, searchable primary routing and removal of prior backups, draft/property edits, inactive-user repair and explicit reassignment.
- `node --max-old-space-size=8192 node_modules/typescript/bin/tsc --noEmit --incremental false`: static TypeScript check.
- `git diff --check`: whitespace check.

The browser tests compile the real application stylesheet and use disposable PostgreSQL-compatible PGlite databases. Desktop/mobile screenshots were reviewed for spacing, tab labels, dropdowns, table containment and modal placement. These checks perform no live Supabase writes or outbound notifications. The authorized Vercel Preview continues to use the shared production database.
