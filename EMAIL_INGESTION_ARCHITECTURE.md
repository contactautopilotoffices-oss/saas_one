# Email as a Scalable Signal Source — Ingestion & Agent Isolation

**Status:** design. Extends `AI_OPERATIONS_LAYER_PLAN.md` §5 Phase 1 and §8b.
**Written:** 2026-08-06
**Answers:** "40–50 addresses tracked daily, one organisation, without creating an OAuth grant per address."

---

## 1. The reframe

The current design has mailbox identity baked into env (`ZOHO_MAIL_ADDRESS`, `ZOHO_MAIL_ACCOUNT_ID`, `ZOHO_MAIL_ORG_ID`) and one OAuth grant per mailbox. That model has a hard ceiling at roughly one mailbox, and every new address is a manual OAuth ceremony.

The fix is not "automate the grant ceremony". It is to notice that **an address you want to read and a mailbox you must authenticate against are two different things**, and the mail system will happily collapse many of the first into one of the second.

```
  ADDRESSES WE TRACK                 MAILBOXES WE AUTHENTICATE TO
  (40–50, grows weekly)              (1–3, grows ~never)
  ────────────────────               ────────────────────────────
  procurement@ops.…      ─┐
  compliance@ops.…       ─┤
  facility-north@ops.…   ─┼──────►   intake@ops.worksquare.in     ← ONE grant
  vendor-escalation@ops.…─┤          (catch-all on ops.worksquare.in)
  …42 more…              ─┘

  purchase@worksquare.in ─┐
  accounts@worksquare.in ─┼──────►   svc-ingest@worksquare.in     ← ONE grant
  support@…              ─┘          (delegated access, or forward rule)

  anything on Hostinger/Gmail ───►   IMAP adapter, app password    ← no OAuth at all
```

Grants scale with *hosts*, not with *addresses*. Three grants, forever, regardless of whether you track 50 addresses or 500.

---

## 2. Three ingestion classes

They have genuinely different mechanics. Conflating them is what makes this look unsolvable.

### Class A — Agent intake addresses (new addresses, unlimited, zero-touch)

Addresses that exist *because* an agent exists. `council_agents.email` already models this — the column is there and the migration explicitly parks "real Zoho mailbox provisioning per agent" as post-MVP.

**Mechanism: a catch-all on a dedicated subdomain.** Point `ops.worksquare.in` (or any subdomain you are not using for humans) at Zoho, set its catch-all to a single `intake@` account. Every address on that subdomain now delivers into one mailbox that one grant already reads.

Creating a new agent becomes: `INSERT INTO council_agents (…, email)`. No console visit, no DNS change, no OAuth, no deploy.

> **Why a catch-all and not aliases.** Not because of the cap: Zoho allows 30 addresses per mailbox (29 aliases + 1 primary, the same on every plan), and the documented workaround for more is a second mailbox with its own 30 — so 40–50 addresses would fit across two mailboxes. The reason is **zero-touch provisioning**. Every alias is a console action by an admin before the code can use it, which is a smaller copy of the manual step this whole document exists to remove. With a catch-all, creating an agent address is `INSERT INTO council_agents (…, email)` and nothing else.
>
> **Two caveats, both real.** Zoho's rates-and-limits page explicitly discourages catch-alls, because they absorb spam aimed at non-existent addresses and can push an account into its **receiving limits** — and a catch-all funnels 50 addresses' traffic into *one* account, so that ceiling arrives sooner than it would across 50 separate mailboxes. Mitigations: (a) put the catch-all on a **dedicated, unpublished subdomain** — the spam warning targets catch-alls on scraped primary domains, and it also means a typo'd `purchse@worksquare.in` still bounces visibly instead of silently entering the intake queue; (b) if volume warrants, **shard across 2–3 intake accounts**, each a catch-all on its own subdomain — still 2–3 grants, not 50; (c) spam-filter intake aggressively and let routing rung 6 (`unrouted`, §3) absorb the rest, which is another reason that rung must never fall through to an agent.
>
> Source: [Zoho Mail — Rates, limits, and policies](https://www.zoho.com/mail/help/adminconsole/rates-and-limits.html).

### Class B — Existing human/functional mailboxes (the 40–50 you already have)

`purchase@`, `accounts@`, per-site addresses. These already receive mail at their real addresses and cannot be moved. Two mechanisms, in order of preference:

1. **Delegated access to one service account.** In the Zoho admin console, grant `svc-ingest@worksquare.in` delegated/shared access to each mailbox. Delegated accounts then appear in `GET /api/accounts` under the service account's *existing* token — which is exactly the call `ZohoMailService.accountId()` already makes. The code change is: stop picking one match, loop all of them.

2. **Admin-set forward or org routing rule.** Each mailbox forwards (or BCCs) a copy to `journal@ops.worksquare.in`, which the Class A catch-all grant already reads.

Either way the per-mailbox cost is **one console action by a mail admin, once** — not an OAuth grant, not a developer task, not a deploy. That is the ceiling you were worried about, and it is a bulk admin operation rather than an engineering one.

> **Verify before committing to (1):** whether your Zoho plan exposes the Organization APIs and whether delegated accounts surface through `/api/accounts` for the *message* endpoints and not only the admin ones. If delegation reads work, prefer them — forwarding rewrites headers and loses Sent mail, and (1) does not. Mechanism (2) always works and is the fallback.

### Class C — Non-Zoho mailboxes

Hostinger, Gmail, a client's own domain. **One generic IMAP adapter** behind the same interface `ZohoMailService` already exposes (`listThreads({ since })`), so `mailboxDigest.ts` never learns which provider a mailbox uses. Credential is an app password per mailbox, stored encrypted in `mail_accounts` — no OAuth dance at all.

Build this once and every future non-Zoho mailbox is free. `AI_OPERATIONS_LAYER_PLAN.md` §8b already reached the same conclusion for `support@autopilotoffices.in`.

---

## 3. The routing key — where the proposed rule needs correcting

The proposal: *"the gateway looks at which alias it was delivered to, stamps it with an agent_id."*

Right shape, wrong field. **The `To:` header is not where the delivery address lives.** It fails on:

- **Bcc** — the intake address is not in `To:` or `Cc:` at all. This is the common case for journaling and for anyone quietly looping the system in.
- **Forwarding** — `To:` holds the *original* recipient, not the address that actually received it.
- **Distribution lists / groups** — headers get rewritten.
- **Multi-recipient mail** — one message addressed to procurement *and* compliance has two valid answers.

The address that actually determines delivery is the **SMTP envelope recipient** (`RCPT TO`), which survives into the delivered copy as `Delivered-To:`, `X-Original-To:`, or `Received: … for <addr>`.

**Routing precedence — implement exactly this order, and log which rung matched:**

| # | Signal | Reliability |
|---|---|---|
| 1 | `Delivered-To` / `X-Original-To` header | authoritative |
| 2 | `for <addr>` clause in the topmost `Received` header | authoritative, needs parsing |
| 3 | Plus-address tag (`intake+procurement@…`) in any recipient field | good for internal rules, useless for external senders |
| 4 | Exact match of a known identity in `To:`/`Cc:` | heuristic |
| 5 | Reply to a thread already routed | inherit the thread's `agent_id` |
| 6 | **no match** | `agent_id = NULL` → `unrouted` queue |

**Rung 6 is the important one.** Never default to an agent. An unroutable message goes to a human triage queue whose size is a health metric — if it grows, routing is broken and you find out from a dashboard rather than from an agent that quietly stopped receiving its mail.

> **Cost note for the Zoho REST path:** `/api/accounts/{id}/messages/view` returns list metadata, **not full headers** — `zohoMailService.ts:231` (`toMessage`) shows exactly which fields come back. Rungs 1 and 2 need a per-message detail/original fetch, which is an extra API call per message. Budget for it, or lean on rung 3 + 5 for Class A where the catch-all makes the envelope recipient predictable anyway.

---

## 4. Schema

Replaces the single-mailbox assumption. Note the unique-key fix: `mailbox_threads`' current key `(organization_id, thread_id)` collides the moment a second mailbox is added, because thread ids are only unique *within* an account.

```sql
-- A thing we authenticate to and read from. Grows ~never.
mail_accounts (
  id, organization_id,
  provider            'zoho' | 'imap',
  address,                            -- intake@ops.worksquare.in
  zoho_account_id,                    -- for the Zoho adapter
  credential_ref,                     -- encrypted; NOT env
  is_catch_all        bool,
  catch_all_domain,                   -- ops.worksquare.in
  sync_cursor,                        -- watermark; see §6
  last_synced_at, last_error,
  is_active
)

-- An ADDRESS we track. Many identities → one account. Grows weekly.
mail_identities (
  id, organization_id,
  mail_account_id     → mail_accounts,
  address             citext,         -- procurement@ops.worksquare.in
  kind                'mailbox' | 'alias' | 'catch_all_pattern',
  agent_id            → council_agents,   -- the isolation key
  property_id         → properties,       -- site scoping, nullable
  purpose             'procurement' | 'compliance' | 'facility' | …,
  is_active,
  UNIQUE (organization_id, address)
)

mail_threads (
  id, organization_id,
  mail_account_id, agent_id, property_id,
  provider_thread_id,
  routed_by           'delivered_to' | 'received_for' | 'plus_tag'
                    | 'header_match' | 'inherited' | 'unrouted',
  subject, participants, last_message_at, message_count,
  category, waiting_on, classified_by,
  is_resolved, resolved_at, resolved_by,
  UNIQUE (organization_id, mail_account_id, provider_thread_id)   -- ← the fix
)

mail_messages (
  id, thread_id, organization_id, agent_id,
  provider_message_id,
  rfc_message_id,                     -- <…@…>, needed to reply ON the thread
  in_reply_to, references[],
  envelope_to[],                      -- what routing actually keyed on
  from_address, to[], cc[],
  sent_at, has_attachment, attachment_types[],
  summary                             -- headers + provider summary only, no bodies
)
```

`agent_id` is denormalised onto both threads and messages deliberately: it is the RLS predicate, and a predicate that requires a join is a predicate someone will eventually get wrong.

---

## 5. Isolation — make it the database's job, not the code's

> *"that query is filtered by agent_id in code. It physically cannot see compliance mail"*

The goal is right; the mechanism named is not sufficient. Filtering in code is one forgotten `.eq('agent_id', …)` away from a full cross-domain leak, and nothing tells you it happened. "Physically cannot" has to mean the database refuses.

**Enforce with RLS keyed on the agent's own identity:**

```sql
ALTER TABLE mail_threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent reads only its own threads" ON mail_threads
FOR SELECT USING (
    agent_id::text = current_setting('request.jwt.claims', true)::json->>'agent_id'
);
```

Each agent runs under its own scoped token carrying `agent_id`. Now a missing filter returns **zero rows**, not someone else's mail. The code filter stays — as defence in depth and for query performance — but it is no longer the thing standing between procurement and compliance.

This is the same posture the repo already takes elsewhere: `mailbox_threads`' RLS deliberately scopes SELECT **by role rather than bare org membership**, precisely because vendor and super-tenant logins are real org members. That reasoning applies verbatim here.

**Three rules that follow:**

1. **Agents never hold a query interface.** No text-to-SQL, no tool that accepts a query string. The lookup is code we wrote with `organization_id` and `agent_id` bound server-side. (`AI_OPERATIONS_LAYER_PLAN.md` §8b already establishes this for guarded Q&A — same rule, wider scope.)
2. **The service role is not an agent.** The sync writes as service role and sees everything; agents never get that credential.
3. **Unrouted mail is visible to no agent.** It sits in human triage until a person assigns it.

---

## 6. Scale — 50 mailboxes will break the current sync

The present design does a 21-day lookback rescan every run, capped at 3,000 messages and 300 threads inside a 300s budget, for **one** mailbox. Multiplied by 50 that does not fit, and the caps silently truncate rather than fail — the worst failure mode, because it looks healthy.

Three changes:

**Watermark, not lookback.** Per-account `sync_cursor` (last seen message timestamp + id). Fetch newest-first and stop at the cursor. Steady-state cost becomes proportional to *new mail*, not to window size — typically a handful of messages per mailbox per run.

**Queue the fan-out, don't loop it.** One cron enqueues due accounts into a jobs table; short worker invocations drain it. A single 300s route looping 50 accounts dies on the slowest mailbox and loses every account after it. Reuse the durable-queue pattern already proven in `WhatsAppQueueService` rather than inventing a second one.

**Keep the LLM off the hot path.** At ~50 mailboxes the deterministic heuristics in `mailboxDigest.ts` must stay the default (they already are), with classification only on threads that are new or changed since their last verdict — the `storedAiState` / `needsAi` logic already implements exactly this and should carry over unchanged.

**Backfill is a separate job.** Walk backwards in fixed windows with its own cursor, never sharing a budget with the live sync.

---

## 7. The vector layer — scope it narrowly

A semantic index is worth having, for "have we handled this before", "what did this vendor say last time", and retrieval when drafting a reply. Two disciplines keep it from becoming a liability:

**It is a cache, never the source of truth.** TAT, closure status, and anything auditable are computed from `mail_threads`/`mail_messages` with SQL. Nothing operational is ever decided by cosine similarity.

**It carries the same RLS predicate as the rows it derives from.** Use pgvector in the existing Supabase instance — no new infrastructure, and the isolation model transfers unchanged:

```sql
mail_thread_embeddings (
  thread_id → mail_threads,
  organization_id, agent_id,          -- SAME predicate as §5
  embedding vector(1536),
  content_hash,                       -- re-embed only on change
  embedded_at
)
```

Embed the **thread-level summary and closure facts**, not every message — one vector per thread, refreshed on change. Embedding every message multiplies cost by ~8× for retrieval that is worse, because message-level chunks lose the thread's outcome.

> **Performance caveat, stated honestly:** an ANN index (HNSW/IVFFlat) combined with an RLS predicate degrades toward post-filtering — you scan more candidates than you return. At tens of thousands of threads this is irrelevant. If it ever matters, partition by `agent_id` or build per-agent partial indexes; do not solve it by dropping the predicate.

---

## 8. Privacy — worth stating before anyone opens the admin console

Class A (agent intake addresses) is unremarkable: those addresses exist to be machine-read.

Class B is not. Ingesting 40–50 **existing** mailboxes copies real correspondence into our database, and the existing code already carries strong commitments about this — org-scoped, service-role writes only, role-restricted reads, headers and provider summaries only, never full bodies or attachments. Extending to 50 mailboxes must extend those commitments, not quietly outgrow them.

Two concrete constraints:

- **Functional addresses, not personal inboxes.** `purchase@`, `accounts@`, `site-north@` are operational records. An individual employee's inbox is not, and sweeping one in via a journaling rule is a materially different decision that should be made explicitly and disclosed to the people affected — not arrived at because it was the easiest routing rule to write.
- **The org pin stays.** The mailbox credentials are global; `ZOHO_MAIL_ORG_ID` exists because fanning one inbox across `accounts_zoho_config` rows would leak one tenant's correspondence into another the moment a second org onboards. More mailboxes makes that guard more important, not less.

---

## 9. Build order

| # | Step | Unblocks |
|---|---|---|
| 1 | `mail_accounts` + `mail_identities`; move creds out of env; fix the thread unique key | everything |
| 2 | Catch-all subdomain + one intake grant; route by envelope recipient; `unrouted` queue | unlimited agent addresses, zero-touch |
| 3 | Watermark cursors + queued fan-out | 50 mailboxes without truncation |
| 4 | RLS by `agent_id` + scoped agent tokens | real isolation |
| 5 | Delegated access (or forward rules) for the existing 40–50 | Class B |
| 6 | IMAP adapter | Class C, permanently |
| 7 | pgvector thread index | semantic recall |

Steps 1–3 are the ones that convert this from "one mailbox, hardcoded" to "any number of addresses, config-only". 4 should not lag far behind, because retrofitting isolation onto a system that already has agents reading is much harder than starting with it.

---

## 10. Verify in the Zoho console before building

These four answers determine which mechanisms in §2 are available. None of them are code questions.

1. Does the plan expose **Organization APIs** (`ZohoMail.organization.accounts.READ`)?
2. Does **delegated mailbox access** surface those accounts through `GET /api/accounts` for the *message* endpoints under one service-account token — or only the admin endpoints?
3. Is there an **org-level routing/journaling rule**, or does each mailbox need its own forward rule set individually?
4. Is a **catch-all** configurable on a subdomain, and what are the **receiving limits** on the intake account? (The alias limit is already answered: 30 addresses per mailbox on every plan — see §2 Class A. It is not the deciding factor; receiving limits are.)

If (2) is yes, Class B costs nothing per mailbox. If it is no, Class B costs one admin click per mailbox via (3). Either way it never costs an OAuth grant — which is the constraint that prompted this document.
