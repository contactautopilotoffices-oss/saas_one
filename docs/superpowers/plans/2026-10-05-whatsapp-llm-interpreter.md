# Shared WhatsApp LLM Interpreter Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this
> plan task-by-task. Delegated execution is optional only when separately chosen;
> it is not needed to complete this planning request. Steps use checkbox syntax.

**Goal:** Understand natural WhatsApp requests, collect missing details and safely
create meeting-room bookings and facility tickets through existing app services.

**Architecture:** One durable inbound route, a structured LLM interpreter, a
conversation coordinator and a registry of authorized action adapters. Reuse
booking transactions, ticket classification/assignment and the existing outbox.
AiSensy Project API sends dynamic service replies inside its 24-hour window.

**Tech Stack:** Next.js/TypeScript, Zod, Supabase/PostgreSQL, the configured LLM
provider, existing AiSensy Project API and campaign integration.

**Spec:** `docs/superpowers/specs/2026-10-05-whatsapp-llm-interpreter-design.md`.

**Status:** Plan only. The implementation steps below are not completed by this
branch. Provider trust and live delivery verification are explicit pilot gates.

## Global constraints

- Initially registered mutation actions: `booking.create`, `ticket.create` only.
- `WHATSAPP_LLM_INTERPRETER_ENABLED=false` by default; org modes `off`, `shadow`, `pilot`.
- Initial timezone `Asia/Kolkata`, idle draft expiry 20 minutes, model timeout 8 seconds.
- Missing booking date defaults to `ask`; `today` requires explicit organization policy.
- Keep the existing booking confirmation step for the initial pilot.
- Photos optional; text-only tickets cannot wait for a photo.
- No public URL secret is introduced; verified ingress is required for new mutations.
- App identity, permissions, resource IDs and execution results are backend-owned.
- No arbitrary SQL, URLs, tools, unrestricted database reads or model-assigned roles.
- No duplicate mutations, credit deductions or requester completion messages on retries.
- No live migrations, production enablement or unrelated Task Manager feature changes.

## Review focus

1. A task context must not steal a booking answer such as `yes` or `cancel` (Task 8).
2. A worker crash between domain commit and conversation save must recover the same result (Tasks 3, 6, 7).
3. A company membership or property permission change during clarification must be rechecked (Tasks 2, 6).
4. An old quoted numbered list must not select a newly reordered room or another person's draft (Task 4).
5. A retried old webhook must not reopen the free-form window or generate a second completion (Tasks 3, 5, 8).

## Planned interfaces and file responsibilities

New files live under `backend/lib/whatsapp/interpreter/`, beside the existing
assistant. Keep feature-specific logic in adapters; do not put every feature in
one model prompt or enlarge `assistant/engine.mjs` into a generic agent loop.

| File | Responsibility |
|---|---|
| `contracts.ts` | Strict inbound/intent/action schemas and typed service contracts |
| `config.ts` | Global flag and validated per-org policy, without reading secrets into prompts |
| `actor.ts` | Verified ingress, account resolution and current permitted scope |
| `store.ts` | Events, separate conversation drafts, operation/result and reply persistence |
| `interpret.ts` | Structured intent/field extraction and model fallback |
| `registry.ts` | Allowlisted action lookup and adapter contract |
| `coordinator.ts` | Quote-aware routing, merging/corrections, collect/review/execute transitions |
| `reply.ts` | Fact-based questions, summaries and validation/access responses |
| `adapters/booking.ts` | Authorized room/date/slot/credit preparation and atomic booking execution |
| `adapters/ticket.ts` | Authorized issue/media preparation and existing ticket service execution |
| `backend/lib/llm/structuredChat.ts` | Shared configured-provider client with timeout and JSON handling |
| `backend/services/WhatsAppReplyService.ts` | Window-aware Project API send, provider IDs and delivery result |
| `backend/lib/whatsapp/createTicketFromWhatsApp.ts` | Domain-only wrapper/extraction of current ticket creation, never task routing |

Core types in `contracts.ts`: `InboundEnvelope`, `ActorContext`, `ParsedTurn`,
`Conversation`, `ActionPlan`, `PreparedAction`, `ActionOutcome`, `ReplyEnvelope`.
`InboundEnvelope` preserves project ID, message ID, sender, text/caption, validated
media, button, quoted IDs, sent timestamp and received timestamp.
`ActorContext` contains trusted user/organization/property scope and config version.
`ParsedTurn` permits only the two action IDs or null, intent kind, candidate fields,
ambiguity and evidence. It cannot contain arbitrary executable handlers or trusted IDs.

`PreparedAction` is a discriminated union: booking has resolved property/room/date/
start/end; ticket has resolved property, issue text and optional normalized media.
`ActionPlan` is `collect` (question/choices), `review` (prepared input), `ready`
(prepared input), or `deny` (neutral reason). `ActionOutcome` is a stored booking
or ticket reference plus notification ownership; it cannot be a model success claim.

```typescript
interpretTurn(input: InboundEnvelope, context: Conversation | null, actor: ActorContext): Promise<ParsedTurn>
resolveActor(input: InboundEnvelope, verification: ProviderVerification): Promise<ActorResolution>
prepareAction(actor: ActorContext, draft: Conversation): Promise<ActionPlan>
executeAction(actor: ActorContext, input: PreparedAction, operationId: string): Promise<ActionOutcome>
lookupOutcome(actor: ActorContext, operationId: string): Promise<ActionOutcome | null>
advanceConversation(input: InboundEnvelope, actor: ActorContext): Promise<ReplyEnvelope | null>
sendReply(reply: ReplyEnvelope): Promise<DeliveryResult>
```

`ProviderVerification` is established by a server-side verified integration, never
an inbound JSON boolean. `ActorResolution` is `verified`, `unknown`, `ambiguous`,
`requires_link` or `denied`; only `verified` supplies `ActorContext`. If supported
origin verification cannot be demonstrated, keep new mutation execution disabled
and document the integration required rather than implementing an always-trusted flag.

## Task 1: Structured interpretation and action/configuration contracts

**Files:** create `contracts.ts`, `config.ts`, `interpret.ts`, `registry.ts`,
`backend/lib/llm/structuredChat.ts`, `tests/whatsapp-interpreter-intent.test.mjs`;
modify `package.json` to add `test:whatsapp-interpreter` with explicit test files.

**Interfaces:** produces `ParsedTurn`, validated org configuration and
`interpretTurn(...)`; consumes existing provider request formats and the spec's
two action schemas. Adapters implement `prepareAction`, `executeAction` and
`lookupOutcome` through the registry.

- [ ] Write failing tests: natural booking request extracts `3 pm`/`4 pm` without
  inventing date/room/property; `floor lights aren't working` extracts an issue;
  captions, spelling mistakes, negation, `instead 4 to 5`, unknown actions, two
  actions and prompt-injection text yield the specified intent/ambiguity.
- [ ] Run `npm run test:whatsapp-interpreter`; verify missing implementation fails.
- [ ] Implement strict schemas, feature/config defaults and provider client;
  no mutation tools. Preserve candidate expressions for deterministic validation.
  Model timeout, invalid JSON/schema and missing credentials return guided fallback.
- [ ] Run the tests with recorded response fixtures; add a separately opt-in live
  model evaluation using approved text only. Do not call live providers in routine tests.
- [ ] Commit the independently tested interpretation layer.

## Task 2: Verified account and scoped authorization

**Files:** create `actor.ts`, `tests/whatsapp-interpreter-access.test.mjs`;
reuse `assistant/access.ts` without broadening existing role permissions.

**Interfaces:** produces `resolveActor(...)` and current `ActorContext`. Consumers
must resolve organization from permitted property/context before applying org settings.

- [ ] Write failing tests for approved unique number, duplicate/shared number,
  unknown/unapproved account, one/multiple organizations, one/multiple properties,
  revoked access and a forged payload claiming a super-admin role.
- [ ] Verify failures, then implement trusted ingress adapter boundary and explicit
  authorization using existing profile/membership records. No global resource queries.
- [ ] Test that invalid trust/access prevents service lookups and model enrichment;
  revocation during a draft denies both execution and sensitive rendering.
- [ ] Commit. Record supported provider verification evidence; without it the live
  mutation pilot remains disabled, regardless of whether interpretation works.

## Task 3: Durable events, conversations and operation outcomes

**Files:** create `store.ts`,
`supabase/migrations/20261005000002_whatsapp_llm_interpreter.sql`,
`tests/whatsapp-interpreter-store.test.mjs`; adapt existing assistant worker/RPC
boundaries rather than build an independent polling scheduler.

**Interfaces:** produces durable event acceptance/claim, conversation load/save,
operation reserve/result lookup and pending reply persistence for the coordinator.
Operation IDs are UUIDs reused across retries of the same confirmed action version.

- [ ] Write failing isolated database tests for unique provider/project/phone/message,
  independent booking/ticket drafts, per-phone serialized claims, 20-minute expiry,
  stale draft version, retry after commit and result recovery.
- [ ] Implement service-role-only storage with explicit org/user scope, durable
  claims and result states (`prepared`, `executing`, `succeeded`, `failed`).
  Persist acceptance before acknowledgement; audit/memory checks are not the commit.
- [ ] Verify that failing persistence returns retryable acceptance failure; an old
  provider event never updates the trusted last-inbound timestamp to reception time.
  Run the migration only in isolated test storage at this stage.
- [ ] Commit the tested persistence layer and deployment/rollback instructions.

## Task 4: Conversation coordinator and question planning

**Files:** create `coordinator.ts`, `reply.ts`,
`tests/whatsapp-interpreter-conversation.test.mjs`; modify `assistant/protocol.mjs`
to preserve context aliases and timestamps with backward-compatible fields.

**Interfaces:** consumes `interpretTurn`, `resolveActor`, registry and store;
produces `advanceConversation(...)` and authoritative `ReplyEnvelope`.

- [ ] Write failing conversation tests: partial booking retains supplied time while
  asking date/room; text-only ticket has no photo dependency; corrections clear
  conflicting derived IDs/reviews; missing/ambiguous entities ask focused questions.
- [ ] Add tests for same-recipient quote matching, unknown/another user's quote,
  old numbered choices, cancelled/completed/expired prompts, explicit feature switch,
  and two pending drafts requiring clarification for `yes` or `1`.
- [ ] Implement routing order and merging from the design; model output proposes
  fields, adapters determine readiness. Bind confirmation to the exact draft version.
- [ ] Run the tests; prove no execution while fields, access or target are uncertain.
- [ ] Commit the coordinator and normalization additions.

## Task 5: Shared free-form delivery

**Files:** create `backend/services/WhatsAppReplyService.ts`,
`tests/whatsapp-interpreter-delivery.test.mjs`; reuse Project API request format
from `whatsapp-test/freeformTest.ts` and existing campaign sends.

**Interfaces:** produces `sendReply(...) -> DeliveryResult` containing acceptance,
retryability and returned message aliases; consumes persisted trusted window and reply.

- [ ] Write failing tests for open/closed window, missing project config, timeout,
  retryable vs permanent errors, received provider IDs, and expired retries.
- [ ] Implement one shared Project API sender with existing
  `AISENSY_PROJECT_ID` / `AISENSY_PROJECT_API_KEY`. Return structured outcomes;
  never log tokens or complete sensitive provider responses.
- [ ] Persist recipient/conversation/resource-to-outbound-ID mappings. Outside the
  window use a configured approved matching template or mark awaiting-resume.
  An unapproved dynamic body must not be inserted into an arbitrary campaign.
- [ ] Run tests and a separate send/quote test with the user's test account once
  authorized; compare returned IDs to actual AiSensy `context` aliases.
- [ ] Commit. Keep existing notification sends unchanged until ownership integration.

## Task 6: Booking action adapter

**Files:** create `adapters/booking.ts`, `tests/whatsapp-interpreter-booking.test.mjs`;
reuse `whatsapp_assistant_book_range`, scoped room/slot/credit logic and timezone helper.
Extend the pilot migration's booking wrapper if optional attendee/comment fields
are supplied, preserving the old RPC signature for existing callers.

**Interfaces:** implements registry `prepareAction`, `executeAction`, `lookupOutcome`
for booking. Receives trusted actor and resolved property; emits actual booking reference.

- [ ] Write failing tests for direct complete and incomplete requests; single/multiple
  properties/rooms; `2.30pm`, 24-hour clocks, missing AM/PM/date, invalid/past dates,
  end-before-start, configured-slot gaps, optional attendee/comment and room mismatch.
- [ ] Add transaction tests for company vs user credits, existing no-record policy,
  insufficient credits, multiple-company ambiguity, overlapping requests, access
  revoked after review and replay of the same operation ID after a simulated crash.
- [ ] Implement preparation with live scoped reads and existing atomic RPC execution;
  do not copy the web route's non-atomic checks into a new booking writer.
  Persist provided optional attendee/comment fields within the same transaction,
  using a compatible wrapper if needed; do not silently drop supplied values.
  Preserve confirmation and refresh options when availability/credits change.
- [ ] Verify actual database rows, deducted balances and one outcome on retry;
  run tests without any real booking or production migration.
- [ ] Commit the booking adapter.

## Task 7: Ticket action adapter and domain-only execution

**Files:** create `adapters/ticket.ts`,
`backend/lib/whatsapp/createTicketFromWhatsApp.ts`,
`tests/whatsapp-interpreter-ticket.test.mjs`; modify `processMessage.ts` only to
share existing domain creation and keep its legacy routing entry point intact.

**Interfaces:** implements registry methods for ticket; domain-only creation takes
trusted user/property, issue, validated optional provider media and operation UUID.
Returns the ticket entity/reference after existing classification and assignment.

- [ ] Write failing tests for text-only report, captioned photo, bare photo asking
  description, multi-property selection, unknown property, empty/negated issue,
  unsupported attachment and two issues asking which to create first.
- [ ] Add tests proving an active Task Manager context cannot consume an already
  selected ticket execution; request replay returns the same ticket and preserves
  assignment despite failed notification sending.
- [ ] Extract/wrap existing domain logic without calling `TaskMessageRouter` from
  this adapter. Reuse classifier, `processIntelligentAssignment` and existing event
  emission; don't assign staff or priority from model-provided IDs.
- [ ] Run tests against storage/classifier/assignment boundaries and verify ticket
  references plus optional stored attachments; commit the adapter.

## Task 8: One inbound owner, legacy compatibility and notifications

**Files:** modify `app/api/webhooks/aisensy/route.ts`, `assistant/runtime.ts`,
`assistant/worker.mjs`, and scoped notification ownership handling in
`backend/services/WhatsAppEventProcessor.ts` only where required;
create `tests/whatsapp-interpreter-route.test.mjs` and integration scenarios.

**Interfaces:** routes each durable event to the coordinator or one legacy owner.
Booking/ticket completion owner is fixed per operation before sending.

- [ ] Write failing tests for disabled flag preserving current behavior, shadow
  interpretation without writes, pilot direct requests, booking answers while task
  context exists, explicit task commands retaining current task routing, global
  `cancel`, duplicate delivery and durable-store failure before acknowledgement.
- [ ] Implement new routing behind org/global flags; bypass early Task Manager
  execution and pre-processing audit dedup only on the enabled interpreter path.
  Shadow mode must not execute both old and new paths.
- [ ] Verify requester notification configuration. Use existing outbox completion
  by default; if the pilot selects assistant completion, suppress only its matching
  requester/event/channel and preserve other users' notifications and email.
- [ ] Run delivery-failure/crash tests; prove retries do not recreate resources,
  switch completion owner or send two equivalent requester confirmations.
- [ ] Run `npm run test:whatsapp-interpreter`, `npm run test:whatsapp`,
  `npm run test:requisition-drafts`, TypeScript and relevant lint. Update legacy
  route test stubs for current imported dependencies rather than weakening routing.
- [ ] Commit the integration and test evidence, clearly listing baseline failures.

## Task 9: Organization controls and pilot evaluation

**Files:** add scoped configuration API
`app/api/whatsapp-assistant/settings/route.ts`, admin settings component
`frontend/components/whatsapp/AssistantSettings.tsx`, settings tests and
`docs/WHATSAPP_LLM_PILOT.md`. Register the component in the existing Organization
Super Admin settings location discovered during implementation; do not create a
second unrelated settings product.

**Interfaces:** writes only validated org configuration used by `config.ts`;
preview interprets approved sample messages without executing services.

- [ ] Write failing tests for org-super-admin config access, cross-org denial,
  action enablement within app permission ceilings, model/secret separation,
  date policy, confirmation policy and dry-run causing zero side effects.
- [ ] Implement a small settings surface for the two actions and mode; no arbitrary
  URL/code editor or Task Manager mutation toggles in the initial pilot.
- [ ] Evaluate at least 60 approved/anonymized messages across complete/partial,
  correction, negation, unsupported, ambiguous and adversarial classes. Each
  example has expected action/fields, missing question, permission and mutation count.
- [ ] Require zero unauthorized or duplicate mutations in the evaluation suite;
  record extraction/clarification accuracy, end-to-end latency and model cost.
- [ ] With separate deployment authorization, apply migrations to a test database,
  verify Project API and identity gates, enable shadow then an allowlisted booking
  pilot, then tickets. Keep the global flag false in production until gates pass.
- [ ] Document disabling the interpreter as rollback; existing domain records and
  outbox stay intact. Commit the pilot configuration and evaluation evidence.

## Implemented pilot (2026-10-05)

The user's later instruction selects a **menu-led** pilot. The historical broader
plan above is the expansion roadmap; shadow dispatch, automatic cross-feature
intent execution, 60-case live model evaluation and optional booking
attendee/comment fields are not part of this implementation.

Implemented modules follow the existing `.mjs` pure-core / TypeScript IO style:
`backend/lib/whatsapp/interpreter/{contracts,config,interpret,coordinator,delivery,media}.mjs`
and `context.ts`. The existing assistant worker, event/session RPCs and booking
transactions remain the execution owners. Account lookup preserves the requested
plain AiSensy webhook integration; project-ID matching and property checks do not
constitute cryptographic provider verification.

The pilot supports menu-selected booking/ticket extraction using only
`GROQ_TASK_CHAT_API_KEY`, strict source-grounded fields, fresh authorization,
missing-detail questions, scoped property/room choices, stable operation IDs,
immutable review fingerprints, explicit confirmation, optional validated photos,
quote-aware routing and ambiguity safeguards. Explicit Task Manager commands keep
using the existing handler; a future resource-aware task adapter is required for
mutations quoted against old task digests. Completion stays with omnichannel.

Organization Super Admin configuration and interpretation-only preview are in the
existing WhatsApp Service settings tab. Settings and outgoing aliases are in the
additive migration `20261005000002_whatsapp_llm_interpreter.sql`. Global and
per-organization switches plus account allowlists are off/empty by default.

See `docs/WHATSAPP_LLM_PILOT.md` for exact environment variables, templates,
migration, live test steps, limitations and rollback. No push or production
migration is included. Offline tests exercise the provider boundary, coordinator,
worker, ticket/booking retry adapter, media limits, settings API and SQL RLS;
live model accuracy and provider delivery require configured test credentials.
