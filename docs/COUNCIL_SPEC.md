# The Agent Council — MVP Spec (binding contract)

**Thesis:** the FMS today is an input/output engine (tickets in, status out).
The Council makes it an impact engine: find every ounce of data, tie value to
it, and give the org a voice that speaks back — audits, findings, emails.
Playground: **master admin only**. Promotion to super admin comes later.

**Reference protocol:** `scratch/llm-council-ref/` (karpathy/llm-council) —
adapted: Stage 1 each persona analyzes independently → Stage 2 anonymized
peer review + ranking → Stage 3 chairman synthesis. Our council reads a REAL
FMS data pack, not just a user prompt.

**CEO audit email (in this task's conversation) is the product spec for
output quality** — the council's weekly audit must be able to produce findings
of that shape: P0s with repro/impact/ask, data-trust discrepancies, quick-win
shortlist, open questions, compliance exposure.

## The 8 founding agents (seeded)

| key | Name / Title | Lens |
|---|---|---|
| ops | **Bose** — Operations Specialist | ticket flow, triage discipline, SLA, aging, intake quality |
| compliance | **Mehta** — Compliance Specialist | audit trail, test artifacts in prod, regulatory calendar, data hygiene |
| qa | **Iyer** — QA Analyst | role scoping, workflow repro, cross-role visibility, mismatch hunting |
| product | **Rao** — Product Lifecycle Analyst | feature gaps vs industry standard, roadmap sequencing, quick wins |
| cto | **Verma** — CTO (Security & Platform) | data breaches, public buckets, unauth routes, shared-auth bugs, RLS |
| procurement | **Nair** — Procurement Specialist | PO pipeline, mailbox, vendor delays, spend alignment |
| energy | **Deshpande** — Energy & Utilities Analyst | electricity/water/DG pace, anomalies, missing logs ("water not logged today") |
| tenant | **Kulkarni** — Tenant Experience Analyst | tenant-side friction, validation backlog, comms quality |

Emails: `<name>.<key>@autopilotoffices.com` (virtual; real Zoho provisioning is
post-MVP). Each agent has its own DB inbox.

## DB — migration `supabase/migrations/20260803000001_agent_council.sql`

- `council_agents` (id uuid pk, org_id uuid, key text, name text, title text,
  email text, lens text, persona text, color text, sort int, is_active bool)
- `council_sessions` (id uuid pk, org_id, question text, trigger text
  ('manual'|'scheduled'), status text ('running'|'stage1'|'stage2'|'synthesis'|
  'complete'|'failed'), data_pack jsonb, error text, created_by uuid,
  created_at, completed_at)
- `council_messages` (id uuid pk, session_id fk, agent_key text, stage text
  ('opinion'|'review'|'synthesis'), label text (anonymized id for stage 2),
  content text, findings jsonb, model text, created_at)
- `council_findings` (id uuid pk, org_id, session_id fk, agent_key, severity
  text ('P0'|'P1'|'P2'), title text, detail text, evidence jsonb,
  recommendation text, status text ('open'|'acked'|'resolved'|'dismissed'),
  created_at)
- `council_inbox` (id uuid pk, org_id, agent_key, direction text
  ('in'|'out'), from_addr text, to_addr text, subject text, body_html text,
  status text ('received'|'draft'|'sent'), session_id uuid null, created_at)
- RLS: enable on all five; org-scoped read/write via the same membership
  function pattern used by neighboring migrations. Master-admin routes use the
  admin client anyway; RLS is defense-in-depth. Seed the 8 agents for org
  `211e1330-ad83-446d-941f-dcea48396798`.

## Council engine — `backend/lib/council/`

- `llm.ts` — OpenAI chat (`OPENAI_API_KEY`, model from `COUNCIL_MODEL`,
  default `gpt-5.6-luna`), following the fetch/cost pattern of
  `backend/services/mailboxDigest.ts` and
  `app/api/electricity/tracker/explain/route.ts`.
  **Superseded 2026-08-02: this was originally specced as Groq +
  `llama-3.3-70b-versatile`.** A session is ~17 calls carrying the full data
  pack (~134k tokens measured), and `GROQ_API_KEY` is a shared 100k-token
  DAILY org-wide budget also serving the ticket classifier, meter OCR,
  catalog upload, call coaching and the master-admin chatbot — a single
  council session could not complete without exhausting it and taking those
  features down. Measured cost on OpenAI: ~$0.05 per full session.
  Note `gpt-5.x` rejects custom `temperature` and `max_tokens`, so the
  low-temperature knob for parseable JSON is unavailable on the default
  model; determinism rests on the lenient parser in `runner.ts`.
- `dataPack.ts` — server-side, admin client. Gather: tickets summary (all),
  ticket aging extremes, AOP summary, procurement mailbox summary, electricity
  pace, PPM summary, roster coverage, generators/diesel, recent import
  warnings, public-bucket/unauth-route facts already known (as static
  security notes for the CTO lens — mark provenance). REUSE existing
  server logic where importable (e.g. the route handlers' underlying lib
  functions); otherwise direct queries. Every section tagged with source +
  fetched_at. Graceful per-section failure (missing table → section note, not
  a crash).
- `personas.ts` — the 8 system prompts. Each: role, lens, "tie every claim to
  a number from the data pack; cite the source field; no platitudes", and the
  output JSON schema: `[{severity, title, detail, evidence:{...}, recommendation}]`.
- `runner.ts` — Stage 1: 8 parallel persona calls (question + data pack) →
  parse findings, persist messages+findings. Stage 2: anonymize opinions as
  Agent A..H, each persona ranks all others' analyses (criteria: evidence
  quality, actionability) → persist. Stage 3: chairman synthesis (system
  prompt = neutral chair, inputs = opinions + rankings) producing the
  **Council Audit** markdown in Saniel's format: P0 list w/ repro-impact-ask,
  data-trust findings, quick wins, open questions, compliance exposure →
  persist as synthesis message + store into session. Update session status
  between stages so the UI can stream progress. Failed sessions record the
  error.

## API — all under `app/api/council/`, ALL guarded by the master-admin
pattern from `app/api/master-admin-chatbot/route.ts` (supabase server client
`getUser` → `users.is_master_admin` → 403; service client for data)

- `GET  /api/council/agents` → the 8 agents
- `POST /api/council/sessions` {question?} → creates session, runs the council
  (await full run for MVP — Groq is fast enough; return the completed session)
- `GET  /api/council/sessions` → recent sessions (id, question, status, created_at)
- `GET  /api/council/sessions/[id]` → session + all messages + findings
- `GET  /api/council/findings?status=open` → org findings newest-first
- `PATCH /api/council/findings/[id]` {status} → ack/resolve/dismiss
- `GET  /api/council/inbox?agent=ops` → messages for that agent
- `POST /api/council/inbox` {agent_key, to, subject, html, send:boolean} →
  draft or send via `backend/services/EmailService.ts` (from-name = agent
  name, reply-to = agent email); record either way
- `POST /api/council/inbox/to-agent` {agent_key, from, subject, text} → write
  a 'received' message (this is how the org writes TO an agent; the agent's
  reply is generated as a draft via the persona + LLM)
- `GET  /api/council/export?session=<id>&format=xlsx` → exceljs audit
  workbook: Summary sheet (meta + chairman synthesis), Findings sheet
  (severity, agent, title, detail, recommendation, status), Evidence sheet
  (data-pack key figures). Follow the existing xlsx export pattern in
  `app/api/aop/export/route.ts`.

## UI — Council Chamber inside MasterAdminDashboard

Find how `frontend/components/dashboard/MasterAdminDashboard.tsx` organizes
views/tabs and add a "Council" view. Sci-fi, but bounded by design.md
discipline + the `.cc-` design language (dark brand teal canvas, glass cards,
patient motion, ONE chromatic gesture — here: the agents' glow):

- **The Chamber:** dark chamber backdrop (`.cc-canvas` family), 8 agent
  "presences" — holographic tiles (avatar monogram, name, title, agent color
  as a rim glow, email). Idle = dim; during a run each lights up as its
  opinion lands (stage progress from session status/polling). Chairman = the
  synthesis panel, visually elevated (the "screen" in the reference image).
- **Convene:** question input ("ask the council") + Convene button → POST
  session → poll `GET /sessions/[id]` until complete → transcript unfolds:
  per-agent opinion cards (stage 1), peer-review summary (stage 2, compact),
  then the Council Audit (stage 3, rendered markdown) with severity ladder
  styling (P0 critical = the one allowed pulse, per calm-tech rules).
- **Findings board:** persistent list across sessions, severity filter,
  ack/resolve/dismiss via PATCH.
- **Agent inboxes:** pick an agent → inbox pane (in/out), compose as that
  agent (draft or send), write TO an agent → auto-generated draft reply.
- **Export:** "Export audit (xlsx)" per completed session.
- Preview harness at `app/cc-preview/council/page.tsx` (path already
  whitelisted in proxy.ts) with recorded fixture data so it renders without
  auth; verify with Playwright screenshots.

## Explicitly post-MVP (note in code, don't build)

Real Zoho mailbox provisioning per agent, WhatsApp Business hooks, voice
duplex, cron-convened weekly audits (schema has trigger='scheduled' ready),
multi-model council (different LLMs per persona), promotion to super admin.
