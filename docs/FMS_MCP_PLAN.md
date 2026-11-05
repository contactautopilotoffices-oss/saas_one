# FMS as an MCP server — running abstract

Living document. Last updated 2026-10-26. Update the "Where we are" section whenever something lands.

## Backstory (why this exists)

The FMS started as a facility-management system: tickets, rosters, assets. It grew into the company's operating system. It now holds the CRM (Satej and the lead intake), procurement and the Payment Tracker, Invoice Control, the AOP budget, the org wiki, HR, and a set of AI helpers (Ira, Meera, the Agent Council).

Two things changed in the last few weeks.

1. **People increasingly work from an AI assistant, not from our screens.** The founders ask Claude or another model a question, then open the FMS to act on the answer. The gap between "the assistant knows what to do" and "someone clicks through four screens" is the cost.
2. **The FMS holds the context an assistant needs and cannot get anywhere else.** Which PO is pending, what Purchase said about it, how the vendor's rate compares with last time, which lead went quiet. Models are good at judgement and bad at knowing our business. We are good at the reverse.

So the idea: make the FMS something any assistant can connect to, safely, as the person using it. The assistant reads, proposes and, where the person allows, acts: update a CRM lead, move a ticket to its next stage, approve a PO. Behind that, build our own intelligence layer that decides which model should do which job, so routine work is cheap and hard judgement goes to the best model available.

MCP (Model Context Protocol) is the standard plug for this. One FMS server, and Claude, or any assistant that speaks MCP, can use it.

## What we have in place today

Facts checked in the repo on 2026-10-26.

| Piece | State |
|---|---|
| MCP software library | Installed in the project (`@modelcontextprotocol/sdk`), **not used anywhere in the app yet** |
| Application interfaces | About 560 routes. Each checks the signed-in person's role itself, so the rules already exist |
| Who is calling | Browser sessions and bearer tokens for signed-in users. **No system of personal access tokens or app keys for outside callers** |
| Roles | Org super admin, ops super admin, purchase, accounts, property roles and others, enforced on the server |
| Model routing | Exists for one feature (the Agent Council): OpenAI, Groq or a custom OpenAI-style provider, chosen by settings. **No Anthropic or Gemini route, no task-based routing, no budget caps** |
| Agent rules | `docs/AGENT_DOCTRINE.md` is binding. It already says: new integrations go behind MCP (L9), tool descriptions are the attack surface (L8), measure before promoting an agent (L1, L2, L5), trace every run (L14) |
| Audit habits | Append-only logs already used for invoices and PO approvals. We reuse the pattern |
| CRM, tickets | Routes exist for leads, notes, activities, statuses and tickets, so tools can sit on them |
| PO approval | In progress this week. Each founder links their own Zoho; the approve and reject logic and its safety rules are written, the screens and routes are not |

Not in place: any external way in, any per-tool permission list, any record of what an assistant did on someone's behalf, any model router.

## What we plan to do

### Phase 0 — Decisions only you can make
1. **Who can connect. REVISED 2026-11-05 by the owner: every user who can sign in to the FMS, clients included.** Each person connects as themselves and sees exactly what they see when they log in to the app, nothing more. A property admin of one property sees that property only; a client sees only their own data. (This replaces the 2026-10-26 decision of founders only.)
2. **Which assistants.** Claude first (desktop and web connectors). Any other that supports MCP comes free after.
3. **The action rule.** Reads are open to the person's role. Anything that changes money or customers needs a confirm step (below).
4. **Provider and spend cap. DECIDED 2026-10-26: use Engy.** Cap not yet named; working assumption **US$25 a month hard stop, alert to both founders at 70%**, held in our router (we have not checked any limit on the Engy account itself). Change the number any time.

### Phase 1 — The door (no business actions yet)
- One MCP endpoint inside the FMS (`/api/mcp`).
- **Sign-in as a person.** Each founder creates a personal token in the FMS (or signs in through the standard OAuth screen). **Only an org super admin can create one; the server refuses everyone else, and a token stops working the moment its owner stops being an org super admin.** Every call runs **as that founder, with their role and organisation, reusing the existing checks**. The assistant can never do more than the founder can.
- **A call log:** who, which tool, with what, what happened. Append-only.
- Rate limits per person. A hard deny-list reusing the one the agent runtime already has (secrets, credentials, auth tables are never reachable).
- **Done when:** Claude connects and lists tools, and a wrong or expired token gets nothing.

### Phase 2 — Read tools (safe, and it proves the idea)
Search and fetch only: leads, tickets, pending POs with their lines and terms, the Payment Tracker, the wiki. Each tool description follows the doctrine: what it does, when to use it, when not to, with an example.
- **Done when:** a founder asks Claude "which POs are waiting on me and which look expensive?" and gets a right answer from live data.

### Phase 3 — Write tools, with a safety rule
Three actions first, as you asked:
1. **Update a CRM lead** (status, owner, note).
2. **Move a ticket to the next stage.**
3. **Approve or reject a PO.** Uses each approver's own Zoho link, so Zoho records the right person. Org super admin only.

**The safety rule for every write:** the tool never acts on the first call. It returns a plain-English preview ("Approve BLR-PO-26/27-0372, OMA Private Limited, ₹1,07,952?") and a one-time confirm code. Only a second call with that code acts, and it expires in minutes. Money, vendors and customer data are never changed by one stray model message.
- Each write is limited to the exact fields allowed, checks the live state first (is it still pending?), and is logged with the preview the person saw.
- Prompt-injection guard: text that comes from our data (a lead's note, a vendor's message) is returned as labelled data, never as instructions, and no tool can be triggered by it without a confirm.
- **Done when:** one real lead, one real ticket and one real PO go through the whole preview, confirm and log cycle.

### Phase 4 — The intelligence router
This is the "build intelligence and route to frontier models" part.
- **A router service:** each job is classified (routine, analysis, high-stakes judgement) and sent to the right model tier. Routine to a small cheap model, hard analysis to a frontier model, with a fallback if one is down.
- **Provider: Engy only.** It is already wired in (the OCR reader uses it) and speaks the same OpenAI-style interface. As listed on 2026-10-26 it offers nine models. Proposed tiers:

  | Tier | Model on Engy | Listed price per million tokens (in / out) | Used for |
  |---|---|---|---|
  | Routine | `deepseek-v4-flash-0731` | $0.045 / $0.09 | classify, summarise, draft a note, fill a field |
  | Reading images | `qwen3.8-27b` | $0.045 / $0.32 | invoices, photos |
  | Analysis | `glm-5.3` | $0.98 / $3.08 | compare vendor rates, explain a mismatch |
  | Hard judgement | `kimi-k3` | $1.95 / $9.75 | the pre-approval review, anything a founder will act on |

  Rough cost: a hard-judgement job of 20,000 words-in-tokens and a 2,000-token answer is about 6 US cents; a routine one is a tenth of a cent. A $25 cap is therefore several hundred hard jobs a month.
- **Honest limit of this choice:** these are strong open models, **not Claude or GPT**. Engy has none of those. If a job turns out to need one, the router has a slot for a second provider, but today it is Engy only, so an Engy outage means the intelligence layer waits (the router falls back to another Engy model first).
- **Guard rails:** a monthly cap, a per-job cost ceiling, every call recorded with model, tokens and cost.
- **Prove before promoting:** the doctrine requires tests on the same dataset, on four axes (including tool use and answer quality), before a job is moved to a cheaper tier. Today's runtime does not measure those two axes, so Phase 4 starts by building that measurement.
- **Spec block:** the router and anything agent-like ship with the Agent Spec Block and `[BAA p.N]` citations, or they do not merge.
- **Done when:** one real job (suggested: the PO pre-approval review) runs through the router, with cost per run visible.

### Phase 5 — Rollout
- A settings screen, visible to the founders only, to create and revoke tokens, see the call log and switch tools off.
- A one-page "connect Claude to the FMS" guide.
- Two-week trial with the two founders. There is no later widening: staff never get a connection.

## Risks, plainly
- **Assistant gets tricked by text in our data.** Mitigated by the preview and confirm step and by labelling data as data. Not eliminated, which is why money actions are never one-step.
- **One leaked token.** It acts as one founder, so it is high value. Short expiry, one-click revoke by either founder, an alert to both founders whenever a token is created, and the confirm step on every sensitive action.
- **Cost surprise.** Capped at the router; Engy's prices are low, so the cap is a safety net more than a constraint.
- **Single provider.** Engy is one company. Mitigation: fallback across its nine models now, a second provider slot later if needed.
- **Scope creep.** 560 routes could become 560 tools. We expose a small curated set and add on demand. The doctrine's L8 says a vague tool description sends an assistant the wrong way, so fewer, better-described tools beat many.

## Where we are (update this)
- 2026-10-26 — Plan written. Nothing built for MCP yet.
- 2026-10-26 — PO approval, the first write tool: Zoho link and decision logic written and type-checked; migration written, **not applied**; routes, screen and tests still to do. This work is the same code the MCP approve tool will call, so it is not wasted effort.
- 2026-11-05 — Owner widened access: every FMS user (clients included) can connect, each scoped to their own data. Design section added.
- 2026-11-05 — Phase 1 and 2 built, read only: `/api/mcp`, OAuth consent screen, route catalogue (227 of 440 GET routes), membership fence, call log migration (**not applied**), 8 tools, tests (`npm run test:mcp`). Setup steps in `docs/MCP_CONNECT_GUIDE.md`. Not yet tested against the real Supabase OAuth server, which an admin has to switch on first.

## Design for "every user, their own data" (proposed 2026-11-05)

- **Sign-in:** Supabase Auth's OAuth 2.1 server (public beta). Claude discovers it, the person sees the normal FMS login and an approve screen, and Claude receives a Supabase token for that one user. Revoking it or deactivating the user cuts Claude off. Needs someone to switch it on in the Supabase dashboard (Authentication, OAuth Server) and a small consent page in the app.
- **Same permission checks as the app:** the MCP tools call the app's own API routes as that user, so the role and property filtering already written in each route applies unchanged. No tool reads the database with the admin key on the user's behalf.
- **Coverage:** a catalogue of the app's read (GET) routes, grouped by module, plus one tool that fetches any catalogued route. New screens become available by adding them to the catalogue. The most used modules also get their own well-described tools (doctrine L8).
- **Never exposed:** cron, webhooks, internal, diag, test, auth and session routes, and any GET route found to change data.
- **Writes:** not in the first release. Added later per module, with the preview and confirm step above.
- **Log:** every call recorded (who, which tool, which route, result), append-only.

## Open questions for the founder
1. ~~Who connects~~ Revised 2026-11-05: every FMS user, clients included, each limited to their own data.
2. ~~Provider~~ Decided: Engy. Spend cap: confirm US$25 a month, or name another number.
3. Should a Claude conversation be able to approve a PO at all, or should the assistant only prepare the decision and the founder confirm it in the FMS? (My recommendation: allow it, with the confirm code, for the org super admin only.)
