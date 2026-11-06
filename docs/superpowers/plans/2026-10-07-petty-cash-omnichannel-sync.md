# Petty Cash Omnichannel sync

User scope: connect the seven live WhatsApp campaigns to Petty Cash Omnichannel settings, choose email/WhatsApp, roles and specific users, and send only through transactional event outbox processing. Work on feat/petty-cash-allocation-wallet. No live SQL/settings/messages, merge or production deployment in this implementation.

The execution environment was replaced on 7 October; prior unpushed UI/catalog/link files were unavailable. Recreate these from the agreed template contracts without changing the existing pushed financial workflow.

1. Shared fifteen-event/seven-template registry, module sections, disabled configuration defaults, editable live campaign import, specific internal user search. Preserve other modules and explicit property overrides.
2. Petty Cash-only SQL migration: typed expense audit IDs; audit-trigger snapshots and outbox event uniqueness; strict current-access recipient RPC; durable per-event/destination/channel deliveries and lease claim. No historical replay or unrelated bucket/membership changes.
3. Central service: read current UI rules on enqueue and delivery, exact task actors, authorized roles/users, mapped template parameters, authenticated request links using supplied domain. Durable channel status, retry of explicit failures only, ambiguous sends require reconciliation. Legacy financial notification hook and its route/action calls are removed. Existing processors route Petty Cash events to this service.
4. Isolated SQL/service/browser fixtures verify event lifecycle, optional receipts, multiple expenses, disabled/empty overrides, unrelated/inactive membership exclusion, exact assignments, channels, user selection, persistence, dedup and retries. Typecheck and existing Petty Cash checks.

Ruling: live template approval is user-reported; actual API campaign names remain editable and are imported explicitly in the UI. Do not overwrite existing campaign mappings or enable recipients/channels automatically.
Ruling: the audit trigger creates the authoritative snapshot in the financial transaction. Expense functions only add the exact expense ID to existing audit metadata, avoiding guessed expense identity or duplicate independent hooks.

Progress: implemented locally on the restored branch at c13b4ed. Shared catalog/configuration, transactional SQL outbox, strict recipients, durable delivery, module templates, request links and pending counts are present. Isolated verification: 48 existing regression tests, 11 notification tests, 8 wallet browser tests, 2 desktop/mobile Omnichannel browser tests and 1 request-link browser test pass. TypeScript verification and git diff --check pass.

Fresh code review identified two issues, both fixed with regression tests: malformed custom Email content must not block WhatsApp, and older action-required messages must be skipped when a newer request version supersedes their task. No live SQL, saved settings, messages, push or deployment performed. Setup instructions: docs/petty-cash-omnichannel-setup.md.
