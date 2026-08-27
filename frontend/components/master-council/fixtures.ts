/**
 * fixtures.ts — Agent Council shared types + recorded fixture data.
 *
 * The types mirror the DB contract in docs/COUNCIL_SPEC.md (council_agents,
 * council_sessions, council_messages, council_findings, council_inbox).
 * The fixture set is one full recorded session so the chamber renders without
 * auth at /cc-preview/council; the live dashboard fetches the same shapes from
 * /api/council/*.
 *
 * Post-MVP (not built, per spec): real Zoho mailboxes, WhatsApp hooks, voice
 * duplex, cron-convened audits, multi-model council, super-admin promotion.
 */

export type AgentKey =
  | 'ops'
  | 'compliance'
  | 'qa'
  | 'product'
  | 'cto'
  | 'procurement'
  | 'energy'
  | 'tenant';

export type Severity = 'P0' | 'P1' | 'P2';
export type FindingStatus = 'open' | 'acked' | 'resolved' | 'dismissed';
export type SessionStatus =
  | 'running'
  | 'stage1'
  | 'stage2'
  | 'synthesis'
  | 'complete'
  | 'failed';
export type MessageStage = 'opinion' | 'review' | 'synthesis';
export type InboxDirection = 'in' | 'out';
export type InboxStatus = 'received' | 'draft' | 'sent';

export interface CouncilAgent {
  key: AgentKey;
  name: string;
  title: string;
  email: string;
  lens: string;
  color: string;
  sort: number;
}

export interface CouncilFinding {
  id: string;
  session_id: string;
  agent_key: AgentKey;
  severity: Severity;
  title: string;
  detail: string;
  recommendation: string;
  status: FindingStatus;
  created_at: string;
}

export interface CouncilMessage {
  id: string;
  session_id: string;
  agent_key: AgentKey | 'chairman';
  stage: MessageStage;
  /** Anonymized handle used during stage 2, e.g. "Agent C". */
  label: string | null;
  content: string;
  findings: CouncilFinding[] | null;
  /** Stage 2 only: anonymized labels ranked best → worst by this reviewer. */
  ranked_labels: string[] | null;
  created_at: string;
}

export interface CouncilSession {
  id: string;
  question: string;
  status: SessionStatus;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface CouncilInboxMessage {
  id: string;
  agent_key: AgentKey;
  direction: InboxDirection;
  from_addr: string;
  to_addr: string;
  subject: string;
  body_html: string;
  status: InboxStatus;
  created_at: string;
}

export interface CouncilFixtures {
  agents: CouncilAgent[];
  sessions: CouncilSession[];
  session: CouncilSession;
  messages: CouncilMessage[];
  findings: CouncilFinding[];
  inbox: CouncilInboxMessage[];
  assignments: CouncilAssignment[];
}

/**
 * One finding routed to one owner. Mirrors council_assignments
 * (supabase/migrations/20260803000002_council_dispatch.sql) — the SPOC line in
 * the brief comes from here.
 */
export interface CouncilAssignment {
  id: string;
  finding_id: string;
  severity: Severity;
  assignee_user_id: string | null;
  assigned_role: string | null;
  routed_by: 'spoc_rule' | 'role_fallback' | 'unassigned';
  due_at: string | null;
  status: 'open' | 'acked' | 'done' | 'dismissed';
  assignee?: { full_name?: string | null; email?: string | null } | null;
}

/* ------------------------------------------------------------------ agents */

export const COUNCIL_AGENTS: CouncilAgent[] = [
  { key: 'ops',         name: 'Bose',      title: 'Operations Specialist',       email: 'bose.ops@autopilotoffices.com',         lens: 'Ticket flow, triage discipline, SLA, aging, intake quality',        color: '#708F96', sort: 1 },
  { key: 'compliance',  name: 'Mehta',     title: 'Compliance Specialist',       email: 'mehta.compliance@autopilotoffices.com',  lens: 'Audit trail, test artifacts in prod, regulatory calendar, hygiene', color: '#AA895F', sort: 2 },
  { key: 'qa',          name: 'Iyer',      title: 'QA Analyst',                  email: 'iyer.qa@autopilotoffices.com',          lens: 'Role scoping, workflow repro, cross-role visibility, mismatches',   color: '#3B82F6', sort: 3 },
  { key: 'product',     name: 'Rao',       title: 'Product Lifecycle Analyst',   email: 'rao.product@autopilotoffices.com',     lens: 'Feature gaps vs industry standard, roadmap sequencing, quick wins', color: '#10B981', sort: 4 },
  { key: 'cto',         name: 'Verma',     title: 'CTO — Security & Platform',   email: 'verma.cto@autopilotoffices.com',         lens: 'Data breaches, public buckets, unauth routes, shared-auth, RLS',    color: '#EF4444', sort: 5 },
  { key: 'procurement', name: 'Nair',      title: 'Procurement Specialist',      email: 'nair.procurement@autopilotoffices.com', lens: 'PO pipeline, mailbox, vendor delays, spend alignment',              color: '#F59E0B', sort: 6 },
  { key: 'energy',      name: 'Deshpande', title: 'Energy & Utilities Analyst',  email: 'deshpande.energy@autopilotoffices.com',      lens: 'Electricity / water / DG pace, anomalies, missing logs',            color: '#8B5CF6', sort: 7 },
  { key: 'tenant',      name: 'Kulkarni',  title: 'Tenant Experience Analyst',   email: 'kulkarni.tenant@autopilotoffices.com',      lens: 'Tenant-side friction, validation backlog, comms quality',           color: '#EC4899', sort: 8 },
];

export const agentByKey = (key: string): CouncilAgent =>
  COUNCIL_AGENTS.find((a) => a.key === key) ?? COUNCIL_AGENTS[0];

export const agentInitials = (name: string): string =>
  name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

/* ----------------------------------------------------------------- session */

const SID = '11111111-2222-4333-8444-0000000000c1';
const T0 = '2026-08-02T10:42:00.000Z';

const at = (min: number): string =>
  new Date(new Date(T0).getTime() + min * 60000).toISOString();

export const FIXTURE_SESSION: CouncilSession = {
  id: SID,
  question:
    'Weekly audit — where are we bleeding? What is broken, what is risky, and what do we fix first?',
  status: 'complete',
  error: null,
  created_at: T0,
  completed_at: at(4),
};

export const FIXTURE_SESSIONS: CouncilSession[] = [
  FIXTURE_SESSION,
  {
    id: '11111111-2222-4333-8444-0000000000c0',
    question: 'Deep dive — why is the procurement mailbox behind?',
    status: 'complete',
    error: null,
    created_at: '2026-07-26T10:30:00.000Z',
    completed_at: '2026-07-26T10:34:00.000Z',
  },
  {
    id: '11111111-2222-4333-8444-0000000000bf',
    question: 'Is the energy module ready for the board review?',
    status: 'failed',
    error: 'Stage 1 aborted: data pack section "electricity pace" exceeded token budget.',
    created_at: '2026-07-19T10:30:00.000Z',
    completed_at: null,
  },
];

/* ---------------------------------------------------------------- findings */

let seq = 0;
const f = (
  agent_key: AgentKey,
  severity: Severity,
  title: string,
  detail: string,
  recommendation: string,
  status: FindingStatus = 'open',
  min = 1,
): CouncilFinding => ({
  id: `${SID}-f${String(++seq).padStart(2, '0')}`,
  session_id: SID,
  agent_key,
  severity,
  title,
  detail,
  recommendation,
  status,
  created_at: at(min),
});

export const FIXTURE_FINDINGS: CouncilFinding[] = [
  // cto — Verma
  f('cto', 'P0', '`ticket-photos` storage bucket is public — tenant evidence enumerable',
    'Bucket `ticket-photos` has public=true. ~2,300 objects (meter readings, damage evidence, visitor IDs) return HTTP 200 with no session; filenames are sequential so the set is enumerable.',
    'Flip the bucket to private, serve via signed URLs in the ticket UI, rotate existing object paths. Owner: Verma. 1 day.', 'open', 1),
  f('cto', 'P0', 'Technician ticket visibility is an RLS failure, not a UI bug',
    'The technician select path joins through a shared-auth helper that drops the org + assignee predicate. Policy `tickets_technician_select` has no assignee clause — every technician reads all 704 org tickets.',
    'Add the assignee predicate to the policy; add a per-role RLS regression test to CI. Pair with Iyer. 2 days.', 'open', 1),
  f('cto', 'P1', 'Three API routes answer 200 with org metadata and no session',
    '/api/properties/list, /api/meters/summary and /api/vendors/lookup respond to unauthenticated requests with org-scoped metadata (names, unit counts, vendor emails).',
    'Move the three handlers behind the session guard; add an unauth smoke test.', 'open', 1),

  // qa — Iyer
  f('qa', 'P0', 'Technician role mis-scoped: sees 704 tickets, assigned 12',
    'Repro (staging, 4 steps): login as technician R. Sharma → open ticket list → 704 rows render → only 12 carry his assignee id. Cross-role visibility confirmed from the tenant account too.',
    'Treat as P0 security defect; verify the fix against every role matrix row, not just technician.', 'open', 2),
  f('qa', 'P1', 'Dashboard counts 1,198 tickets; table and export return 704',
    'Engagement dashboard shows 1,198 tickets. Direct count and the xlsx export both return 704. The 494-row delta is soft-deleted rows counted without `deleted_at is null` plus a cross-org join double-counting shared properties.',
    'Fix the dashboard aggregation before the board meeting — leadership is quoting 1,198.', 'open', 2),
  f('qa', 'P2', 'Tenant @-assign picker returns zero assignable users',
    'Repro: as tenant, open any ticket → comment composer → type "@" → picker opens with 0 results; resolver and admin roles see the full list. Tenants cannot direct a comment to their SPOC.',
    'Align the picker query with the resolver path; add a tenant-role e2e assertion.', 'open', 2),

  // ops — Bose
  f('ops', 'P0', 'TKT-0231 is 104 days old — the elevator nobody owns',
    'Freight elevator ticket (Tower B) opened 104 days ago: 9 reassignments, zero status changes in 61 days. It is the oldest open ticket by 3.2× the next worst and anchors the tenant grievance narrative.',
    'Escalate to the lift AMC vendor today; standup flag for anything >30 days. No code needed.', 'open', 1),
  f('ops', 'P1', '63 tickets sat unassigned past 48 h after intake',
    '9% of last month\'s intake had no assignee at the 48-hour mark. These age straight into the >30-day bucket — the 104-day ticket started here.',
    'Auto-assign on category at intake; page the duty SPOC at 24 h unassigned.', 'open', 1),
  f('ops', 'P2', '22% of tickets arrive with no category',
    'Kiosk and email intake allow empty category; those tickets route to the general pool and wait longest for triage.',
    'Require category at intake (default "General" is fine); backfill the 22% via import script.', 'open', 1),

  // compliance — Mehta
  f('compliance', 'P1', 'Super admin lockout left the org with zero admins for ~6 h',
    'A membership removal emptied the org\'s active admin roster; recovery required master-admin override. No audit-trail row exists for the removal — we cannot say who did it or when.',
    'Guard the last-admin removal in the membership RPC; write the audit row before, not after, the mutation.', 'open', 2),
  f('compliance', 'P2', '14 test tickets from import scripts sit inside live counts',
    'Tickets titled "test"/"demo" created by migration scripts are counted in open-ticket metrics and tenant-facing summaries.',
    'Add is_test flag, exclude from every metric, soft-delete the existing 14.', 'open', 2),
  f('compliance', 'P2', 'DG set service log is 21 days overdue',
    'Diesel generator service entry was due 21 days ago; the pollution-board inspection window opens next month.',
    'Log the service this week; add a calendar reminder 7 days before due.', 'open', 2),

  // product — Rao
  f('product', 'P1', 'Tenant @-assign picker is a table-stakes gap, not a nicety',
    'Every CMMS in the reference set lets a reporter direct a comment. Our tenants cannot; they escalate to WhatsApp instead, which is why comms quality scores low.',
    'Ship the picker behind the existing mention component; it is the highest-UX-leverage item on this board.', 'open', 3),
  f('product', 'P2', 'Quick win: aging sort on the ticket list',
    'One query param (sort=oldest) would surface the 104-day class of tickets to every SPOC without a dashboard change.',
    'Ship behind the existing list filter bar. Half a day.', 'open', 3),
  f('product', 'P2', 'Quick win: bulk-assign + saved filters',
    'Triage is 5 clicks per ticket today; bulk-assign with saved filter sets clears ~41% of those keystrokes against the measured backlog.',
    'Sequence after aging sort; reuse the kanban bulk action.', 'open', 3),

  // procurement — Nair
  f('procurement', 'P1', '9 vendor invoices unread in the PO mailbox for 5+ days',
    'Two vendors have already escalated on WhatsApp. Payment clock risk on 4 of the 9; one is the lift AMC vendor tied to the 104-day ticket.',
    'Clear the mailbox today; route invoices to the PO pipeline on arrival, not on read.', 'open', 3),
  f('procurement', 'P2', '34% of POs have no GRN linkage',
    'Spend alignment is fuzzy: a third of purchase orders cannot be tied to goods receipt, so accruals are estimated.',
    'Enforce GRN reference at PO close; backfill via vendor statement match.', 'open', 3),
  f('procurement', 'P2', 'Diesel procurement cadence ignores DG run-hours',
    'Diesel is ordered on calendar, but run-hours say the sets burned 18% less this month — capital sits in the tank.',
    'Trigger diesel orders on run-hour threshold, not date.', 'open', 3),

  // energy — Deshpande
  f('energy', 'P1', 'Water unlogged 6 of the last 14 days at 2 properties',
    'The AOP pace line is interpolating silently across the gaps; the water budget variance shown this week is invented data.',
    'Daily "water not logged" nudge to the property SPOC; mark interpolated spans on the pace chart.', 'open', 4),
  f('energy', 'P2', 'Electricity pace 8% above AOP trajectory at one site',
    'Site-level pace is 8% over the annual operating plan line with no logged anomaly; HVAC schedule change is the likely driver.',
    'Confirm the schedule change with the site team; annotate the pace chart.', 'open', 4),
  f('energy', 'P2', '3 generators missing run-hour entries for 11 days',
    'Without run-hours the diesel-burn audit and the procurement cadence finding cannot be verified.',
    'Backfill from the DG logbook; require run-hours at diesel log time.', 'open', 4),

  // tenant — Kulkarni
  f('tenant', 'P1', '31 tenant tickets await validation for over 72 h',
    'Tenants see "open" with no signal that anyone has looked. Validation backlog is the top driver of repeat calls to the helpdesk.',
    'Auto-acknowledge with a validation ETA; page the validator queue at 48 h.', 'open', 4),
  f('tenant', 'P2', '40% of resolutions never notify the tenant',
    'Status changes to resolved without a tenant-facing message in 40% of sampled tickets; tenants learn by calling back.',
    'Send the resolution template on every status→resolved transition; no exceptions.', 'open', 4),
  f('tenant', 'P2', 'Kiosk forces tenants to guess a category',
    'The kiosk intake requires a category the tenant cannot know; misroutes land in the general pool (matches Bose\'s 22% finding from the other side).',
    'Offer "Not sure" with a photo-first flow; let triage set the category.', 'open', 4),
];

/* ---------------------------------------------------------------- messages */

const opinion = (
  agent_key: AgentKey,
  label: string,
  content: string,
  min: number,
): CouncilMessage => ({
  id: `${SID}-op-${agent_key}`,
  session_id: SID,
  agent_key,
  stage: 'opinion',
  label,
  content,
  findings: FIXTURE_FINDINGS.filter((x) => x.agent_key === agent_key),
  ranked_labels: null,
  created_at: at(min),
});

export const FIXTURE_OPINIONS: CouncilMessage[] = [
  opinion('cto', 'Agent A',
    'Two of my three findings are not opinions, they are packets I captured. The photo bucket answers 200 to an anonymous curl; the technician role reads 704 rows because the RLS policy lacks the assignee predicate. Fix the bucket today and the policy tomorrow — everything else on my list is hygiene by comparison.',
    1),
  opinion('qa', 'Agent B',
    'I reproduce before I report. Technician scoping fails in 4 steps on staging. The 1,198-vs-704 gap is two query bugs, not one: missing deleted_at predicate and a cross-org double count. The tenant @-assign picker returns an empty set — small bug, loud symptom.',
    2),
  opinion('ops', 'Agent C',
    'Flow is honest until intake ends, then it decays. One ticket is 104 days old with 9 reassignments and no owner; 63 more sat unassigned past 48 hours. Aging is a policy problem before it is a software problem — nothing in the org fires at day 30.',
    1),
  opinion('compliance', 'Agent D',
    'The super admin lockout is the finding that keeps me up: zero active admins for six hours and no audit row for the removal that caused it. Add fourteen test tickets polluting live counts and a DG service log 21 days overdue, right before inspection season.',
    2),
  opinion('product', 'Agent E',
    'Half this board is shipped software away from shrinking. The tenant @-assign picker is table stakes in every reference product. Aging sort is one query param. Bulk-assign clears two-fifths of triage keystrokes. Sequence: picker, sort, bulk.',
    3),
  opinion('procurement', 'Agent F',
    'Nine invoices unread for five days, and one of them belongs to the same lift AMC vendor the 104-day ticket is waiting on. Procurement is not slow — it is unread. A third of POs cannot be tied to goods receipt, so the spend number is an estimate.',
    3),
  opinion('energy', 'Agent G',
    'Water was not logged on 6 of the last 14 days at two properties, and the pace chart interpolates across the gap without saying so. The variance you are quoting this week is invented. Diesel procurement runs on calendar while run-hours say burn is down 18%.',
    4),
  opinion('tenant', 'Agent H',
    'Thirty-one tickets wait over 72 hours for validation and the tenant sees nothing. Forty percent of resolutions never notify. The kiosk asks tenants to guess a category they cannot know, then punishes the guess with the slowest queue. Friction is compounding quietly.',
    4),
];

const review = (
  agent_key: AgentKey,
  ranked_labels: string[],
  content: string,
  min: number,
): CouncilMessage => ({
  id: `${SID}-rv-${agent_key}`,
  session_id: SID,
  agent_key,
  stage: 'review',
  label: null,
  content,
  findings: null,
  ranked_labels,
  created_at: at(min),
});

export const FIXTURE_REVIEWS: CouncilMessage[] = [
  review('cto',        ['Agent B', 'Agent C', 'Agent D'],
    'Agent B brings receipts — repro steps and row counts for every claim. Agent C names the oldest wound precisely. Agent D ties the lockout to a missing audit row, which is the part that is actually reportable.', 3),
  review('qa',         ['Agent A', 'Agent C', 'Agent H'],
    'Agent A shows packets, not adjectives — the curl output settles argument. Agent C quantifies aging instead of lamenting it. Agent H connects three small frictions into one compounding pattern.', 3),
  review('ops',        ['Agent C', 'Agent B', 'Agent F'],
    'I rank my own aging analysis high on actionability — the ask needs no deploy. Agent B\'s 494-row delta is the most useful correction on the board. Agent F found the vendor link to the elevator ticket.', 3),
  review('compliance', ['Agent D', 'Agent A', 'Agent B'],
    'The lockout register entry stands on evidence. Agent A is the only analysis that is already a breach report. Agent B protects the numbers leadership quotes.', 3),
  review('product',    ['Agent E', 'Agent B', 'Agent A'],
    'Sequencing is my job and Agent E has one. Agent B defines the mismatch precisely enough to fix in a day. Agent A is not a roadmap item but it outranks everything.', 4),
  review('procurement',['Agent F', 'Agent C', 'Agent G'],
    'The mailbox finding has names, counts and an escalation trail. Agent C\'s unassigned-63 explains where aged tickets are born. Agent G caught the chart silently inventing data.', 4),
  review('energy',     ['Agent G', 'Agent A', 'Agent D'],
    'The water-log gap is dated, counted and located. Agent A is airtight. Agent D\'s overdue DG log intersects my run-hour gap — same logbook.', 4),
  review('tenant',     ['Agent H', 'Agent C', 'Agent E'],
    'Agent H speaks in the tenant\'s units: hours waited, calls repeated. Agent C owns the oldest ticket. Agent E\'s picker is the fix my backlog needs most.', 4),
];

export const FIXTURE_SYNTHESIS: CouncilMessage = {
  id: `${SID}-syn`,
  session_id: SID,
  agent_key: 'chairman',
  stage: 'synthesis',
  label: 'Chairman',
  findings: null,
  ranked_labels: null,
  created_at: at(4),
  content: `# Council Audit — Week 31, 2026

Eight lenses, one data pack. The council converged on **3 P0s**, each independently confirmed by at least two agents. Peer review ranks the security and QA analyses highest on evidence quality.

## P0 — fix this week

### 1. Public photo bucket exposes ~2,300 tenant evidence photos
**Repro:** anonymous \`GET\` on any known \`ticket-photos\` object path returns 200; filenames are sequential, so the set is enumerable.
**Impact:** meter readings, damage evidence and visitor IDs are reachable by anyone. This is breach-notification territory — tenants were promised evidence confidentiality.
**Ask:** flip the bucket private, serve signed URLs in the ticket UI, rotate object paths. Verma owns; 1 day.

### 2. Technician role reads the whole org — scoping failure, not a UI bug
**Repro:** login as technician (R. Sharma) → ticket list returns all 704 org tickets; 12 are assigned to him. Iyer reproduced on staging in 4 steps.
**Impact:** every technician sees every tenant complaint, contact number and unit. Policy \`tickets_technician_select\` is missing the assignee predicate. Combined with P0-1, the blast radius is the tenant dataset.
**Ask:** add the predicate, regression-test every role-matrix row. Verma + Iyer pair; 2 days.

### 3. The 104-day ticket — the elevator nobody owns
**Repro:** TKT-0231 (freight elevator, Tower B) opened 104 days ago: 9 reassignments, zero status changes in 61 days.
**Impact:** the loudest single tenant grievance on record, and it anchors the validation-backlog narrative (31 tickets >72 h). At this age the SLA is not breached — it is meaningless.
**Ask:** Bose escalates to the lift AMC vendor today (their invoice sits unread in Nair's mailbox — 5 days). Standup flag for anything >30 days. No code.

## Data trust — the numbers don't reconcile

- Engagement dashboard reports **1,198** tickets; the table and the export return **704**. Iyer traced the 494-row delta to soft-deleted rows counted without \`deleted_at is null\` plus a cross-org join double-counting shared properties. **Fix before the board meeting — leadership is quoting 1,198.**
- 14 "test"/"demo" tickets from import scripts sit inside live counts (Mehta). Add \`is_test\`, exclude from metrics.
- Water unlogged 6 of the last 14 days at 2 properties (Deshpande) — the AOP pace line interpolates silently across the gaps.

## Quick wins — ship in ≤2 days each

1. **Aging sort** on the ticket list — one query param surfaces the 104-day class (Rao).
2. **Bulk-assign + saved filters** — clears ~41% of triage keystrokes against the measured backlog (Rao).
3. **\`is_test\` flag + metric exclusion** (Mehta).
4. **"Water not logged" daily nudge** to the property SPOC (Deshpande).

## Open questions

- Who owns ticket lifecycle policy — ops or product? The 104-day ticket survived 9 reassignments because no metric fires at day 30.
- Tenant @-assign picker: designed out or never built? The roadmap says Q3; tenants are escalating on WhatsApp now.
- Super admin lockout: the membership removal that emptied the admin roster has **no audit row**. Bug, or procedure gap?

## Compliance exposure — Mehta's register

- Super admin lockout left the org with **zero active admins for ~6 hours**; recovery needed master-admin override with no audit-trail entry — a reportable process gap under our own ISMS.
- DG service log 21 days overdue; the pollution-board inspection window opens next month.
- The public bucket (P0-1) likely triggers breach-notification duty if any photo contains personal data. Assume it does.

---

*Chairman's synthesis of 8 opinions, 22 findings, cross-confirmed by anonymized peer ranking. Data pack fetched 02 Aug 2026, 16:12 IST.*`,
};

export const FIXTURE_MESSAGES: CouncilMessage[] = [
  ...FIXTURE_OPINIONS,
  ...FIXTURE_REVIEWS,
  FIXTURE_SYNTHESIS,
];

/* ------------------------------------------------------------------- inbox */

export const FIXTURE_INBOX: CouncilInboxMessage[] = [
  {
    id: 'inbox-01',
    agent_key: 'cto',
    direction: 'in',
    from_addr: 'saniel@aop.com',
    to_addr: 'verma.cto@autopilotoffices.com',
    subject: 'Bucket exposure — confirm scope before Friday\'s board',
    body_html: '<p>Verma — before I put the storage finding on the board slide, confirm two things: is the enumerable set limited to <code>ticket-photos</code>, and do we have object-level logs to say whether anyone outside the org fetched one?</p>',
    status: 'received',
    created_at: '2026-08-02T12:05:00.000Z',
  },
  {
    id: 'inbox-02',
    agent_key: 'cto',
    direction: 'out',
    from_addr: 'Verma — CTO · Security & Platform <verma.cto@autopilotoffices.com>',
    to_addr: 'saniel@aop.com',
    subject: 'Re: Bucket exposure — confirm scope before Friday\'s board',
    body_html: '<p>Confirmed on both. The public flag is on <code>ticket-photos</code> only; the other six buckets are private. Access logs are retained 7 days — I pulled them this morning: no unauthenticated GET pattern outside our own property dashboards in the window. I would still rotate object paths after the flip; the URL pattern has been guessable since April.</p><p>Fix PR is staged behind the signed-URL change. One day, no downtime.</p>',
    status: 'draft',
    created_at: '2026-08-02T12:09:00.000Z',
  },
  {
    id: 'inbox-03',
    agent_key: 'ops',
    direction: 'in',
    from_addr: 'r.deshmukh@towerb-fm.com',
    to_addr: 'bose.ops@autopilotoffices.com',
    subject: 'TKT-0231 — residents are asking for a date',
    body_html: '<p>Bose, the Tower B residents\' association asked me in writing for a repair date on the freight elevator. It has been 104 days. What do I tell them?</p>',
    status: 'received',
    created_at: '2026-08-01T17:40:00.000Z',
  },
  {
    id: 'inbox-04',
    agent_key: 'ops',
    direction: 'out',
    from_addr: 'Bose — Operations Specialist <bose.ops@autopilotoffices.com>',
    to_addr: 'r.deshmukh@towerb-fm.com',
    subject: 'Re: TKT-0231 — residents are asking for a date',
    body_html: '<p>Give them this: the AMC vendor visit is being scheduled today, and I am personally on the ticket until it closes. You will have a firm date within 48 hours, and a daily status note until then — no more silence.</p>',
    status: 'sent',
    created_at: '2026-08-01T18:02:00.000Z',
  },
  {
    id: 'inbox-05',
    agent_key: 'tenant',
    direction: 'in',
    from_addr: 'saniel@aop.com',
    to_addr: 'kulkarni.tenant@autopilotoffices.com',
    subject: 'Validation backlog — what does the tenant actually see?',
    body_html: '<p>Kulkarni — walk me through the tenant\'s screen during those 72+ hours. Exactly what copy do they stare at?</p>',
    status: 'received',
    created_at: '2026-08-02T09:15:00.000Z',
  },
  {
    id: 'inbox-06',
    agent_key: 'tenant',
    direction: 'out',
    from_addr: 'Kulkarni — Tenant Experience Analyst <kulkarni.tenant@autopilotoffices.com>',
    to_addr: 'saniel@aop.com',
    subject: 'Re: Validation backlog — what does the tenant actually see?',
    body_html: '<p>They see the word <em>Open</em>, a timestamp, and nothing else — no owner, no ETA, no signal that a human has read it. After 48 hours they call the helpdesk, which is why repeat calls track the validation queue almost one-to-one. An auto-acknowledgement with a validation ETA is the cheapest fix on the board.</p>',
    status: 'draft',
    created_at: '2026-08-02T09:22:00.000Z',
  },
  {
    id: 'inbox-07',
    agent_key: 'procurement',
    direction: 'out',
    from_addr: 'Nair — Procurement Specialist <nair.procurement@autopilotoffices.com>',
    to_addr: 'ap@skyline-lifts.com',
    subject: 'Invoice #SL-2214 — received, payment date confirmation needed',
    body_html: '<p>Your invoice was located in the mailbox backlog and is now in the PO pipeline. Please confirm the service visit date for the Tower B freight elevator — the payment run and the repair schedule will be cleared together this week.</p>',
    status: 'sent',
    created_at: '2026-08-02T11:30:00.000Z',
  },
];

/**
 * Preview assignments. Desks and SLA hours mirror backend/lib/council/dispatch.ts
 * (AGENT_ROUTING + SLA_HOURS) and the names are the real actives that routing
 * resolved to on this org, so the harness shows what production shows.
 * One P0 is deliberately left unowned — an unassigned critical is a state the
 * brief must render loudly, so it needs to be visible in the preview too.
 */
const DESK: Record<AgentKey, { name: string; role: string }> = {
  ops:         { name: 'Sachin karandikar', role: 'property_admin' },
  tenant:      { name: 'Sachin karandikar', role: 'property_admin' },
  energy:      { name: 'Sachin karandikar', role: 'property_admin' },
  procurement: { name: 'Satej',             role: 'procurement' },
  compliance:  { name: 'Saniel Golechha',   role: 'org_super_admin' },
  qa:          { name: 'Saniel Golechha',   role: 'org_super_admin' },
  cto:         { name: 'Saniel Golechha',   role: 'org_super_admin' },
  product:     { name: 'Saniel Golechha',   role: 'org_super_admin' },
};
const SLA_H: Record<Severity, number> = { P0: 24, P1: 72, P2: 336 };

export const FIXTURE_ASSIGNMENTS: CouncilAssignment[] = FIXTURE_FINDINGS.map((fd, i) => {
  const desk = DESK[fd.agent_key];
  // Leave the second finding unowned so the "nobody owns this" state is exercised.
  const unowned = i === 1;
  return {
    id: `${SID}-a${String(i + 1).padStart(2, '0')}`,
    finding_id: fd.id,
    severity: fd.severity,
    assignee_user_id: unowned ? null : `u-${fd.agent_key}`,
    assigned_role: unowned ? null : desk.role,
    routed_by: unowned ? 'unassigned' : 'role_fallback',
    // Stagger due dates so a couple of the P0s read as already overdue.
    due_at: new Date(Date.parse(fd.created_at) + (SLA_H[fd.severity] - (i % 3) * 30) * 3600_000).toISOString(),
    status: 'open',
    assignee: unowned ? null : { full_name: desk.name },
  };
});

export const COUNCIL_FIXTURES: CouncilFixtures = {
  agents: COUNCIL_AGENTS,
  sessions: FIXTURE_SESSIONS,
  session: FIXTURE_SESSION,
  messages: FIXTURE_MESSAGES,
  findings: FIXTURE_FINDINGS,
  inbox: FIXTURE_INBOX,
  assignments: FIXTURE_ASSIGNMENTS,
};
