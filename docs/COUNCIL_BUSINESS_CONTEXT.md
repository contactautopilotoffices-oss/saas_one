# The Agent Council — what it is, who is on it, and what it needs from you

**For: Dipti, Naresh** · From: Lohit · 4 Aug 2026

Please read this end to end once — it is written so that you don't need any technical
background. The last section is the actual ask; everything before it is the context that
makes the ask make sense.

---

## 1. The business problem

The FMS now captures almost everything that happens across our sites — every ticket,
every PPM, every meter reading, every purchase mail, every escalation. Nobody has the
hours to read it. So problems only announce themselves once they are expensive:

- **205 tickets are older than 30 days, and 203 of them were never escalated to anyone.**
  Not because people ignored them — because only 2 of our sites have an escalation ladder
  configured at all. Nobody was ever going to be told.
- **The same complaint gets a different deadline depending on which row it matched.**
  "Lift Breakdown" exists in the system with both a 1-hour and a 24-hour SLA. "AC
  Breakdown" exists five times.
- **Three different screens give three different answers to "how many tickets are active
  right now"** — 213, 48, and 260, from the same underlying rows.

None of this is visible from inside the day-to-day. Ops is running on effort and memory,
and the data that could warn us sits unread. That is the gap the council closes.

## 2. What the Agent Council is

Eight AI specialists — each one a different professional lens — that read **every** number
in the FMS, deliberate with each other, and publish an audit a human can act on.

They work the way a good review committee works:

1. Each member studies the full data independently and writes their own findings.
2. They then read each other's findings **anonymously** and challenge them — weak or
   unsupported claims get called out by the other seven.
3. A chairman merges what survives into one audit: key issues, severity, the measure to
   be taken, and the named person responsible (the SPOC).

Two rules they cannot break:

- **They never invent a number.** Every figure in an audit traces back to a real query
  against our database. If data is missing, they say "this is missing" — that is itself a
  finding.
- **They never act irreversibly on their own.** No external email, no purchase order, no
  permission change, no deletion. The council prepares; a human commits.

This is not hypothetical — the first full session already ran on live data and produced
58 findings, including everything quoted in section 1.

## 3. What this means in real time

- The council **convenes automatically every week** (moving to daily once it has bedded
  in). Each session produces a board of findings and an export-ready PDF audit.
- Every finding is **routed to a real person** with a deadline: critical items are due in
  24 hours, structural items in 3 days, hygiene items in 2 weeks. If nobody owns a
  finding, the audit says so in plain words — "Unassigned, nobody owns this" — rather
  than hiding it.
- Each member has their own identity and mailbox address (e.g.
  `bose.ops@autopilotoffices.com`), so over time you will be able to reply to Bose the
  way you'd reply to a colleague. (Inboxes are the next phase; the identities exist now.)

## 4. Meet the council

Each member below has a **watch** (the data they read every session) and **targets** (the
standards they hold the organisation to). The targets marked *proposed* are defaults I've
set — **part of your job in section 6 is to confirm or correct them**, because a target
the business doesn't recognise is worse than none.

### Bose — Operations Specialist (`bose.ops@autopilotoffices.com`)
Fifteen years running facility floors; thinks in queues — intake, triage, assignment,
resolution, validation. Bose's instinct is that a queue that looks calm is usually a
queue that has stopped moving.
**Watch:** every ticket at every site — ageing, assignment, stuck states, intake quality.
**Targets (proposed):** no ticket unassigned beyond 24h · no ticket aged 30+ days without
an escalation · intake completeness (location + category filled) above 90%. *Today
intake completeness is ~43% — 57% of tickets are missing location.*

### Mehta — Compliance Specialist (`mehta.compliance@autopilotoffices.com`)
Has signed off statutory audits for commercial portfolios and has seen a compliance
failure cost an operator its licence. Not popular in meetings; doesn't care.
**Watch:** SLA definitions and breaches, PPM completion, escalation ladders, audit trail.
**Targets (proposed):** one SLA per issue category, no duplicates · every site has an
escalation ladder · PPM completion 100%. *Today: 74 categories with duplicates and
conflicts, 2 of 12 sites with ladders.*

### Iyer — QA Analyst (`iyer.qa@autopilotoffices.com`)
Breaks systems for a living; distrusts every number until they have tried to disprove it.
Lives in the gap between what two screens claim about the same thing.
**Watch:** cross-checks between screens, reports and the raw data; test artefacts leaking
into production.
**Targets (proposed):** zero contradictions between any two surfaces showing the same
metric. *Today: the three-way "active tickets" disagreement (213 vs 48 vs 260).*

### Rao — Product Lifecycle Analyst (`rao.product@autopilotoffices.com`)
A decade shipping facility-management SaaS; knows what the category leaders do that we
don't. Turns the council's wounds into a sequenced roadmap — every recommendation must
name the exact screen, queue or field, "improve visibility" is banned.
**Watch:** where the product itself causes the data gaps the others find.
**Targets (proposed):** every recurring manual workaround identified and either built or
consciously rejected each quarter.

### Verma — CTO, Security & Platform (`verma.cto@autopilotoffices.com`)
Has incident-commanded two data breaches; reads every dataset the way an attacker would.
**Watch:** access control, tenant data exposure, auth weaknesses, prior-audit items.
**Targets (proposed):** zero cross-tenant data paths · every prior security finding
closed or formally accepted with a name against it.

### Nair — Procurement Specialist (`nair.procurement@autopilotoffices.com`)
Has run purchase desks for multi-site portfolios; knows procurement failures never
announce themselves — they surface three weeks later as an ops emergency that "came out
of nowhere".
**Watch:** the purchase mailbox, request-to-PO pipeline, vendor health, stuck approvals.
**Targets (proposed):** PO turnaround under 5 working days · no purchase request silent
beyond 48h.

### Deshpande — Energy & Utilities Analyst (`deshpande.energy@autopilotoffices.com`)
Managed utilities where electricity is the second-largest cost after rent; knows utility
waste is silent — nobody notices a 15% over-burn until the annual review, when it is
unrecoverable.
**Watch:** meter readings, consumption pace vs budget, diesel and generator logs, gaps in
logging ("water not logged today" is exactly Deshpande's line).
**Targets (proposed):** every meter logged daily by a set time · monthly consumption
within budget pace · zero unexplained reading jumps.

### Kulkarni — Tenant Experience Analyst (`kulkarni.tenant@autopilotoffices.com`)
Ran tenant-success teams in premium buildings; knows tenants never leave over one broken
AC — they leave over the third time they reported it and heard nothing back.
**Watch:** repeat complaints, response silence, reopened tickets, tenant-facing SLAs.
**Targets (proposed):** no tenant reports the same issue 3+ times without a management
conversation · first response on tenant tickets same day.

## 5. Operations is a people's game — and this is what the council is still blind to

Everything above is machinery. Here is the honest limitation: **the council currently
sees roles, not people.** It knows the system contains "property_admin × 2". It does not
know who they are, which sites they carry, what they're measured on, who they escalate
to, or what a normal day looks like for them.

That matters because operations is a people's game. A council that doesn't understand
people can be perfectly right and completely useless — it will dump ten findings on
someone already drowning, blame a site team for a problem that belongs to a vendor, or
flag "low activity" on what is actually someone's weekly off. To **empathise and still
keep the business going**, it has to know the humans: who carries what, what "good"
means for each of them, and what their normal rhythm is — so it praises what deserves
praise, routes work to the right desk at the right load, and reads an absence correctly.

The council cannot learn any of this from the database, because it lives in your heads.
That is the reason for section 6.

## 6. What we need from the two of you — the action points

In priority order. **Do 1–3 first; they change every audit immediately.** Anything you
skip, the council will report as missing rather than guess — so a skipped section is
visible, not silent.

### 1. The people map — who is who ⭐ most important
One row per person who holds responsibility. This is what lets the council route work
fairly and speak to people as people.

| Person | Role | Sites they cover | Reports to | Escalates to | Can decide alone up to | Strengths / notes (e.g. "strong on vendors, stretched thin — covers 2 sites solo") |
|---|---|---|---|---|---|---|
| Sachin Karandikar | property_admin | | | | ₹ | |
| Satej | procurement | | | | ₹ | |
| *…everyone with a role* | | | | | | |

### 2. KRAs and targets — what each role is measured on ⭐
One line per role. **Also correct any "proposed" target in section 4 you disagree with.**

| Role | Measured on | Target | Unit | Reviewed |
|---|---|---|---|---|
| property_admin | SLA compliance on site tickets | 95 | % | monthly |
| property_admin | PPM completion | 100 | % | monthly |
| procurement | PO turnaround, request to release | 5 | days | monthly |
| *…please complete for all roles* | | | | |

### 3. The daily rhythm — what a normal day looks like
This is what makes absence detection real. "Water not logged today" only means something
if the council knows water is *supposed* to be logged by 10am.

| Activity | Who does it | By when | How often | Site(s) |
|---|---|---|---|---|
| Meter readings logged | | e.g. 10:00 | daily | all |
| Site walkaround | | | daily | |
| Diesel reconciliation | | e.g. Monday | weekly | |
| *…everything with a rhythm* | | | | |

### 4. Site profiles — which sites actually matter
| Site | Tier (flagship / standard / satellite) | Category | Client | What the council should know (e.g. "contract renews Mar 2027") |
|---|---|---|---|---|
| SS Plaza | | | | |
| *…all 12* | | | | |

### 5. Client organisations
| Org | Paying client or internal? | Commercially sensitive? | Notes |
|---|---|---|---|
| tcs | | | |
| Autopilot Offices | | | |

"Commercially sensitive" matters because the council drafts emails — it must never put a
pending-payment position in front of an external party.

### 6. Glossary — house vocabulary
Anything you'd explain to a new joiner in week one: site nicknames, abbreviations
("PV", "MST"), vendor short names.

### 7. Policies — rules the org runs by
Free text. e.g. "no PO without two quotes above ₹50,000", "washroom complaints are
same-day", "diesel is reconciled every Monday".

### Three fixes to make in the app itself (not in this sheet)
1. **10 of 12 sites have no city or capacity** — only Rabale and SS Plaza are complete.
   Without size, the council can't rank a big-site problem over a small-site one.
2. **Duplicate issue categories with conflicting SLAs** — merge them so each complaint
   has exactly one deadline.
3. **The SPOC matrix is empty (0 rules)** — which is why everything currently routes to
   the same three people by fallback.

### Who your answers feed

| You provide | Which member it unlocks |
|---|---|
| People map + daily rhythm | Bose (fair routing), Deshpande (absence detection), Kulkarni (response ownership) |
| KRAs and targets | all eight — findings get ranked by consequence instead of by size |
| Site profiles + clients | Mehta (what's a contract risk), Nair (spend priority), Kulkarni (whose tenant) |
| Glossary + policies | everyone — it's the difference between reading our data and understanding it |

---

## How to send it back

A filled-in copy of this file, a spreadsheet with these columns, or an email — any is
fine. It gets loaded once and every future session inherits it. Re-sending a corrected
version updates in place; it will not create duplicates.

(For whoever loads it: entries land via `POST /api/council/context` as
`{ "entries": [{ "kind": "kra", "subject_type": "role", "subject_key": "property_admin", "title": "...", "body": "...", "attributes": {...}, "provided_by": "Dipti" }] }`
— kinds: `kra`, `role_definition`, `site_profile`, `client_profile`, `hierarchy`,
`glossary`, `policy`.)

**What happens after:** every council session reads this before it reads a single
number. A breach of a stated KRA at a flagship site will outrank a bigger number nobody
is accountable for — which is the entire point.
