# AI Operations Layer — Development Plan

**Status:** planning only. No code written. Parked pending decisions in §8.
**Written:** 2026-08-01
**Context:** follows the Finance/Accounts module (Zoho Books sync, Payment Tracker, petty cash, one-click email approvals, SPOC matrix).

---

## 1. What is actually being asked for

The request bundles four separable capabilities. Splitting them matters, because they differ by an order of magnitude in cost and risk.

| # | Capability | Size | Risk |
|---|---|---|---|
| A | Sync **multiple mailboxes**, not just `purchase@` | Small | Low |
| B | **UI-configurable permissions** — who may change what status | Medium | Medium (it is an authz surface) |
| C | **AI monitor** — watches threads and operational state, flags what is stuck | Medium | Medium (cost, false positives) |
| D | **Autonomous chase** — voice calls + text to the responsible person until resolved | Large | **High** (telephony, regulatory, trust) |

A and B are ordinary engineering. C is tractable because the signals already exist. **D is a different kind of project** and is where this plan spends most of its caution.

---

## 2. The architectural insight

These are not four features. Built naively they become four parallel stacks that each grow their own scheduler, their own "who to notify" logic, and their own delivery code.

They collapse into **one spine**:

```
   SIGNAL SOURCES        →   RULE ENGINE      →   ACTION DISPATCHER
   (something is stuck)      (who, when,          (how to reach them)
                              how hard)

   mailbox threads           workflow_spoc_rules   in-app notification
   SOP checklists            escalation_levels     email
   material requests         (severity ladder)     WhatsApp
   PO alignment                                    SMS
   petty cash                                      voice call
   payment UTRs
```

Everything the user described is a **new signal source** or a **new action channel** plugged into the same middle. Build the spine once.

Critically, **most of this spine already exists** and is unwired.

---

## 3. What already exists (verified, not assumed)

| Asset | Where | State |
|---|---|---|
| Escalation ladder with per-level actor + channels + timing | `escalation_levels` (`employee_id`, `notification_channels`, `escalation_time_minutes`), `app/api/cron/check-escalation/route.ts` | **Working.** Already a rule engine. |
| SPOC resolution by domain/stage/level | `backend/lib/workflow/resolveSpoc.ts`, `workflow_spoc_rules` | **Built, zero production callers.** This is the "who". |
| WhatsApp delivery + durable queue | `backend/services/WhatsAppService.ts`, `WhatsAppQueueService.ts`, `whatsapp_queue` (~48k rows), `cron/process-whatsapp-queue` | **Working.** Real Graph API calls. |
| In-app + push notifications | `NotificationService.ts`, `notifications` (~164k rows), `push_tokens` (~412) | Working. |
| Email + one-click actions from the inbox | `EmailService.ts`, `backend/lib/emailActions/*` | Working (petty cash + payments). |
| LLM classification | `backend/lib/llm/groq.ts` → `classifyWithGroq()` | Working. Used by ticketing, OCR, chatbot. |
| Speech-to-text + call analysis | `backend/lib/coaching/whisper.ts`, `groqCoach.ts`, `crm_calls.recording_url` | Working — but **post-hoc on uploaded recordings**. |
| Checklist state ("not filled") | `sop_completions`, `cron/check-sop-reminders`, `check-sop-missed` | Working. The signal exists. |
| Material request state | `material_requests` | Exists. |
| Mailbox ingestion + classification | `mailbox_threads`, `backend/services/mailboxDigest.ts`, `zohoMailService.ts` | Working, single mailbox, heuristics by default. |

**The honest summary:** roughly 70% of A + B + C is assembling parts that already work. D is genuinely new.

---

## 4. The gaps

1. **`mailbox_threads` has no mailbox dimension.** Single-mailbox is baked into env (`ZOHO_MAIL_ADDRESS`, `ZOHO_MAIL_ACCOUNT_ID`) and into the unique key `(organization_id, thread_id)`. Two mailboxes would collide on thread ids.
2. **Permissions are hardcoded role sets.** `ORG_ADMIN_ROLES` / `ALIGN_ROLES` / `COMPLETE_ROLES` in `backend/lib/accounts/access.ts`, mirrored in `frontend/lib/accounts/roles.ts`. Changing who can complete a payment currently requires a code deploy.
3. **No outbound telephony of any kind.** No Twilio, Exotel, Plivo, Knowlarity. `crm_calls` stores recordings that arrive by upload; nothing dials out.
4. **No signal registry.** Each cron independently decides what is late and who to tell.
5. **No suppression layer.** With 164k notifications and 48k queued WhatsApp messages already, an autonomous chaser without throttling will produce noise people learn to ignore — which destroys the feature's value faster than a bug would.

---

## 5. Phasing

Each phase is independently shippable and useful on its own. Stop at any point.

### Phase 1 — Multi-mailbox (small)
- Add `mailbox_accounts` table: `id, organization_id, email_address, zoho_account_id, display_name, is_active, purpose` (purpose = purchase / accounts / support).
- Move credentials out of env into that table (encrypted refresh token per mailbox), or keep one OAuth grant covering several mailboxes if they share a Zoho org.
- Add `mailbox_account_id` to `mailbox_threads`; change the unique key to `(organization_id, mailbox_account_id, thread_id)`.
- Cron loops accounts instead of reading one env var. **Keep the explicit org pin** — the current `ZOHO_MAIL_ORG_ID` guard exists because a shared inbox fanned across orgs is a cross-tenant disclosure.
- UI: a mailbox list in the Finance workspace, plus a filter in `MailDigest`.

### Phase 2 — Permission matrix in the UI (medium)
This is the "modular, editable in the UI" ask, and it is the highest-leverage phase because every later phase reads from it.

- Generalise `workflow_spoc_rules` into `workflow_permissions`: `(organization_id, property_id?, domain, action, allowed_roles[], allowed_user_ids[])` where domain ∈ {payment, petty_cash, procurement, ticket, mailbox} and action ∈ {view, align, complete, approve, reject, resolve, reassign}.
- `resolveAccountsAccess` and `resolvePettyCashAccess` read this table, **falling back to today's hardcoded sets when no row exists** — so nothing breaks on day one and migration is incremental.
- Extend `SpocMatrix.tsx` (already built, unmounted) into the editor.
- **Cache aggressively** — this sits in the hot path of every API call. Per-request memo plus a short TTL.
- **Guardrail:** never allow a rule that removes the last admin's ability to edit rules. Lockout is the classic failure of self-editing permission systems.

### Phase 3 — Signal bus + AI monitor (medium)
- `ops_signals` table: `id, organization_id, property_id, source, entity_type, entity_id, severity, opened_at, resolved_at, last_actioned_at, responsible_user_id, state`.
- Signal producers, each a small pure function run by an existing cron:
  - checklist slot missed (`sop_completions`)
  - material request with no movement in N days
  - PO in To Align beyond SLA, or flagged critical
  - payment aligned but no UTR after N days
  - mailbox thread awaiting reply beyond N hours
  - petty cash awaiting approval beyond N hours
- Responsible person resolved via **Phase 2's matrix**, not hardcoded.
- LLM used **only where rules cannot decide** — reading a thread to judge "does this need a human reply?" is a genuine LLM task; "is this checklist overdue?" is a `WHERE` clause. Keep the LLM off the deterministic path; it is slower, costlier and less predictable.
- Deliverable: an **Operations dashboard** — every stuck thing, who owns it, how long it has been stuck. Valuable on its own with zero outbound chasing.

### Phase 4 — Escalation + text chase (medium)
- Reuse `escalation_levels`' ladder semantics for ops signals: level 0 in-app → level 1 email → level 2 WhatsApp → level 3 the site manager → level 4 org admin.
- Route everything through the **existing** `whatsapp_queue` and `NotificationService`; do not add a parallel sender.
- **Suppression is a first-class feature, not a later optimisation:** per-user daily caps, quiet hours (IST), one digest instead of N pings, and auto-mute for a signal a user has already actioned.

### Phase 5 — Voice / AI caller (large — treat as its own project)
- Requires a telephony provider. ElevenLabs Conversational AI needs a carrier underneath (Twilio is the documented path; Exotel/Knowlarity are the common India-local options).
- Scope the **first** version hard: outbound call, agent states the one thing that is overdue, accepts "done / not done / call me later" by voice, writes the outcome back to `ops_signals`. No open-ended conversation.
- Reuse the existing `whisper.ts` + `groqCoach.ts` pipeline for transcript and outcome extraction — that pipeline already works on recordings.
- Store call outcome against the signal so escalation knows a call was attempted and answered.

---

## 6. Hard problems, named honestly

**Indian telephony regulation.** Automated outbound voice and SMS to Indian numbers fall under TRAI/TCCCPA. Commercial SMS requires DLT registration of sender IDs and templates; automated voice has its own constraints and consent expectations. This is a **legal/compliance gate on Phase 5, not an engineering detail** — confirm it before any provider is chosen. It may be the deciding factor for provider selection.

**Consent and tone.** Calling staff automatically because a checklist is unfilled changes the relationship with the tool. Suggest: opt-in per role, quiet hours, a hard daily cap, and always an obvious way to say "stop calling me" that a human sees.

**LLM cost and drift.** ~300 threads per 4-hour sync × multiple mailboxes, classified every run, is real money and real latency. Mitigations: classify only new or changed threads, cache by content hash, keep the deterministic heuristics as the default (as today), and treat the LLM as an enrichment pass.

**False positives destroy trust faster than silence.** A chaser that calls about a checklist someone already completed offline will be switched off within a week. Every signal needs a cheap "this is already handled" path, and the system must believe the human.

**Notification fatigue is already a live problem.** 164k notifications and 48k queued WhatsApp messages exist today. Phase 4 without Phase 4's suppression logic makes an existing problem materially worse.

**Self-editing permissions can lock you out.** See the Phase 2 guardrail.

---

## 7. What NOT to build

- **A general-purpose autonomous agent with open-ended tool access.** Bounded signal → bounded action is auditable, debuggable, and safe. An agent that can "do anything about anything" cannot be reasoned about when it does the wrong thing at 2am.
- **A second notification stack.** Everything routes through the existing queue and service.
- **LLM judgement on deterministic questions.** Overdue is a comparison, not an inference.
- **Voice before the Operations dashboard is trusted.** If people do not believe the list of what is stuck, they will not accept a phone call about it.

---

## 8. Decisions needed before starting

1. **Which mailboxes?** Names, and whether they share one Zoho org (one OAuth grant) or need separate grants.
2. **Permission granularity:** per-role only, or per-user overrides too? Per-user is more flexible and materially harder to reason about when debugging "why can this person do that?".
3. **Chase channel priority** for Phase 4 — WhatsApp first (already built, high open rates) or email first?
4. **Phase 5 go/no-go**, and if go: telephony provider, and who owns the DLT/compliance work.
5. **Quiet hours and daily caps** — the actual numbers, per role.
6. **Does the AI monitor act, or only recommend?** Strong recommendation: recommend-only for the first release, so its judgement can be evaluated against reality before it is allowed to phone anyone.

---

## 8b. Addendum — mailbox reach, sending on our behalf, and guarded Q&A

Added 2026-08-01 after the first live sync.

### How far back the mailbox sync can reach

| Limit | Value | Where |
|---|---|---|
| Lookback window | 21 days | `ZOHO_MAIL_LOOKBACK_DAYS`, `mailboxDigest.ts:55` |
| Messages fetched per run | 3,000 (15 pages × 200) | `MAX_PAGES`, `zohoMailService.ts:39` |
| Threads stored per run | 300 | `MAX_THREADS`, `mailboxDigest.ts:56` |
| Run budget | 300s | `RUN_BUDGET_MS` |

Zoho retains everything; **our caps are the constraint, not Zoho**. Raising `ZOHO_MAIL_LOOKBACK_DAYS` alone does not backfill history — a single run still stops at 300 threads, so it would just re-fetch the same recent ones from a wider window.

**Full history needs a backfill mode**, not a bigger number: a separate one-shot job that walks *backwards* in fixed windows (e.g. 30 days at a time), persists a cursor, and stops when a window returns nothing. The Inbox is ~3,443 messages, so this is a handful of runs, not an infrastructure problem. Keep it separate from the hourly sync so a backfill can never starve the live one.

### Sending on our behalf (reply from `purchase@`)

Currently **read-only** — the grant is `ZohoMail.accounts.READ, ZohoMail.messages.READ`. Sending needs:

1. A new grant adding `ZohoMail.messages.CREATE` (same Self Client, new refresh token — the read token stays separate so read access can outlive send access).
2. `POST /api/accounts/{accountId}/messages` with `inReplyTo` to thread correctly, otherwise replies start new threads and the digest double-counts.
3. **Draft-then-approve, never auto-send.** A queued `mailbox_outbox` row a human releases. Auto-sending on behalf of a shared mailbox is the single highest-blast-radius thing in this plan: a wrong reply to a vendor is commercially binding in a way a wrong in-app notification is not.
4. Every sent message written back to `mailbox_threads` so the digest sees its own reply and stops flagging the thread.

### Adding `support@autopilotoffices.in` — and the Hostinger question

The cost of a second mailbox depends entirely on **where it is hosted**, not on how many mailboxes we want:

- **Another Zoho mailbox on the same org** — nearly free. One extra row in `mailbox_accounts`; the existing OAuth grant may already cover it.
- **A different provider (Hostinger)** — requires a new **IMAP/SMTP adapter**, because Hostinger business email is mailbox *hosting*, not an automation API. It gives IMAP, SMTP, webmail, aliases, and forwarding. It does not give thread APIs, classification, or anything resembling Zoho's `/api/accounts/{id}/messages/view`.

**Evaluation of Hostinger for this use case:** it is a fine, cheap place to *host* a mailbox. It contributes nothing to the intelligence layer — all classification, chasing and drafting stays in our app regardless of who hosts the mail. So it is not an alternative to building this; it is only a hosting choice.

**Recommendation:** if `support@autopilotoffices.in` can live on Zoho, put it there and adding it is configuration. If it must stay on Hostinger, write one generic **IMAP adapter** behind the same interface `ZohoMailService` already implements (`listThreads({ since })`), so `mailboxDigest.ts` never learns which provider a mailbox uses. That adapter is worth building once anyway — it makes every future non-Zoho mailbox free.

### Guarded Q&A — answering "what's the status of the June requisition?"

The valuable and dangerous idea. Worked example: *Shailesh emails asking for an update on the June requisition; the PO exists and we know its exact status; the AI drafts the reply.*

**The guard is architectural, not a prompt instruction.** The model must never hold a query interface, and never see rows it was not handed.

```
inbound thread
   → deterministic intent match   (regex/keyword: PO number, requisition, month, site)
   → scoped DB lookup             (organization_id ALWAYS bound; whitelisted columns only)
   → a small, explicit FACT SHEET (po_number, status, aligned/pending amount, dates, link)
   → LLM formats prose from ONLY that fact sheet
   → draft queued for human release
```

Non-negotiables:

1. **No SQL from the model, ever.** No text-to-SQL, no tool that takes a query. The lookup is code we wrote, with `organization_id` bound from the mailbox's pinned org.
2. **Column whitelist.** Status, PO number, dates, amounts, links. Never `raw`, never vendor bank details, never another org's rows, never internal remarks.
3. **Prefer a link over a number.** The reply says "here is the current status" and links into the Payment Tracker, where existing RBAC decides what that person may see. A link cannot over-share; a pasted table can.
4. **Recipient check before amounts.** Only include commercial figures if the recipient is internal. An external vendor asking about "the June requisition" must get a link and an acknowledgement, not our pending-payment position.
5. **Refuse rather than guess.** If intent matching is not confident, or the lookup returns nothing or more than one candidate, draft nothing and flag for a human. A confidently wrong status emailed to a client is worse than silence.
6. **Log the fact sheet** alongside the draft, so any reply can be audited back to the exact rows that produced it.

This is retrieval with a whitelist, not an agent with database access — which is what makes "very guarded" achievable rather than aspirational.

---

## 9. Suggested order

**Phase 2 first, not Phase 1.** The permission matrix is what makes everything after it modular, and it is the thing currently requiring a code deploy to change. Then 3 (visibility), then 1 (more inputs), then 4 (chase), and 5 only on an explicit go.

Phase 3's Operations dashboard is the point at which this stops being infrastructure and starts being visibly useful — it answers "what is stuck and who owns it" across the whole organisation, which is most of the value of the "AI employee" without any of its risk.
