# The COO report endpoint — design

Supersedes the open questions in `MCP_READONLY_ENDPOINT_PLAN.md`. Same scope: this endpoint only.

---

## 1. What you actually described

> The COO doesn't want to come back into the app every day. He wants the key points across the whole
> organization stitched into one readable report, with sensitive data kept out.

That is a **push** problem. MCP is a **pull** protocol.

If the answer is only an MCP endpoint, the COO stops opening your app and starts opening Claude to ask
for his report. He is still doing a daily errand — just in a different window. That is a smaller win
than it looks.

**Build both. The report is the product; MCP is what makes the follow-up possible.**

| | What it is | When it fires |
|---|---|---|
| **The brief** | A composed, readable report delivered to him | 07:00 daily, no action from him |
| **The endpoint** | The same data, callable | When he asks a follow-up: "why was procurement red?" |

Both read the **same query registry**. The brief is not a second implementation.

The delivery rails already exist — `event_outbox`, `NotificationService`, email and WhatsApp. The
brief is a cron that composes and hands off. You are not building a notification system.

---

## 2. The blocker — read this before anything else

The per-user model you described (and Zoho's) works by **running every query as the connecting user**,
so the MCP link can never see more than that person sees in the app.

**Today's row-level security cannot support that.** Across the migrations:

- **30** policies are `USING (auth.role() = 'authenticated')` — any logged-in user, any row
- **11** policies actually scope by organization or property membership

So "run as the user" currently means "return the whole database, across every organization." If you
ship the per-user MCP link on today's RLS, **every user's link is a full-database export**, and
customer links leak across customers.

**This is the whole project.** Not a caveat — the precondition. Fixing RLS on the tables the endpoint
exposes is the first and largest piece of work, and it is worth doing regardless of MCP, because the
same hole is reachable from the browser today.

Two consequences:

1. **Scope the endpoint narrowly at first.** Every table it exposes needs correct RLS. Ten tables
   done properly beats sixty done hopefully.
2. **Never let the endpoint use the service role key.** That key bypasses RLS entirely. The endpoint
   sets the user's JWT on the connection and lets Postgres enforce access — the same path the web app
   uses.

---

## 3. How Zoho does it, and what to copy

You asked what is underneath. Two things, both worth copying.

**a. The agent inherits the user's permissions and nothing beyond.** Auth goes through Zoho's own
OAuth 2.0; the AI client never holds credentials; the connection is scoped to the person who
authorised it. That is exactly the "anyone can make an MCP link for their account" behaviour you
described — there is no separate permission model for MCP, it reuses the product's own.

**The rule to take from this:** *the MCP server must not have its own idea of who can see what.* The
moment it does, it drifts from the app and the drift is a leak. One permission model, enforced in the
database, used by both.

**b. They split servers by capability, not by module.** Zoho CRM ships four: Data Insights
(read-only), Data Operations (full CRUD), Module Customization, Workflow Automation.

**Copy this too.** A read-only server is something you can hand to a customer, an auditor, or a
model with far less anxiety than one that can also write. Keep them as separate endpoints with
separate scopes, permanently — not one server with a read-only flag.

The wider pattern in the ecosystem is the same: MCP itself enforces nothing. The client passes the
user's identity, the server resolves it to a real principal, and every tool call is authorised at
runtime against the product's own policy.

---

## 4. Architecture

### One registry, three consumers

The most important structural decision. Write the queries **once**, as named parameterised functions
with typed arguments and a declared sensitivity class. Then:

```
                    ┌──────────────────────────┐
                    │   QUERY REGISTRY         │
                    │   named, parameterised,  │
                    │   classified, versioned  │
                    └───────────┬──────────────┘
            ┌───────────────────┼───────────────────┐
            │                   │                   │
   ┌────────▼────────┐ ┌────────▼────────┐ ┌───────▼─────────┐
   │  MCP endpoint   │ │  Brief composer │ │ Internal agents │
   │  external       │ │  cron           │ │ IRA, Pratiksha  │
   │  user JWT + RLS │ │  service scope  │ │ bundle scope    │
   └─────────────────┘ └─────────────────┘ └─────────────────┘
```

Change a definition once, and the COO's report, his follow-up question, and IRA's diagnosis all move
together. Three separate implementations would drift within a month, and the drift shows up as the
report and the endpoint disagreeing — which destroys trust in both.

### Sensitive data: exclude, don't filter

You said keep sensitive data apart. Do it by **absence, not by filtering**.

Every column in the registry carries a class:

| Class | Example | In the read-only registry? |
|---|---|---|
| `open` | goal progress, TAT, ticket counts | Yes |
| `internal` | vendor rates, budgets | Yes, role-gated |
| `sensitive` | salary, personal contact, disciplinary notes, medical | **Never registered** |

A runtime filter is a line of code that can be wrong. A column that no registered query selects
cannot leak, whatever the model asks for or however the prompt is manipulated. Classify at
registration time and the guarantee is structural.

### The request path

```
1. Validate the bearer token       signature, exp, issuer, audience == this endpoint
2. Resolve to a real user          subject claim -> users.id
3. Set the user's JWT on the DB    RLS now enforces exactly the app's rules
4. Check the tool name             against the read-only registry
5. Run the named query             no free-form SQL, ever
6. Log                             who, tool, args, row count, latency
```

Step 3 is what makes this credible: **MCP access cannot exceed web access, by construction.**

### "Individual, not multi-tenant" — you have both

With customers connecting, a user's scope is:

```
their organization  ∩  their properties  ∩  their role
```

Tenant isolation is the outer ring and it does not go away. Per-user scoping is a second, tighter
ring inside it. The good news: both already exist in your schema as `organization_memberships` and
`property_memberships`. They just are not enforced by the RLS policies yet (§2).

The elegance of getting this right: the COO's link returns nearly everything because he is the COO. A
site supervisor's link returns one site. **Same endpoint, same code, different token.**

---

## 5. How the agents use this

Your instinct is right that this is an interesting amalgamation — but the wiring should not be what
you'd expect.

**IRA and Pratiksha should not call the MCP endpoint.** They run server-side, in this codebase. Going
out over HTTPS and OAuth to reach their own database adds latency, a second auth path to secure, and
a new failure mode, for nothing.

**They call the registry directly**, as functions, under their bundle scope (`oem_agent_bundles`).
MCP is a transport for clients *outside* the process. That is the whole distinction.

What they share is the registry — so the number IRA cites when it nudges Priyanka is produced by the
same query as the number in the COO's brief. **That** is the amalgamation worth having: one
definition of every fact, three ways to reach it.

---

## 6. Latency — 300–800ms first call, faster after

Achievable. Four mechanisms, in order of payoff:

| Mechanism | Effect |
|---|---|
| **Precompute the brief** at 06:00 into a snapshot row. `get_daily_brief` becomes a single-row read | The heaviest call becomes the fastest, ~50ms |
| **Cache `tools/list`** — it is static, so serve it from the edge | Removes cold work from every connect |
| **Short-TTL result cache** per (user, tool, args), 30–60s | A report reader re-asks the same thing; nobody needs 200ms-fresh data |
| **Connection pooling** via the Supabase pooler | Avoids per-request connection setup on serverless |

Stateless MCP helps here: there is no session to rebuild, so a warm function serves the second call
immediately.

---

## 7. Sequencing — internal first, then external

External customers raise the bar sharply: a real authorization server, CIMD, per-customer rate
limits, audit retention, and a support story for broken connections.

| Phase | Scope | Auth | Gate to the next phase |
|---|---|---|---|
| **1. RLS repair** | The 10-15 tables the endpoint will expose | — | A test proving user A cannot read user B's org |
| **2. Registry + brief** | Query registry; the 07:00 brief to the COO | Service scope, internal cron | COO says the brief is worth reading |
| **3. Endpoint, internal** | MCP over the same registry, staff only | Static per-user tokens issued by you | Two staff links behave differently and correctly |
| **4. Endpoint, external** | Customers connect their own links | Managed OAuth 2.1 AS + CIMD | Red-team passes |

**Phase 2 delivers the actual business value with no MCP at all.** If the brief is good, the COO has
already stopped logging in daily. Phases 3 and 4 add the follow-up conversation and then the product
surface. That ordering also means the RLS work is proven internally before any customer touches it.

---

## 8. What I'd still like settled

1. **Which 10-15 tables?** My proposal: the OEM goal chain, tickets, procurement requests and orders,
   SOP completions, meeting rooms. Not CRM leads, not user profiles, not anything with contact or
   compensation data. Confirm and I'll write the registry.
2. **What is in the COO's brief?** Give me his current Monday-morning questions — the five things he
   checks. That is the brief's spec, and it is a better starting point than a table list.
3. **Is the RLS repair authorised as its own piece of work?** It is the bulk of the effort and it
   touches existing modules. Nothing else here is safe to ship without it.
4. **Customer-facing timeline?** If external is months away, phase 4 stays a sketch and we skip the
   managed AS decision for now.

---

## Sources

- [MCP for Zoho CRM — agent servers and scoped access](https://www.zoho.com/crm/developer/mcp.html)
- [Zoho MCP: official servers for CRM and the wider suite](https://www.usecarly.com/blog/zoho-mcp/)
- [Connecting Zoho to AI with MCP servers — practical guide](https://www.flowgenietech.com/blog/zoho-mcp-server-integration-guide)
- [Understanding authorization in MCP — official docs](https://modelcontextprotocol.io/docs/tutorials/security/authorization)
- [MCP permissions: securing AI agent access to tools — Cerbos](https://www.cerbos.dev/blog/mcp-permissions-securing-ai-agent-access-to-tools)
- [MCP authorization with fine-grained access control — Cerbos](https://www.cerbos.dev/blog/mcp-authorization)
- [Implementing user-level permission separation in MCP](https://bytebridge.medium.com/implementing-user-level-permission-separation-in-model-context-protocol-mcp-bf0d525debe9)
